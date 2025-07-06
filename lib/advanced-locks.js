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
    }

    // Read-Write Lock Implementation
    async acquireReadWriteLock(file, options = {}) {
        // If a backend is specified, use the backend manager instead of in-memory read-write locks
        if (options.backend) {
            const backendManager = require('./distributed-backends');
            return await backendManager.acquire(file, options);
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

        if (mode === 'read') {
            const release = await this.acquireReadLock(lockId, lockData, requestId, timeout);
            analytics.trackLockAcquired(file, { ...options, mode: 'read' });
            return async () => {
                this.releaseReadLock(lockId, requestId);
                analytics.trackLockReleased(file);
            };
        } else {
            const release = await this.acquireWriteLock(lockId, lockData, requestId, timeout);
            analytics.trackLockAcquired(file, { ...options, mode: 'write' });
            return async () => {
                this.releaseWriteLock(lockId, requestId);
                analytics.trackLockReleased(file);
            };
        }
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
    async upgradeLock(lock, newMode = 'write') {
        // Implementation for upgrading a read lock to write lock
        throw new Error('Lock upgrade not implemented yet');
    }

    async downgradeLock(lock, newMode = 'read') {
        // Implementation for downgrading a write lock to read lock
        throw new Error('Lock downgrade not implemented yet');
    }

    // Lock migration
    async migrateLock(sourceFile, targetFile, options = {}) {
        const sourceLock = await this.acquireCoreLock(sourceFile, options);
        const targetLock = await this.acquireCoreLock(targetFile, options);
        
        return {
            sourceLock,
            targetLock,
            release: async () => {
                await sourceLock();
                await targetLock();
            }
        };
    }

    // Conditional locking
    async acquireConditionalLock(file, condition, options = {}) {
        const checkCondition = async () => {
            try {
                return await condition();
            } catch (error) {
                return false;
            }
        };

        if (await checkCondition()) {
            return await this.acquireCoreLock(file, options);
        } else {
            throw new Error('Lock condition not met');
        }
    }
}

module.exports = new AdvancedLocks(); 