'use strict';

const EventEmitter = require('events');
const analytics = require('./analytics');

class BackendManager extends EventEmitter {
    constructor() {
        super();
        this.backends = new Map();
        this.defaultBackend = 'file';
        this.initializeBackends();
    }

    initializeBackends() {
        // Register built-in backends
        this.registerBackend('file', new FileBackend());
        this.registerBackend('memory', new MemoryBackend());
        this.registerBackend('redis', new RedisBackend());
        this.registerBackend('consul', new ConsulBackend());
    }

    registerBackend(name, backend) {
        this.backends.set(name, backend);
        this.emit('backend-registered', { name, backend });
    }

    getBackend(name) {
        const backend = this.backends.get(name);
        if (!backend) {
            throw new Error(`Backend '${name}' not found`);
        }
        return backend;
    }

    async acquire(file, options = {}) {
        const backendName = options.backend || this.defaultBackend;
        const backend = this.getBackend(backendName);
        
        try {
            return await backend.acquire(file, options);
        } catch (error) {
            this.emit('backend-error', { backend: backendName, error, file });
            throw error;
        }
    }

    async release(file, options = {}) {
        const backendName = options.backend || this.defaultBackend;
        const backend = this.getBackend(backendName);
        
        try {
            return await backend.release(file, options);
        } catch (error) {
            this.emit('backend-error', { backend: backendName, error, file });
            throw error;
        }
    }

    async check(file, options = {}) {
        const backendName = options.backend || this.defaultBackend;
        const backend = this.getBackend(backendName);
        
        try {
            return await backend.check(file, options);
        } catch (error) {
            this.emit('backend-error', { backend: backendName, error, file });
            throw error;
        }
    }
}

// Base Backend Class
class BaseBackend {
    constructor() {
        this.locks = new Map();
    }

    async acquire(file, options = {}) {
        throw new Error('acquire method must be implemented');
    }

    async release(file, options = {}) {
        throw new Error('release method must be implemented');
    }

    async check(file, options = {}) {
        throw new Error('check method must be implemented');
    }

    generateLockId(file) {
        return `${file}:${Date.now()}:${Math.random().toString(36).substr(2, 9)}`;
    }
}

// File Backend (uses core lockfile)
class FileBackend extends BaseBackend {
    async acquire(file, options = {}) {
        const lockfile = require('./lockfile');
        return new Promise((resolve, reject) => {
            lockfile.lock(file, options, (err, release) => {
                if (err) return reject(err);
                resolve(release);
            });
        });
    }

    async release(file, options = {}) {
        const lockfile = require('./lockfile');
        return new Promise((resolve, reject) => {
            lockfile.unlock(file, options, (err) => {
                if (err) return reject(err);
                resolve();
            });
        });
    }

    async check(file, options = {}) {
        const lockfile = require('./lockfile');
        return new Promise((resolve, reject) => {
            lockfile.check(file, options, (err, isLocked) => {
                if (err) return reject(err);
                resolve(isLocked);
            });
        });
    }
}

// Memory Backend
class MemoryBackend extends BaseBackend {
    constructor() {
        super();
        this.locks = new Map();
        this.lockTimers = new Map();
    }

    async acquire(file, options = {}) {
        const lockId = this.generateLockId(file);
        const { timeout = 30000, stale = 10000 } = options;

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Lock acquisition timeout'));
            }, timeout);

            const tryAcquire = () => {
                if (!this.locks.has(file)) {
                    this.locks.set(file, {
                        id: lockId,
                        acquired: Date.now(),
                        holder: process.pid
                    });

                    // Set stale timer
                    const staleTimer = setTimeout(() => {
                        this.locks.delete(file);
                        this.lockTimers.delete(file);
                    }, stale);

                    this.lockTimers.set(file, staleTimer);

                    clearTimeout(timeoutId);
                    analytics.trackLockAcquired(file, { ...options, backend: 'memory' });
                    resolve(async () => {
                        await this.release(file, options);
                        analytics.trackLockReleased(file);
                    });
                } else {
                    // Check if lock is stale
                    const lock = this.locks.get(file);
                    if (Date.now() - lock.acquired > stale) {
                        this.locks.delete(file);
                        const timer = this.lockTimers.get(file);
                        if (timer) {
                            clearTimeout(timer);
                            this.lockTimers.delete(file);
                        }
                        tryAcquire();
                    } else {
                        // Lock is held, retry after a short delay
                        setTimeout(tryAcquire, 100);
                    }
                }
            };

            tryAcquire();
        });
    }

    async release(file, options = {}) {
        const lock = this.locks.get(file);
        if (!lock) {
            throw new Error('Lock not found');
        }

        this.locks.delete(file);
        const timer = this.lockTimers.get(file);
        if (timer) {
            clearTimeout(timer);
            this.lockTimers.delete(file);
        }
        analytics.trackLockReleased(file);
    }

    async check(file, options = {}) {
        const lock = this.locks.get(file);
        if (!lock) return false;

        const { stale = 10000 } = options;
        return (Date.now() - lock.acquired) <= stale;
    }
}

