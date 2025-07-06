'use strict';

const fs = require('graceful-fs');
const path = require('path');
const crypto = require('crypto');

class BackendManager {
    constructor() {
        this.backends = new Map();
        this.registerDefaultBackends();
    }

    registerDefaultBackends() {
        // File-based backend (default)
        this.register('file', {
            acquire: this.fileAcquire.bind(this),
            release: this.fileRelease.bind(this),
            check: this.fileCheck.bind(this),
            checkHealth: this.fileCheckHealth.bind(this),
            repair: this.fileRepair.bind(this),
            export: this.fileExport.bind(this),
            import: this.fileImport.bind(this)
        });

        // Memory backend for global locks
        this.register('memory', {
            acquire: this.memoryAcquire.bind(this),
            release: this.memoryRelease.bind(this),
            check: this.memoryCheck.bind(this),
            checkHealth: this.memoryCheckHealth.bind(this),
            repair: this.memoryRepair.bind(this),
            export: this.memoryExport.bind(this),
            import: this.memoryImport.bind(this)
        });

        // Redis backend
        this.register('redis', {
            acquire: this.redisAcquire.bind(this),
            release: this.redisRelease.bind(this),
            check: this.redisCheck.bind(this),
            checkHealth: this.redisCheckHealth.bind(this),
            repair: this.redisRepair.bind(this),
            export: this.redisExport.bind(this),
            import: this.redisImport.bind(this)
        });

        // Consul backend
        this.register('consul', {
            acquire: this.consulAcquire.bind(this),
            release: this.consulRelease.bind(this),
            check: this.consulCheck.bind(this),
            checkHealth: this.consulCheckHealth.bind(this),
            repair: this.consulRepair.bind(this),
            export: this.consulExport.bind(this),
            import: this.consulImport.bind(this)
        });
    }

    register(name, implementation) {
        this.backends.set(name, implementation);
    }

    async get(name, options = {}) {
        const backend = this.backends.get(name);
        if (!backend) {
            throw new Error(`Backend '${name}' not found`);
        }
        return backend;
    }

    // File backend implementation
    async fileAcquire(file, options) {
        const lockfile = require('./lockfile');
        return await lockfile.lock(file, options);
    }

    async fileRelease(file, options) {
        const lockfile = require('./lockfile');
        return await lockfile.unlock(file, options);
    }

    async fileCheck(file, options) {
        const lockfile = require('./lockfile');
        return await lockfile.check(file, options);
    }

    async fileCheckHealth(file) {
        try {
            const lockfilePath = `${file}.lock`;
            const stats = await fs.promises.stat(lockfilePath);
            const isStale = Date.now() - stats.mtime.getTime() > 30000; // 30s stale threshold
            
            return {
                healthy: !isStale,
                corrupted: false,
                lastModified: stats.mtime,
                size: stats.size
            };
        } catch (error) {
            return {
                healthy: false,
                corrupted: error.code === 'ENOENT' ? false : true,
                error: error.message
            };
        }
    }

    async fileRepair(file) {
        try {
            const lockfilePath = `${file}.lock`;
            await fs.promises.unlink(lockfilePath);
            return { repaired: true };
        } catch (error) {
            return { repaired: false, error: error.message };
        }
    }

    async fileExport(file) {
        try {
            const lockfilePath = `${file}.lock`;
            const data = await fs.promises.readFile(lockfilePath, 'utf8');
            const stats = await fs.promises.stat(lockfilePath);
            
            return {
                data,
                metadata: {
                    mtime: stats.mtime,
                    size: stats.size,
                    mode: stats.mode
                }
            };
        } catch (error) {
            throw new Error(`Failed to export lock: ${error.message}`);
        }
    }

    async fileImport(file, data, options = {}) {
        try {
            const lockfilePath = `${file}.lock`;
            await fs.promises.writeFile(lockfilePath, data.data);
            
            if (data.metadata) {
                await fs.promises.utimes(lockfilePath, data.metadata.mtime, data.metadata.mtime);
            }
            
            return { imported: true };
        } catch (error) {
            throw new Error(`Failed to import lock: ${error.message}`);
        }
    }

    // Memory backend implementation
    memoryLocks = new Map();

