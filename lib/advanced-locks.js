'use strict';

const fs = require('graceful-fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const analytics = require('./analytics');

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
            const backendManager = require('./distributed-backends');
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
            release = async () => {
                this.releaseReadLock(lockId, requestId);
                analytics.trackLockReleased(file);
                // Only untrack if not part of upgrade/downgrade
                if (!options._isUpgradeDowngrade) {
                    this.untrackLock(file, options);
                }
            };
        } else {
            const releaseFunc = await this.acquireWriteLock(lockId, lockData, requestId, timeout);
            analytics.trackLockAcquired(file, { ...options, mode: 'write' });
            release = async () => {
                this.releaseWriteLock(lockId, requestId);
                analytics.trackLockReleased(file);
                // Only untrack if not part of upgrade/downgrade
                if (!options._isUpgradeDowngrade) {
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
        const backendManager = require('./distributed-backends');
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

        // Temporarily remove from tracking to prevent conflicts
        this.activeLocks.delete(lockKey);

        try {
            // Release the read lock
            await currentLock.release();

            // Acquire write lock
            const writeLock = await this.acquireReadWriteLock(file, { ...options, mode: 'write', _isUpgradeDowngrade: true });
            
            // Update tracking with new lock
            this.activeLocks.set(lockKey, {
                ...currentLock,
                type: 'write',
                release: writeLock
            });

            return writeLock;
        } catch (error) {
            // If upgrade fails, try to restore the original lock tracking
            this.activeLocks.set(lockKey, currentLock);
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

        // Temporarily remove from tracking to prevent conflicts
        this.activeLocks.delete(lockKey);

        try {
            // Release the write lock
            await currentLock.release();

            // Acquire read lock
            const readLock = await this.acquireReadWriteLock(file, { ...options, mode: 'read', _isUpgradeDowngrade: true });
            
            // Update tracking with new lock
            this.activeLocks.set(lockKey, {
                ...currentLock,
                type: 'read',
                release: readLock
            });

            return readLock;
        } catch (error) {
            // If downgrade fails, try to restore the original lock tracking
            this.activeLocks.set(lockKey, currentLock);
            throw error;
        }
    }

    async upgradeToExclusive(file, options = {}) {
        const lockKey = this.getLockKey(file, options);
        const currentLock = this.activeLocks.get(lockKey);

        if (!currentLock) {
            throw new Error(`No active lock found for ${file}`);
        }

        if (currentLock.type !== 'shared') {
            throw new Error(`Cannot upgrade lock: current lock is not a shared lock`);
        }

        // Check if there are other shared locks that would prevent upgrade
        const sharedLocks = Array.from(this.activeLocks.values())
            .filter(lock => lock.file === file && lock.type === 'shared' && lock !== currentLock);

        if (sharedLocks.length > 0) {
            throw new Error(`Cannot upgrade to exclusive lock: ${sharedLocks.length} other shared locks are active`);
        }

        // Temporarily remove from tracking to prevent conflicts
        this.activeLocks.delete(lockKey);

        try {
            // Release the shared lock
            await currentLock.release();

            // Wait a bit for the lockfile to be fully released
            await new Promise(resolve => setTimeout(resolve, 100));

            // Acquire exclusive lock using the backend manager directly
            const backendManager = require('./distributed-backends');
            const exclusiveLock = await backendManager.acquire(file, { ...options, mode: 'exclusive', _isUpgradeDowngrade: true });
            
            // Update tracking with new lock
            this.activeLocks.set(lockKey, {
                ...currentLock,
                type: 'exclusive',
                release: exclusiveLock
            });

            return exclusiveLock;
        } catch (error) {
            // If upgrade fails, try to restore the original lock tracking
            this.activeLocks.set(lockKey, currentLock);
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

        // Temporarily remove from tracking to prevent conflicts
        this.activeLocks.delete(lockKey);

        try {
            // Release the exclusive lock
            await currentLock.release();

            // Wait a bit for the lockfile to be fully released
            await new Promise(resolve => setTimeout(resolve, 100));

            // Acquire shared lock using the backend manager directly
            const backendManager = require('./distributed-backends');
            const sharedLock = await backendManager.acquire(file, { ...options, mode: 'shared', _isUpgradeDowngrade: true });
            
            // Update tracking with new lock
            this.activeLocks.set(lockKey, {
                ...currentLock,
                type: 'shared',
                release: sharedLock
            });

            return sharedLock;
        } catch (error) {
            // If downgrade fails, try to restore the original lock tracking
            this.activeLocks.set(lockKey, currentLock);
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
        return `${file}:${backend}`;
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