// Redis Backend
class RedisBackend extends BaseBackend {
    constructor() {
        super();
        this.redis = null;
        this.connected = false;
    }

    async connect(options = {}) {
        try {
            const Redis = require('redis');
            this.redis = Redis.createClient({
                host: options.host || 'localhost',
                port: options.port || 6379,
                password: options.password,
                db: options.db || 0
            });

            this.redis.on('error', (err) => {
                console.error('Redis connection error:', err);
                this.connected = false;
            });

            this.redis.on('connect', () => {
                this.connected = true;
            });

            await this.redis.connect();
        } catch (error) {
            throw new Error(`Redis connection failed: ${error.message}`);
        }
    }

    async acquire(file, options = {}) {
        if (!this.connected) {
            await this.connect(options);
        }

        const lockKey = `lock:${file}`;
        const lockValue = this.generateLockId(file);
        const { timeout = 30000, stale = 10000 } = options;

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Redis lock acquisition timeout'));
            }, timeout);

            const tryAcquire = async () => {
                try {
                    // Try to set the lock with NX (only if not exists) and EX (expiration)
                    const result = await this.redis.set(lockKey, lockValue, {
                        NX: true,
                        EX: Math.ceil(stale / 1000)
                    });

                    if (result === 'OK') {
                        clearTimeout(timeoutId);
                        resolve(() => this.release(file, options));
                    } else {
                        // Lock exists, check if it's stale
                        const currentValue = await this.redis.get(lockKey);
                        if (!currentValue) {
                            // Lock expired, try again
                            setTimeout(tryAcquire, 100);
                        } else {
                            // Lock is held, retry after a short delay
                            setTimeout(tryAcquire, 100);
                        }
                    }
                } catch (error) {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            };

            tryAcquire();
        });
    }

    async release(file, options = {}) {
        if (!this.connected) {
            throw new Error('Redis not connected');
        }

        const lockKey = `lock:${file}`;
        await this.redis.del(lockKey);
    }

    async check(file, options = {}) {
        if (!this.connected) {
            await this.connect(options);
        }

        const lockKey = `lock:${file}`;
        const value = await this.redis.get(lockKey);
        return value !== null;
    }
}

// Consul Backend
class ConsulBackend extends BaseBackend {
    constructor() {
        super();
        this.consul = null;
        this.connected = false;
    }

    async connect(options = {}) {
        try {
            const Consul = require('consul');
            this.consul = new Consul({
                host: options.host || 'localhost',
                port: options.port || 8500,
                token: options.token
            });

            this.connected = true;
        } catch (error) {
            throw new Error(`Consul connection failed: ${error.message}`);
        }
    }

    async acquire(file, options = {}) {
        if (!this.connected) {
            await this.connect(options);
        }

        const lockKey = `locks/${file}`;
        const lockValue = this.generateLockId(file);
        const { timeout = 30000, stale = 10000 } = options;

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('Consul lock acquisition timeout'));
            }, timeout);

            const tryAcquire = async () => {
                try {
                    // Try to acquire the lock using Consul's KV store
                    const result = await this.consul.kv.set(lockKey, lockValue, {
                        acquire: lockValue,
                        ttl: `${Math.ceil(stale / 1000)}s`
                    });

                    if (result) {
                        clearTimeout(timeoutId);
                        resolve(() => this.release(file, options));
                    } else {
                        // Lock is held, retry after a short delay
                        setTimeout(tryAcquire, 100);
                    }
                } catch (error) {
                    clearTimeout(timeoutId);
                    reject(error);
                }
            };

            tryAcquire();
        });
    }

    async release(file, options = {}) {
        if (!this.connected) {
            throw new Error('Consul not connected');
        }

        const lockKey = `locks/${file}`;
        const lockValue = this.generateLockId(file);
        await this.consul.kv.set(lockKey, lockValue, { release: lockValue });
    }

    async check(file, options = {}) {
        if (!this.connected) {
            await this.connect(options);
        }

        const lockKey = `locks/${file}`;
        try {
            const result = await this.consul.kv.get(lockKey);
            return result && result.Value;
        } catch (error) {
            return false;
        }
    }
}

module.exports = new BackendManager(); 