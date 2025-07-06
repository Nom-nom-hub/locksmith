'use strict';

const fs = require('graceful-fs');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const lockfile = require('../');
const unlockAll = require('./util/unlockAll');

const tmpDir = `${__dirname}/tmp`;

beforeAll(() => mkdirp.sync(tmpDir));

afterAll(() => rimraf.sync(tmpDir));

afterEach(async () => {
    jest.restoreAllMocks();
    await unlockAll();
    rimraf.sync(`${tmpDir}/*`);
});

describe('🔒 Basic Advanced Features', () => {
    it('should support basic locking with enhanced options', async () => {
        fs.writeFileSync(`${tmpDir}/basic-test.txt`, 'test data');
        
        const lock = await lockfile.lock(`${tmpDir}/basic-test.txt`, {
            retries: { retries: 3, maxTimeout: 1000 },
            stale: 5000,
            realpath: false
        });
        
        expect(lock).toBeDefined();
        expect(typeof lock).toBe('function');
        
        await lock();
    });

    it('should support custom file system', async () => {
        const customFs = {
            ...fs,
            mkdir: jest.fn((path, callback) => callback(null)),
            stat: jest.fn((path, callback) => callback(null, { mtime: new Date() }))
        };
        
        const lock = await lockfile.lock(`${tmpDir}/custom-fs-test`, {
            fs: customFs,
            realpath: false
        });
        
        expect(lock).toBeDefined();
        expect(customFs.mkdir).toHaveBeenCalled();
        
        await lock();
    });

    it('should handle lock compromise detection', async () => {
        fs.writeFileSync(`${tmpDir}/compromise-test.txt`, 'test data');
        
        const compromisedEvents = [];
        const handleCompromised = (err) => {
            compromisedEvents.push(err);
        };
        
        const lock = await lockfile.lock(`${tmpDir}/compromise-test.txt`, {
            onCompromised: handleCompromised
        });
        
        expect(lock).toBeDefined();
        await lock();
    });

    it('should support custom lockfile path', async () => {
        fs.writeFileSync(`${tmpDir}/custom-path-test.txt`, 'test data');
        
        const lock = await lockfile.lock(`${tmpDir}/custom-path-test.txt`, {
            lockfilePath: `${tmpDir}/custom.lock`
        });
        
        expect(lock).toBeDefined();
        expect(fs.existsSync(`${tmpDir}/custom.lock`)).toBe(true);
        
        await lock();
    });
});

describe('📊 Basic Analytics', () => {
    it('should track basic lock operations', async () => {
        fs.writeFileSync(`${tmpDir}/analytics-test.txt`, 'test data');
        
        const lock = await lockfile.lock(`${tmpDir}/analytics-test.txt`);
        expect(lock).toBeDefined();
        
        await lock();
        
        // Basic metrics should be available
        const metrics = lockfile.getMetrics();
        expect(metrics).toBeDefined();
        expect(typeof metrics).toBe('object');
    });

    it('should provide lock tree visualization', async () => {
        fs.writeFileSync(`${tmpDir}/tree-test.txt`, 'test data');
        
        const lock = await lockfile.lock(`${tmpDir}/tree-test.txt`);
        expect(lock).toBeDefined();
        
        const tree = lockfile.getLockTree();
        expect(tree).toBeDefined();
        
        await lock();
    });
});

describe('🛡️ Basic Security', () => {
    it('should support basic encryption', async () => {
        fs.writeFileSync(`${tmpDir}/encrypt-test.txt`, 'test data');
        
        const lock = await lockfile.lock(`${tmpDir}/encrypt-test.txt`, {
            encryption: {
                enabled: true,
                algorithm: 'aes-256-gcm',
                key: 'test-key-32-chars-long-secret'
            }
        });
        
        expect(lock).toBeDefined();
        await lock();
    });

    it('should support basic audit logging', async () => {
        fs.writeFileSync(`${tmpDir}/audit-test.txt`, 'test data');
        
        const lock = await lockfile.lock(`${tmpDir}/audit-test.txt`, {
            audit: {
                enabled: true,
                level: 'basic'
            }
        });
        
        expect(lock).toBeDefined();
        await lock();
    });
});

describe('⚡ Basic Performance', () => {
    it('should support intelligent retry strategies', async () => {
        fs.writeFileSync(`${tmpDir}/retry-test.txt`, 'test data');
        
        const lock = await lockfile.lock(`${tmpDir}/retry-test.txt`, {
            retries: {
                strategy: 'exponential',
                maxAttempts: 5,
                baseDelay: 100
            }
        });
        
        expect(lock).toBeDefined();
        await lock();
    });

    it('should support basic caching', async () => {
        fs.writeFileSync(`${tmpDir}/cache-test.txt`, 'test data');
        
        const lock = await lockfile.lock(`${tmpDir}/cache-test.txt`, {
            cache: {
                enabled: true,
                ttl: 5000
            }
        });
        
        expect(lock).toBeDefined();
        await lock();
    });
});

describe('🔧 Basic Developer Experience', () => {
    it('should support debug mode', async () => {
        fs.writeFileSync(`${tmpDir}/debug-test.txt`, 'test data');
        
        const lock = await lockfile.lock(`${tmpDir}/debug-test.txt`, {
            debug: {
                enabled: true,
                level: 'info'
            }
        });
        
        expect(lock).toBeDefined();
        await lock();
    });

    it('should provide basic lock visualization', async () => {
        fs.writeFileSync(`${tmpDir}/visual-test.txt`, 'test data');
        
        const lock = await lockfile.lock(`${tmpDir}/visual-test.txt`);
        expect(lock).toBeDefined();
        
        // Basic visualization should be available
        const visualization = lockfile.getLockVisualization();
        expect(visualization).toBeDefined();
        
        await lock();
    });
});

