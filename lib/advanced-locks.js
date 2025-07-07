'use strict';

const fs = require('graceful-fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const analytics = require('./analytics');
const backendManager = require('./backend-manager-singleton');
const { atomicDowngradeExclusiveToShared } = require('./lockfile');

class AdvancedLocks {
    constructor() {
        this.namedLocks = new Map();
        this.hierarchicalLocks = new Map();
        this.readWriteLocks = new Map();
        this.activeLocks = new Map(); // track active locks for upgrade/downgrade
    }

    // Read-Write Lock Implementation
    async acquireReadWriteLock(file, options = {}) {
        // If a backend is specified, use the backend manager instead of in-memory read-write locks
        if (options.backend) {
            const release = await backendManager.acquire(file, options);
            
            // Track the lock for upgrade/downgrade functionality
            const mode = options.mode || 'exclusive';
            this.trackLock(file, mode, release, options);
            
            return release;
        }

        // Otherwise, use the in-memory read-write lock implementation
        const lockId = this.getLockId(file);
        let lockData = this.readWriteLocks.get(lockId);
        
        if (!lockData) {
            lockData = {
                readers: new Set(),
                writers: new Set(),
                waitingReaders: [],
                waitingWriters: [],
                lastWriter: null
            };
            this.readWriteLocks.set(lockId, lockData);
        }

        const { mode = 'read', timeout = 30000 } = options;
        const requestId = this.generateRequestId();

        let release;
        if (mode === 'read') {
            const releaseFunc = await this.acquireReadLock(lockId, lockData, requestId, timeout);
            analytics.trackLockAcquired(file, { ...options, mode: 'read' });
            release = async (isUpgradeDowngrade = false) => {
                this.releaseReadLock(lockId, requestId);
                analytics.trackLockReleased(file);
                // Only untrack if not part of upgrade/downgrade
                if (!isUpgradeDowngrade) {
                    this.untrackLock(file, options);
                }
            };
        } else {
            const releaseFunc = await this.acquireWriteLock(lockId, lockData, requestId, timeout);
            analytics.trackLockAcquired(file, { ...options, mode: 'write' });
            release = async (isUpgradeDowngrade = false) => {
                this.releaseWriteLock(lockId, requestId);
                analytics.trackLockReleased(file);
                // Only untrack if not part of upgrade/downgrade
                if (!isUpgradeDowngrade) {
                    this.untrackLock(file, options);
                }
            };
        }

        // Track the lock for upgrade/downgrade functionality
        this.trackLock(file, mode, release, options);

        return release;
    }

    async acquireReadLock(lockId, lockData, requestId, timeout) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Read lock acquisition timeout'));
            }, timeout);

            const tryAcquire = () => {
                // Can acquire read lock if no writers are active or waiting
                if (lockData.writers.size === 0 && lockData.waitingWriters.length === 0) {
                    lockData.readers.add(requestId);
                    clearTimeout(timeoutId);
                    resolve(() => this.releaseReadLock(lockId, requestId));
                } else {
                    // Wait for writers to finish
                    lockData.waitingReaders.push({ requestId, resolve: tryAcquire });
                }
            };

            tryAcquire();
        });
    }

    async acquireWriteLock(lockId, lockData, requestId, timeout) {
        return new Promise((resolve, reject) => {
            let timedOut = false;
            const timeoutId = setTimeout(() => {
                timedOut = true;
                reject(new Error('Write lock acquisition timeout'));
            }, timeout);

            const tryAcquire = () => {
                if (timedOut) return;
                // Can acquire write lock if no readers or writers are active
                if (lockData.readers.size === 0 && lockData.writers.size === 0) {
                    lockData.writers.add(requestId);
                    lockData.lastWriter = requestId;
                    clearTimeout(timeoutId);
                    resolve(() => this.releaseWriteLock(lockId, requestId));
                } else {
                    // Wait for readers and writers to finish
                    lockData.waitingWriters.push({ requestId, resolve: tryAcquire });
                }
            };

            tryAcquire();
        });
    }

    releaseReadLock(lockId, requestId) {
        const lockData = this.readWriteLocks.get(lockId);
        if (!lockData) return;

        lockData.readers.delete(requestId);
        this.processWaitingLocks(lockId, lockData);
    }

    releaseWriteLock(lockId, requestId) {
        const lockData = this.readWriteLocks.get(lockId);
        if (!lockData) return;

        lockData.writers.delete(requestId);
        this.processWaitingLocks(lockId, lockData);
    }

    processWaitingLocks(lockId, lockData) {
        // Process waiting writers first (write priority)
        while (lockData.waitingWriters.length > 0 && 
               lockData.readers.size === 0 && 
               lockData.writers.size === 0) {
            const { requestId, resolve } = lockData.waitingWriters.shift();
            lockData.writers.add(requestId);
            lockData.lastWriter = requestId;
            resolve();
        }

        // Then process waiting readers
        while (lockData.waitingReaders.length > 0 && 
               lockData.writers.size === 0) {
            const { requestId, resolve } = lockData.waitingReaders.shift();
            lockData.readers.add(requestId);
            resolve();
        }

        // Clean up if no locks remain
        if (lockData.readers.size === 0 && lockData.writers.size === 0) {
            this.readWriteLocks.delete(lockId);
        }
    }

    // Hierarchical Lock Implementation
    async acquireHierarchicalLock(file, options = {}) {
        const { parent, lockParents = true } = options;
        const lockPath = this.getHierarchicalPath(file, parent);
        
        const releases = [];

        try {
            // Acquire parent locks if requested
            if (lockParents && parent) {
                const parentLock = await this.acquireHierarchicalLock(parent, { lockParents: true });
                if (typeof parentLock.release === 'function') {
                    releases.push(parentLock.release);
                }
            }

            // Acquire current lock using core lockfile
            const coreLock = await this.acquireCoreLock(file, options);
            analytics.trackLockAcquired(file, options);
            releases.push(async () => {
                await coreLock();
                analytics.trackLockReleased(file);
            });

            return {
                release: async () => {
                    // Release in reverse order
                    for (let i = releases.length - 1; i >= 0; i--) {
                        await releases[i]();
                    }
                }
            };
        } catch (error) {
            // Release any acquired locks on error
            for (const release of releases) {
                try {
                    await release();
                } catch (e) {
                    // Ignore release errors
                }
            }
            throw error;
        }
    }

    // Named Lock Implementation
    async acquireNamedLock(name, options = {}) {
        const lockId = `named:${name}`;
        
        if (!this.namedLocks.has(lockId)) {
            this.namedLocks.set(lockId, {
                holders: new Set(),
                waiting: []
            });
        }

        const lockData = this.namedLocks.get(lockId);
        const requestId = this.generateRequestId();

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Named lock acquisition timeout'));
            }, options.timeout || 30000);

            const tryAcquire = () => {
                if (lockData.holders.size === 0) {
                    lockData.holders.add(requestId);
                    clearTimeout(timeoutId);
                    analytics.trackLockAcquired(name, { ...options, named: true });
                    resolve(async () => {
                        this.releaseNamedLock(lockId, requestId);
                        analytics.trackLockReleased(name);
                    });
                } else {
                    lockData.waiting.push({ requestId, resolve: tryAcquire });
                }
            };

            tryAcquire();
        });
    }

    releaseNamedLock(lockId, requestId) {
        const lockData = this.namedLocks.get(lockId);
        if (!lockData) return;

        lockData.holders.delete(requestId);

        // Process waiting locks
        if (lockData.waiting.length > 0) {
            const { requestId: nextRequestId, resolve } = lockData.waiting.shift();
            lockData.holders.add(nextRequestId);
            resolve();
        }

        // Clean up if no locks remain
        if (lockData.holders.size === 0) {
            this.namedLocks.delete(lockId);
        }
    }

    // Utility methods
    getLockId(file) {
        return path.resolve(file);
    }

    getHierarchicalPath(file, parent) {
        if (!parent) return file;
        return path.join(parent, path.basename(file));
    }

    generateRequestId() {
        return `${process.pid}@${os.hostname()}:${crypto.randomBytes(8).toString('hex')}`;
    }

    async acquireCoreLock(file, options) {
        // Use the backend manager to support different backends
        return await backendManager.acquire(file, options);
    }

    // Lock upgrade/downgrade
    async upgradeToWrite(file, options = {}) {
        const lockKey = this.getLockKey(file, options);
        const currentLock = this.activeLocks.get(lockKey);

        if (!currentLock) {
            throw new Error(`No active lock found for ${file}`);
        }

        if (currentLock.type !== 'read') {
            throw new Error(`Cannot upgrade lock: current lock is not a read lock`);
        }

        // Check if there are other read locks that would prevent upgrade
        const readLocks = Array.from(this.activeLocks.values())
            .filter(lock => lock.file === file && lock.type === 'read' && lock !== currentLock);

        if (readLocks.length > 0) {
            throw new Error(`Cannot upgrade to write lock: ${readLocks.length} other read locks are active`);
        }

        // Mark the lock as being upgraded to prevent race conditions
        currentLock.isUpgrading = true;

        try {
            // Release the read lock with upgrade flag
            await currentLock.release(true);

            // Acquire write lock
            const writeLock = await this.acquireReadWriteLock(file, { ...options, mode: 'write' });
            
            // Update tracking with new lock
            this.activeLocks.set(lockKey, {
                ...currentLock,
                type: 'write',
                release: writeLock,
                isUpgrading: false
            });

            return writeLock;
        } catch (error) {
            // If upgrade fails, restore the original lock tracking and clear upgrade flag
            currentLock.isUpgrading = false;
            throw error;
        }
    }

    async downgradeToRead(file, options = {}) {
        const lockKey = this.getLockKey(file, options);
        const currentLock = this.activeLocks.get(lockKey);

        if (!currentLock) {
            throw new Error(`No active lock found for ${file}`);
        }

        if (currentLock.type !== 'write') {
            throw new Error(`Cannot downgrade lock: current lock is not a write lock`);
        }

        // Mark the lock as being downgraded to prevent race conditions
        currentLock.isDowngrading = true;

        try {
            // Release the write lock with upgrade flag
            await currentLock.release(true);

            // Acquire read lock
            const readLock = await this.acquireReadWriteLock(file, { ...options, mode: 'read' });
            
            // Update tracking with new lock
            this.activeLocks.set(lockKey, {
                ...currentLock,
                type: 'read',
                release: readLock,
                isDowngrading: false
            });

            return readLock;
        } catch (error) {
            // If downgrade fails, restore the original lock tracking and clear downgrade flag
            currentLock.isDowngrading = false;
            throw error;
        }
    }

    /**
     * Upgrades a shared lock to exclusive, with robust error handling and timeouts.
     */
    async upgradeToExclusive(file, options = {}) {
        const lockKey = this.getLockKey(file, options);
        const currentLock = this.activeLocks.get(lockKey);
        if (!currentLock) {
            throw new Error(`No active lock found for ${file}`);
        }
        currentLock.isUpgrading = true;
        try {
            // Release the shared lock with upgrade flag
            await currentLock.release(true);
            // Wait for the lockfile to be fully released using a more efficient retry loop
            const fs = require('fs').promises;
            const lockfilePath = typeof file === 'string' ? `${file}.lock` : `${file.path}.lock`;
            const maxWaitMs = 1000; // Reduced timeout
            const pollIntervalMs = 25; // Faster polling
            const start = Date.now();
            let released = false;
            let lastError = null;
            while (Date.now() - start < maxWaitMs) {
                try {
                    // Try to stat the lockfile; if it doesn't exist, it's released
                    await fs.access(lockfilePath);
                    // File exists, so wait and retry
                    await new Promise(res => setTimeout(res, pollIntervalMs));
                } catch (err) {
                    if (err && err.code === 'ENOENT') {
                        // Lockfile does not exist, so it's released
                        released = true;
                        break;
                    } else if (err && (err.code === 'EACCES' || err.code === 'EPERM' || err.code === 'EIO')) {
                        // Permission or IO error, could be transient, so retry after a short delay
                        lastError = err;
                        await new Promise(res => setTimeout(res, pollIntervalMs));
                    } else {
                        // Unexpected error, abort
                        throw err;
                    }
                }
            }
            if (!released) {
                if (lastError) throw lastError;
                console.warn(`Warning: Lockfile may not be fully released: ${lockfilePath}`);
                // Continue anyway - the new lock acquisition will handle conflicts
            }
            // Acquire exclusive lock using the backend manager directly
            const exclusiveLock = await backendManager.acquire(file, { ...options, mode: 'exclusive' });
            // Update tracking with new lock
            this.activeLocks.set(lockKey, {
                ...currentLock,
                type: 'exclusive',
                release: exclusiveLock,
                isUpgrading: false
            });
            return exclusiveLock;
        } catch (error) {
            // If upgrade fails, restore the original lock tracking and clear upgrade flag
            currentLock.isUpgrading = false;
            throw error;
        }
    }

    async downgradeToShared(file, options = {}) {
        const lockKey = this.getLockKey(file, options);
        const currentLock = this.activeLocks.get(lockKey);

        if (!currentLock) {
            throw new Error(`No active lock found for ${file}`);
        }

        if (currentLock.type !== 'exclusive') {
            throw new Error(`Cannot downgrade lock: current lock is not an exclusive lock`);
        }

        currentLock.isDowngrading = true;

        try {
            // Use atomic helper for exclusive-to-shared downgrade
            const fs = require('fs');
            const lockfilePath = typeof file === 'string' ? `${file}.lock` : `${file.path}.lock`;
            const id = currentLock.options && currentLock.options.id ? currentLock.options.id : `pid:${process.pid}@${require('os').hostname()}`;
            const wfs = fs;
            const sharedLock = await new Promise((resolve, reject) => {
                atomicDowngradeExclusiveToShared(lockfilePath, id, wfs, (err, releaseFn) => {
                    if (err) return reject(err);
                    resolve(releaseFn);
                });
            });
            this.activeLocks.set(lockKey, {
                ...currentLock,
                type: 'shared',
                release: sharedLock,
                isDowngrading: false
            });
            return sharedLock;
        } catch (error) {
            currentLock.isDowngrading = false;
            throw error;
        }
    }

    /**
     * Get lock key for tracking
     * @param {string} file - File path
     * @param {Object} options - Lock options
     * @returns {string} Lock key
     */
    getLockKey(file, options) {
        // Create a unique key that includes file path and backend
        const backend = options.backend || 'file';
        let backendKey;
        if (typeof backend === 'string') {
            backendKey = backend;
        } else if (backend && typeof backend === 'object') {
            // For complex backend objects, create a stable hash
            const crypto = require('crypto');
            let json;
            try {
                json = JSON.stringify(backend, Object.keys(backend).sort());
            } catch (e) {
                // Fallback to a stable string if JSON.stringify fails
                json = Object.keys(backend).sort().join('_');
            }
            backendKey = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);
        } else {
            backendKey = String(backend);
        }
        return `${file}:${backendKey}`;
    }

    /**
     * Track a new lock
     * @param {string} file - File path
     * @param {string} type - Lock type
     * @param {Function} release - Release function
     * @param {Object} options - Lock options
     */
    trackLock(file, type, release, options = {}) {
        const lockKey = this.getLockKey(file, options);
        this.activeLocks.set(lockKey, {
            file,
            type,
            release,
            options,
            acquiredAt: Date.now()
        });
    }

    /**
     * Remove lock tracking
     * @param {string} file - File path
     * @param {Object} options - Lock options
     */
    untrackLock(file, options = {}) {
        const lockKey = this.getLockKey(file, options);
        this.activeLocks.delete(lockKey);
    }

    /**
     * Get all tracked locks
     * @returns {Array} Array of tracked locks
     */
    getTrackedLocks() {
        return Array.from(this.activeLocks.values());
    }

    /**
     * Check if a lock can be upgraded
     * @param {string} file - File path
     * @param {string} targetType - Target lock type
     * @param {Object} options - Lock options
     * @returns {Promise<boolean>} Whether upgrade is possible
     */
    async canUpgrade(file, targetType, options = {}) {
        const lockKey = this.getLockKey(file, options);
        const currentLock = this.activeLocks.get(lockKey);

        if (!currentLock) {
            return false;
        }

        // Check if upgrade path is valid
        const validUpgrades = {
            'read': ['write'],
            'shared': ['exclusive'],
            'write': [], // write locks can't be upgraded further
            'exclusive': [] // exclusive locks can't be upgraded further
        };

        if (!validUpgrades[currentLock.type].includes(targetType)) {
            return false;
        }

        // Check for conflicting locks
        if (targetType === 'write' || targetType === 'exclusive') {
            const conflictingLocks = Array.from(this.activeLocks.values())
                .filter(lock => lock.file === file && lock !== currentLock);
            
            return conflictingLocks.length === 0;
        }

        return true;
    }
}

// Create singleton instance
const advancedLocks = new AdvancedLocks();

// Export the instance with all methods
module.exports = advancedLocks; 