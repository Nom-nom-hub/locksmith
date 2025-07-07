'use strict';

const EventEmitter = require('events');
const analytics = require('./analytics');
const lockfile = require('./lockfile');
const locks = require('./lockfile').getLocks();

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
        // this.registerBackend('consul', new ConsulBackend()); // ConsulBackend not implemented
    }

    registerBackend(name, backend) {
        this.backends.set(name, backend);
        this.emit('backend-registered', { name, backend });
    }

    getBackend(name) {
        // Accept backend object directly
        if (typeof name === 'object' && name !== null) {
            // Instead of mutating, return a proxy/wrapper
            const backend = name;
            if (typeof backend.acquire === 'function') {
                return new Proxy(backend, {
                    get(target, prop) {
                        if (prop === 'acquire') {
                            return async (...args) => {
                                const result = await target.acquire(...args);
                                if (typeof result === 'function') {
                                    if (typeof target.release === 'function') {
                                        return async (...fnArgs) => {
                                            await target.release(...fnArgs);
                                            return result(...fnArgs);
                                        };
                                    }
                                    return result;
                                } else if (typeof result === 'object' && result !== null && typeof result.release === 'function') {
                                    if (typeof target.release === 'function') {
                                        return async (...fnArgs) => {
                                            await target.release(...fnArgs);
                                            return result.release(...fnArgs);
                                        };
                                    }
                                    return result.release;
                                } else if (typeof target.release === 'function') {
                                    return target.release;
                                } else {
                                    return async () => {};
                                }
                            };
                        }
                        return target[prop];
                    }
                });
            }
            return backend;
        }
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
        return new Promise((resolve, reject) => {
            lockfile.lock(file, options, (err, release) => {
                if (err) return reject(err);
                // Register the lock in locks[file] for unlock and timer cleanup
                locks[file] = locks[file] || { released: false, updateTimeout: null, options };
                resolve(release);
            });
        });
    }

    async release(file, options = {}) {
        const lockfile = require('./lockfile');
        return new Promise((resolve, reject) => {
            lockfile.unlock(file, options, (err) => {
                if (err) {
                    // If the lockfile doesn't exist, treat as success
                    if (err.code === 'ENOENT') {
                        return resolve();
                    }
                    // If the lock is not acquired, reject with error
                    if (err.code === 'ENOTACQUIRED') {
                        return reject(err);
                    }
                    return reject(err);
                }
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
        // TODO: Implement Redis-backed lock acquisition
        throw new Error('RedisBackend.acquire is not implemented yet.');
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

module.exports = { BackendManager };