    async memoryAcquire(key, options) {
        const lockId = crypto.randomBytes(16).toString('hex');
        const lockData = {
            id: lockId,
            pid: process.pid,
            acquiredAt: Date.now(),
            mode: options.mode || 'exclusive'
        };

        this.memoryLocks.set(key, lockData);

        return {
            release: async () => {
                this.memoryLocks.delete(key);
            }
        };
    }

    async memoryRelease(key) {
        this.memoryLocks.delete(key);
        return true;
    }

    async memoryCheck(key) {
        return this.memoryLocks.has(key);
    }

    async memoryCheckHealth(key) {
        const lock = this.memoryLocks.get(key);
        if (!lock) {
            return { healthy: false, corrupted: false };
        }

        const isStale = Date.now() - lock.acquiredAt > 30000;
        return {
            healthy: !isStale,
            corrupted: false,
            lockData: lock
        };
    }

    async memoryRepair(key) {
        this.memoryLocks.delete(key);
        return { repaired: true };
    }

    async memoryExport(key) {
        const lock = this.memoryLocks.get(key);
        return {
            data: JSON.stringify(lock),
            metadata: { type: 'memory' }
        };
    }

    async memoryImport(key, data, options = {}) {
        const lock = JSON.parse(data.data);
        this.memoryLocks.set(key, lock);
        return { imported: true };
    }

    // Redis backend implementation
    async redisAcquire(key, options) {
        const redis = await this.getRedisClient(options);
        const lockId = crypto.randomBytes(16).toString('hex');
        const lockKey = `locksmith:${key}`;
        
        const result = await redis.set(lockKey, lockId, 'PX', options.stale || 10000, 'NX');
        
        if (result === 'OK') {
            return {
                release: async () => {
                    const script = `
                        if redis.call("get", KEYS[1]) == ARGV[1] then
                            return redis.call("del", KEYS[1])
                        else
                            return 0
                        end
                    `;
                    await redis.eval(script, 1, lockKey, lockId);
                }
            };
        } else {
            throw new Error('Lock acquisition failed');
        }
    }

    async redisRelease(key) {
        const redis = await this.getRedisClient();
        const lockKey = `locksmith:${key}`;
        await redis.del(lockKey);
        return true;
    }

    async redisCheck(key) {
        const redis = await this.getRedisClient();
        const lockKey = `locksmith:${key}`;
        return await redis.exists(lockKey) === 1;
    }

    async redisCheckHealth(key) {
        const redis = await this.getRedisClient();
        const lockKey = `locksmith:${key}`;
        const ttl = await redis.ttl(lockKey);
        
        return {
            healthy: ttl > 0,
            corrupted: false,
            ttl
        };
    }

    async redisRepair(key) {
        const redis = await this.getRedisClient();
        const lockKey = `locksmith:${key}`;
        await redis.del(lockKey);
        return { repaired: true };
    }

    async redisExport(key) {
        const redis = await this.getRedisClient();
        const lockKey = `locksmith:${key}`;
        const data = await redis.get(lockKey);
        const ttl = await redis.ttl(lockKey);
        
        return {
            data,
            metadata: { ttl, type: 'redis' }
        };
    }

    async redisImport(key, data, options = {}) {
        const redis = await this.getRedisClient();
        const lockKey = `locksmith:${key}`;
        await redis.set(lockKey, data.data, 'PX', data.metadata.ttl || 10000);
        return { imported: true };
    }

    async getRedisClient(options = {}) {
        // This would be implemented with actual Redis client
        // For now, return a mock implementation
        return {
            set: async () => 'OK',
            del: async () => 1,
            exists: async () => 1,
            ttl: async () => 1000,
            get: async () => 'mock-data',
            eval: async () => 1
        };
    }

    // Consul backend implementation
    async consulAcquire(key, options) {
        // Mock Consul implementation
        const lockId = crypto.randomBytes(16).toString('hex');
        return {
            release: async () => {
                // Release Consul lock
            }
        };
    }

    async consulRelease(key) {
        return true;
    }

    async consulCheck(key) {
        return false;
    }

    async consulCheckHealth(key) {
        return { healthy: true, corrupted: false };
    }

    async consulRepair(key) {
        return { repaired: true };
    }

    async consulExport(key) {
        return { data: 'mock-data', metadata: { type: 'consul' } };
    }

    async consulImport(key, data, options = {}) {
        return { imported: true };
    }
}

module.exports = new BackendManager(); 