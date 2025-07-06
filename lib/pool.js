'use strict';

class LockPool {
    constructor(options = {}) {
        this.maxSize = options.maxSize || 100;
        this.minSize = options.minSize || 10;
        this.acquireTimeout = options.acquireTimeout || 5000;
        this.locks = new Map();
        this.available = [];
        this.inUse = new Set();
        this.waiting = [];
        
        this.initialize();
    }

    initialize() {
        // Pre-populate pool with minimum locks
        for (let i = 0; i < this.minSize; i++) {
            this.available.push(this.createLock());
        }
    }

    createLock() {
        return {
            id: Math.random().toString(36).substr(2, 9),
            createdAt: Date.now(),
            lastUsed: null,
            useCount: 0
        };
    }

    async acquire(file, options = {}) {
        const lock = await this.getLock();
        
        try {
            const locksmith = require('../index');
            const release = await locksmith.lock(file, options);
            
            lock.lastUsed = Date.now();
            lock.useCount++;
            this.inUse.add(lock);
            
            return {
                lock,
                release: async () => {
                    await release();
                    this.release(lock);
                }
            };
        } catch (error) {
            this.release(lock);
            throw error;
        }
    }

    async getLock() {
        // Try to get an available lock
        if (this.available.length > 0) {
            return this.available.pop();
        }
        
        // Create new lock if under max size
        if (this.locks.size < this.maxSize) {
            const lock = this.createLock();
            this.locks.set(lock.id, lock);
            return lock;
        }
        
        // Wait for a lock to become available
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('Lock pool timeout'));
            }, this.acquireTimeout);
            
            this.waiting.push({ resolve, timeout });
        });
    }

    release(lock) {
        this.inUse.delete(lock);
        
        // Notify waiting requests
        if (this.waiting.length > 0) {
            const { resolve, timeout } = this.waiting.shift();
            clearTimeout(timeout);
            resolve(lock);
        } else {
            this.available.push(lock);
        }
    }

    getStats() {
        return {
            total: this.locks.size,
            available: this.available.length,
            inUse: this.inUse.size,
            waiting: this.waiting.length,
            maxSize: this.maxSize,
            minSize: this.minSize
        };
    }

    drain() {
        this.available = [];
        this.inUse.clear();
        this.waiting.forEach(({ timeout }) => clearTimeout(timeout));
        this.waiting = [];
        this.locks.clear();
    }
}

function create(options = {}) {
    return new LockPool(options);
}

module.exports = { create }; 