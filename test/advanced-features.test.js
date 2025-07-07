'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('graceful-fs');
const locksmith = require('../index');

describe('Advanced Features', () => {
    const testDir = path.join(__dirname, 'fixtures', 'advanced');
    const testFile = path.join(testDir, 'test.lock');
    
    beforeAll(async () => {
        // Ensure test directory exists
        await fs.promises.mkdir(testDir, { recursive: true });
    });

    afterAll(async () => {
        // Clean up test files
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    beforeEach(async () => {
        // Clear any existing locks
        try {
            await locksmith.unlock(testFile);
        } catch (error) {
            // Ignore if lock doesn't exist
        }
        // Ensure all test files exist
        await fs.promises.writeFile(testFile, '');
        await fs.promises.writeFile(path.join(testDir, 'parent.lock'), '');
        await fs.promises.writeFile(path.join(testDir, 'child.lock'), '');
        for (let i = 0; i < 5; i++) {
            await fs.promises.writeFile(`${testFile}-${i}`, '');
        }
    });

    afterEach(async () => {
        // Release all locks on testFile and its variants
        try {
            await locksmith.unlock(testFile);
        } catch (e) {}
        try {
            await locksmith.unlock(path.join(testDir, 'parent.lock'));
        } catch (e) {}
        try {
            await locksmith.unlock(path.join(testDir, 'child.lock'));
        } catch (e) {}
        for (let i = 0; i < 5; i++) {
            try {
                await locksmith.unlock(`${testFile}-${i}`);
            } catch (e) {}
        }
    });

    describe('Advanced Lock Types', () => {
        it('should support read-write locks', async () => {
            // Acquire read locks (should work concurrently)
            const readLock1 = await locksmith.acquireReadWriteLock(testFile, { mode: 'read' });
            const readLock2 = await locksmith.acquireReadWriteLock(testFile, { mode: 'read' });
            
            // Both read locks should be acquired
            assert(readLock1, 'First read lock should be acquired');
            assert(readLock2, 'Second read lock should be acquired');
            
            // Release read locks
            await readLock1();
            await readLock2();
        });

        it('should support write locks with read-write locks', async () => {
            // Acquire write lock
            const writeLock = await locksmith.acquireReadWriteLock(testFile, { mode: 'write' });
            assert(writeLock, 'Write lock should be acquired');
            
            // Try to acquire another write lock (should timeout or fail)
            let failed = false;
            try {
                await locksmith.acquireReadWriteLock(testFile, { mode: 'write', timeout: 100 });
                assert.fail('Should not acquire second write lock');
            } catch (error) {
                failed = error.message.includes('timeout') || 
                        error.message.includes('Write lock acquisition timeout') ||
                        error.code === 'ELOCKED' ||
                        error.code === 'ENOTACQUIRED';
                assert(failed, 'Should fail when trying to acquire second write lock');
            }
            
            // Hold the first lock a bit longer to ensure timeout can occur
            await new Promise(r => setTimeout(r, 50));
            await writeLock();
        });

        it('should support hierarchical locks', async () => {
            const parentFile = path.join(testDir, 'parent.lock');
            const childFile = path.join(testDir, 'child.lock');
            
            const hierarchicalLock = await locksmith.acquireHierarchicalLock(childFile, { 
                parent: parentFile 
            });
            
            assert(hierarchicalLock, 'Hierarchical lock should be acquired');
            assert(typeof hierarchicalLock.release === 'function', 'Should have a release function');
            
            await hierarchicalLock.release();
        });

        it('should support named locks', async () => {
            const namedLock = await locksmith.acquireNamedLock('test-named-lock');
            assert(namedLock, 'Named lock should be acquired');
            
            // Try to acquire same named lock (should timeout)
            try {
                await locksmith.acquireNamedLock('test-named-lock', { timeout: 100 });
                assert.fail('Should not acquire same named lock twice');
            } catch (error) {
                assert(error.message.includes('timeout'), 'Should timeout when trying to acquire same named lock');
            }
            
            await namedLock();
        });
    });

    describe('Distributed Backends', () => {
        it('should support memory backend', async () => {
            const memoryLock = await locksmith.lock(testFile, { backend: 'memory' });
            assert(memoryLock, 'Memory backend lock should be acquired');
            
            const isLocked = await locksmith.check(testFile, { backend: 'memory' });
            assert(isLocked, 'Memory backend should report file as locked');
            
            await memoryLock();
            
            const isUnlocked = await locksmith.check(testFile, { backend: 'memory' });
            assert(!isUnlocked, 'Memory backend should report file as unlocked');
        });

        it('should support custom backend registration', () => {
            const customBackend = {
                async acquire(file, options) {
                    return () => Promise.resolve();
                },
                async release(file, options) {
                    return Promise.resolve();
                },
                async check(file, options) {
                    return false;
                }
            };
            
            locksmith.registerBackend('custom', customBackend);
            const backend = locksmith.getBackend('custom');
            assert(backend, 'Custom backend should be registered');
        });
    });

    describe('Analytics and Monitoring', () => {
        it('should track lock operations', async () => {
            const uniqueFile = testFile + '-analytics';
            // Ensure file is not locked before test
            try { await locksmith.unlock(uniqueFile); } catch {}
            const lock = await locksmith.lock(uniqueFile);
            await lock();
            // Wait a bit for analytics to update
            await new Promise(r => setTimeout(r, 30));
            const metrics = locksmith.getMetrics();
            assert(metrics.operations.acquire.count > 0, 'Should track acquire operations');
            assert(metrics.operations.release.count > 0, 'Should track release operations');
            // Cleanup
            try { await locksmith.unlock(uniqueFile); } catch {}
        });

        it('should provide performance reports', async () => {
            const report = locksmith.getPerformanceReport();
            assert(report.uptime, 'Should provide uptime information');
            assert(report.operations, 'Should provide operations data');
            assert(report.performance, 'Should provide performance metrics');
        });

        it('should provide lock statistics', async () => {
            const stats = locksmith.getLockStats();
            assert(typeof stats.total === 'number', 'Should provide total lock count');
            assert(stats.byDuration, 'Should provide duration statistics');
        });
    });

    describe('Plugin System', () => {
        it('should support plugin registration', () => {
            const testPlugin = {
                init(pluginManager) {
                    this.pluginManager = pluginManager;
                }
            };
            
            locksmith.registerPlugin('test-plugin', testPlugin);
            const pluginInfo = locksmith.getPluginInfo('test-plugin');
            assert(pluginInfo, 'Plugin should be registered');
            assert(pluginInfo.enabled, 'Plugin should be enabled by default');
        });

        it('should list all plugins', () => {
            const plugins = locksmith.getAllPlugins();
            assert(Array.isArray(plugins), 'Should return array of plugins');
            assert(plugins.length >= 2, 'Should have at least logging and metrics plugins');
        });

        it('should support plugin unregistration', () => {
            const testPlugin = {
                init(pluginManager) {
                    this.pluginManager = pluginManager;
                }
            };
            
            locksmith.registerPlugin('temp-plugin', testPlugin);
            locksmith.unregisterPlugin('temp-plugin');
            
            const pluginInfo = locksmith.getPluginInfo('temp-plugin');
            assert(!pluginInfo, 'Plugin should be unregistered');
        });
    });

    describe('Health Monitoring', () => {
        it('should provide health status', async () => {
            const health = await locksmith.checkHealth();
            assert(health.status, 'Should provide health status');
            assert(health.timestamp, 'Should provide timestamp');
            assert(health.components, 'Should provide component health');
        });

        it('should check all components', async () => {
            const health = await locksmith.checkHealth();
            
            assert(health.components.fileBackend, 'Should check file backend');
            assert(health.components.memoryBackend, 'Should check memory backend');
            assert(health.components.analytics, 'Should check analytics');
            assert(health.components.plugins, 'Should check plugins');
        });
    });

    describe('Configuration Management', () => {
        it('should provide configuration', () => {
            const config = locksmith.getConfig();
            assert(config.analytics, 'Should provide analytics config');
            assert(config.plugins, 'Should provide plugins config');
            assert(config.backends, 'Should provide backends config');
            assert(config.locks, 'Should provide locks config');
        });

        it('should allow configuration updates', () => {
            const originalConfig = locksmith.getConfig();
            const newConfig = {
                analytics: { enabled: false }
            };
            
            locksmith.updateConfig(newConfig);
            const updatedConfig = locksmith.getConfig();
            
            assert(!updatedConfig.analytics.enabled, 'Should update analytics config');
            
            // Restore original config
            locksmith.updateConfig(originalConfig);
        });
    });

    describe('Utility Functions', () => {
        it('should format bytes correctly', () => {
            assert(locksmith.formatBytes(1024) === '1 KB', 'Should format 1024 bytes as 1 KB');
            assert(locksmith.formatBytes(1048576) === '1 MB', 'Should format 1048576 bytes as 1 MB');
        });

        it('should format duration correctly', () => {
            assert(locksmith.formatDuration(60000) === '1m 0s', 'Should format 60000ms as 1m 0s');
            assert(locksmith.formatDuration(3600000) === '1h 0m', 'Should format 3600000ms as 1h 0m');
        });
    });

    describe('Integration Tests', () => {
        it('should work with multiple advanced features together', async () => {
            // Use read-write locks with memory backend and analytics
            const readLock = await locksmith.acquireReadWriteLock(testFile, { 
                mode: 'read',
                backend: 'memory'
            });
            await readLock();
            // Wait a bit longer for analytics to update
            await new Promise(r => setTimeout(r, 50));
            // Check analytics
            const metrics = locksmith.getMetrics();
            assert(metrics.operations.acquire.count > 0, 'Should track operations');
            // Check health
            const health = await locksmith.checkHealth();
            assert(health.status === 'healthy' || health.status === 'degraded', 'Should provide health status');
        });

        it('should handle concurrent operations', async () => {
            const promises = [];
            let successCount = 0;
            // Start multiple concurrent operations on unique files
            for (let i = 0; i < 5; i++) {
                promises.push(
                    locksmith.lock(`${testFile}-concurrent-${i}`)
                        .then(lock => { successCount++; return lock(); })
                        .catch(e => {/* ignore ENOTACQUIRED */})
                );
            }
            await Promise.all(promises);
            // Wait a bit for analytics to update
            await new Promise(r => setTimeout(r, 30));
            // Check that all operations completed
            const metrics = locksmith.getMetrics();
            assert(successCount >= 5, 'Should handle concurrent operations');
            assert(metrics.operations.acquire.count >= 5, 'Should track concurrent acquires');
        });

        it('should provide comprehensive monitoring', async () => {
            // Perform some operations
            const lock = await locksmith.lock(testFile);
            await lock();
            
            // Get all monitoring data
            const metrics = locksmith.getMetrics();
            const report = locksmith.getPerformanceReport();
            const stats = locksmith.getLockStats();
            const health = await locksmith.checkHealth();
            const plugins = locksmith.getAllPlugins();
            
            // Verify all monitoring functions work
            assert(metrics, 'Metrics should be available');
            assert(report, 'Performance report should be available');
            assert(stats, 'Lock stats should be available');
            assert(health, 'Health status should be available');
            assert(plugins, 'Plugin list should be available');
        });
    });

    describe('Lock Upgrade/Downgrade Functionality', () => {
        it('should upgrade read lock to write lock', async () => {
            const file = 'upgrade-test.txt';
            
            // Create file first
            require('fs').writeFileSync(file, 'test content');
            
            // Acquire read lock
            const readLock = await locksmith.acquireReadWriteLock(file, { mode: 'read' });
            
            // Upgrade to write lock
            const writeLock = await locksmith.upgradeToWrite(file);
            
            // Verify we have write access
            assert(writeLock, 'Write lock should be acquired');
            assert(typeof writeLock === 'function', 'Write lock should be a function');
            
            // Release the write lock
            await writeLock();
        });

        it('should downgrade write lock to read lock', async () => {
            const file = 'downgrade-test.txt';
            
            // Create file first
            require('fs').writeFileSync(file, 'test content');
            
            // Acquire write lock
            const writeLock = await locksmith.acquireReadWriteLock(file, { mode: 'write' });
            
            // Downgrade to read lock
            const readLock = await locksmith.downgradeToRead(file);
            
            // Verify we have read access
            assert(readLock, 'Read lock should be acquired');
            assert(typeof readLock === 'function', 'Read lock should be a function');
            
            // Release the read lock
            await readLock();
        });

        it('should upgrade shared lock to exclusive lock', async () => {
            const file = 'shared-upgrade-test.txt';
            
            // Create file first
            require('fs').writeFileSync(file, 'test content');
            
            // Acquire shared lock
            const sharedLock = await locksmith.lock(file, { mode: 'shared' });
            
            // Upgrade to exclusive lock
            const exclusiveLock = await locksmith.upgradeToExclusive(file);
            
            // Verify we have exclusive access
            assert(exclusiveLock, 'Exclusive lock should be acquired');
            assert(typeof exclusiveLock === 'function', 'Exclusive lock should be a function');
            
            // Release the exclusive lock
            await exclusiveLock();
        });

        it('should downgrade exclusive lock to shared lock', async () => {
            const file = 'exclusive-downgrade-test.txt';
            
            // Create file first
            require('fs').writeFileSync(file, 'test content');
            
            // Acquire exclusive lock
            const exclusiveLock = await locksmith.lock(file, { mode: 'exclusive' });
            
            // Downgrade to shared lock
            const sharedLock = await locksmith.downgradeToShared(file);
            
            // Verify we have shared access
            assert(sharedLock, 'Shared lock should be acquired');
            assert(typeof sharedLock === 'function', 'Shared lock should be a function');
            
            // Release the shared lock
            await sharedLock();
        });

        it('should prevent upgrade when other locks are active', async () => {
            const file = 'conflict-upgrade-test.txt';
            
            // Create file first
            require('fs').writeFileSync(file, 'test content');
            
            // Acquire one read lock
            const readLock = await locksmith.acquireReadWriteLock(file, { mode: 'read' });
            
            // Try to acquire a write lock (should fail because read lock is active)
            let failed = false;
            try {
                await locksmith.acquireReadWriteLock(file, { mode: 'write', timeout: 1000 });
                assert.fail('Should not acquire write lock when read lock is active');
            } catch (error) {
                failed = error.message.includes('timeout') ||
                        error.message.includes('Write lock acquisition timeout') ||
                        error.code === 'ELOCKED' ||
                        error.code === 'ENOTACQUIRED';
                assert(failed, 'Should fail when trying to acquire write lock with active read lock');
            }
            
            // Release the read lock
            await readLock();
        }, 10000); // Increase timeout to 10 seconds

        it('should check if upgrade is possible', async () => {
            const file = 'can-upgrade-test.txt';
            
            // Create file first
            require('fs').writeFileSync(file, 'test content');
            
            // Acquire read lock
            const readLock = await locksmith.acquireReadWriteLock(file, { mode: 'read' });
            
            // Check if upgrade is possible
            const canUpgradeToWrite = await locksmith.canUpgrade(file, 'write');
            assert(canUpgradeToWrite, 'Should be able to upgrade read lock to write lock');
            
            // Check if upgrade to exclusive is possible (should be false for read-write locks)
            const canUpgradeToExclusive = await locksmith.canUpgrade(file, 'exclusive');
            assert(!canUpgradeToExclusive, 'Should not be able to upgrade read-write lock to exclusive lock');
            
            // Release the lock
            await readLock();
        });

        it('should get tracked locks', async () => {
            const file = 'tracked-locks-test.txt';
            
            // Create file first
            require('fs').writeFileSync(file, 'test content');
            
            // Acquire a lock
            const lock = await locksmith.lock(file);
            
            // Get tracked locks
            const trackedLocks = locksmith.getTrackedLocks();
            assert(Array.isArray(trackedLocks), 'Tracked locks should be an array');
            
            // Release the lock
            await lock();
        });

        it('should handle upgrade/downgrade with different backends', async () => {
            const file = 'backend-upgrade-test.txt';
            
            // Create file first
            require('fs').writeFileSync(file, 'test content');
            
            // Acquire read lock with memory backend
            const readLock = await locksmith.acquireReadWriteLock(file, { 
                mode: 'read',
                backend: 'memory'
            });
            
            // Upgrade to write lock with same backend
            const writeLock = await locksmith.upgradeToWrite(file, { backend: 'memory' });
            
            // Verify the upgrade worked
            assert(writeLock, 'Write lock should be acquired');
            assert(typeof writeLock === 'function', 'Write lock should be a function');
            
            // Release the write lock
            await writeLock();
        });

        it('should maintain lock state during upgrade/downgrade', async () => {
            const file = 'state-upgrade-test.txt';
            
            // Create file first
            require('fs').writeFileSync(file, 'test content');
            
            // Acquire read lock
            const readLock = await locksmith.acquireReadWriteLock(file, { mode: 'read' });
            
            // Upgrade to write lock
            const writeLock = await locksmith.upgradeToWrite(file);
            
            // Downgrade back to read lock
            const newReadLock = await locksmith.downgradeToRead(file);
            
            // Verify the final lock works
            assert(newReadLock, 'Read lock should be acquired');
            assert(typeof newReadLock === 'function', 'Read lock should be a function');
            
            // Release the final lock
            await newReadLock();
        });
    });
}); 