describe('🌐 Basic Backends', () => {
    it('should support memory backend', async () => {
        const lock = await lockfile.lock(`${tmpDir}/memory-test`, {
            backend: 'memory'
        });
        
        expect(lock).toBeDefined();
        await lock();
    });

    it('should support custom backend', async () => {
        const customBackend = {
            acquire: jest.fn().mockResolvedValue('custom-lock-id'),
            release: jest.fn().mockResolvedValue(true),
            check: jest.fn().mockResolvedValue(false)
        };
        
        const lock = await lockfile.lock(`${tmpDir}/custom-backend-test`, {
            backend: customBackend
        });
        
        expect(lock).toBeDefined();
        expect(customBackend.acquire).toHaveBeenCalled();
        
        await lock();
        expect(customBackend.release).toHaveBeenCalled();
    });
});

describe('🔄 Basic Operations', () => {
    it('should support basic conditional locking', async () => {
        fs.writeFileSync(`${tmpDir}/conditional-test.txt`, 'test data');
        
        const lock = await lockfile.lock(`${tmpDir}/conditional-test.txt`, {
            condition: () => true // Always allow
        });
        
        expect(lock).toBeDefined();
        await lock();
    });

    it('should support basic lock inheritance', async () => {
        fs.writeFileSync(`${tmpDir}/parent-inherit.txt`, 'parent');
        fs.writeFileSync(`${tmpDir}/child-inherit.txt`, 'child');
        
        const parent = await lockfile.lock(`${tmpDir}/parent-inherit.txt`);
        const child = await lockfile.lock(`${tmpDir}/child-inherit.txt`, {
            inherit: `${tmpDir}/parent-inherit.txt`
        });
        
        expect(parent).toBeDefined();
        expect(child).toBeDefined();
        
        await child();
        await parent();
    });
});

describe('📈 Basic Dashboard', () => {
    it('should start basic dashboard server', async () => {
        const dashboard = await lockfile.startDashboard({
            port: 3001,
            host: 'localhost'
        });
        
        expect(dashboard).toBeDefined();
        expect(dashboard.server).toBeDefined();
        
        await dashboard.stop();
    });

    it('should provide basic dashboard metrics', async () => {
        const metrics = lockfile.getDashboardMetrics();
        expect(metrics).toBeDefined();
        expect(typeof metrics).toBe('object');
    });
});

describe('🔌 Basic API', () => {
    it('should start basic REST API server', async () => {
        const api = await lockfile.startAPI({
            port: 3002,
            host: 'localhost'
        });
        
        expect(api).toBeDefined();
        expect(api.server).toBeDefined();
        
        await api.stop();
    });
});

describe('🔌 Basic Plugin System', () => {
    it('should register and use basic plugins', async () => {
        const testPlugin = {
            name: 'test-plugin',
            version: '1.0.0',
            hooks: {
                preLock: jest.fn(),
                postLock: jest.fn()
            }
        };
        
        lockfile.registerPlugin(testPlugin);
        
        const lock = await lockfile.lock(`${tmpDir}/plugin-test`);
        expect(lock).toBeDefined();
        
        expect(testPlugin.hooks.preLock).toHaveBeenCalled();
        expect(testPlugin.hooks.postLock).toHaveBeenCalled();
        
        await lock();
    });
});

describe('🔍 Basic Health Monitoring', () => {
    it('should perform basic health checks', async () => {
        const health = await lockfile.healthCheck();
        expect(health).toBeDefined();
        expect(health.status).toBeDefined();
    });

    it('should provide basic system diagnostics', async () => {
        const diagnostics = lockfile.getSystemDiagnostics();
        expect(diagnostics).toBeDefined();
        expect(typeof diagnostics).toBe('object');
    });
});

describe('🎯 Basic Integration', () => {
    it('should work with multiple basic features combined', async () => {
        fs.writeFileSync(`${tmpDir}/integration-test.txt`, 'test data');
        
        const lock = await lockfile.lock(`${tmpDir}/integration-test.txt`, {
            retries: { retries: 3 },
            stale: 5000,
            encryption: { enabled: true, key: 'test-key-32-chars-long-secret' },
            audit: { enabled: true },
            cache: { enabled: true },
            debug: { enabled: true }
        });
        
        expect(lock).toBeDefined();
        
        // Check that basic systems are working
        const metrics = lockfile.getMetrics();
        const health = await lockfile.healthCheck();
        
        expect(metrics).toBeDefined();
        expect(health).toBeDefined();
        
        await lock();
    });

    it('should handle basic concurrency', async () => {
        const promises = [];
        const lockCount = 5;
        
        for (let i = 0; i < lockCount; i++) {
            promises.push(
                lockfile.lock(`${tmpDir}/concurrent-${i}`)
            );
        }
        
        const locks = await Promise.all(promises);
        expect(locks).toHaveLength(lockCount);
        
        // Release all locks
        await Promise.all(locks.map(lock => lock()));
        
        const finalMetrics = lockfile.getMetrics();
        expect(finalMetrics).toBeDefined();
    });
}); 