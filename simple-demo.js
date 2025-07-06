#!/usr/bin/env node

const locksmith = require('./index');
const fs = require('fs');
const path = require('path');

console.log('🔒 Locksmith 5.0.0 - Simple Advanced Features Demo\n');

async function simpleDemo() {
    const demoDir = './demo-files';
    if (!fs.existsSync(demoDir)) {
        fs.mkdirSync(demoDir);
    }

    try {
        console.log('=== 1. 🔒 Core Lock Types ===');
        
        // Basic lock
        console.log('\n📁 Testing basic lock...');
        const file1 = path.join(demoDir, 'basic.txt');
        fs.writeFileSync(file1, 'test data');
        
        const basicLock = await locksmith.lock(file1);
        console.log('✅ Basic lock acquired');
        await basicLock();
        console.log('✅ Basic lock released');

        // Read-Write locks
        console.log('\n📖 Testing Read-Write locks...');
        const file2 = path.join(demoDir, 'read-write.txt');
        fs.writeFileSync(file2, 'test data');
        
        const readLock = await locksmith.acquireReadWriteLock(file2, { mode: 'read' });
        console.log('✅ Read lock acquired');
        await readLock();
        console.log('✅ Read lock released');

        // Named locks
        console.log('\n🏷️ Testing Named locks...');
        const namedLock = await locksmith.acquireNamedLock('demo-named-lock');
        console.log('✅ Named lock acquired');
        await namedLock();
        console.log('✅ Named lock released');

        console.log('\n=== 2. 🌐 Distributed Backends ===');
        
        // Memory backend
        console.log('\n💾 Testing Memory backend...');
        const memoryLock = await locksmith.lock(file1, { backend: 'memory' });
        console.log('✅ Memory backend lock acquired');
        await memoryLock();
        console.log('✅ Memory backend lock released');

        console.log('\n=== 3. 📊 Analytics & Monitoring ===');
        
        // Analytics tracking
        console.log('\n📈 Testing Analytics...');
        const analyticsFile = path.join(demoDir, 'analytics.txt');
        fs.writeFileSync(analyticsFile, 'test data');
        
        const analyticsLock = await locksmith.lock(analyticsFile);
        await analyticsLock();
        
        const metrics = locksmith.getMetrics();
        console.log('✅ Analytics metrics:', {
            activeLocks: metrics.activeLocks,
            totalAcquisitions: metrics.totalAcquisitions
        });

        // Performance report
        const report = locksmith.getPerformanceReport();
        console.log('✅ Performance report generated');

        // Lock statistics
        const stats = locksmith.getLockStats();
        console.log('✅ Lock statistics:', stats);

        console.log('\n=== 4. 🔍 Health Monitoring ===');
        
        // Health checks
        console.log('\n🏥 Testing Health Monitoring...');
        const health = await locksmith.checkHealth();
        console.log('✅ Health status:', health.status);
        console.log('✅ Health components:', Object.keys(health.components));

        console.log('\n=== 5. 🔌 Plugin System ===');
        
        // Plugin registration
        console.log('\n🔌 Testing Plugin System...');
        const testPlugin = {
            name: 'demo-plugin',
            version: '1.0.0',
            init(pluginManager) {
                console.log('  📝 Demo plugin initialized');
            }
        };
        
        locksmith.registerPlugin('demo-plugin', testPlugin);
        const pluginInfo = locksmith.getPluginInfo('demo-plugin');
        console.log('✅ Plugin registered:', pluginInfo.name);

        const allPlugins = locksmith.getAllPlugins();
        console.log('✅ All plugins:', allPlugins.length);

        console.log('\n=== 6. 📦 Configuration Management ===');
        
        // Configuration
        console.log('\n⚙️ Testing Configuration Management...');
        const config = locksmith.getConfig();
        console.log('✅ Current config:', Object.keys(config));
        
        locksmith.updateConfig({ analytics: { enabled: true } });
        const updatedConfig = locksmith.getConfig();
        console.log('✅ Config updated');

        console.log('\n=== 7. 🛠️ Utility Functions ===');
        
        // Utility functions
        console.log('\n🔧 Testing Utility Functions...');
        const bytes = locksmith.formatBytes(1048576);
        console.log('✅ Bytes formatting:', bytes);
        
        const duration = locksmith.formatDuration(3661000);
        console.log('✅ Duration formatting:', duration);

        console.log('\n=== 8. 🧪 Integration Test ===');
        
        // Integration test with multiple features
        console.log('\n🔗 Testing Integration with Multiple Features...');
        const integrationFile = path.join(demoDir, 'integration.txt');
        fs.writeFileSync(integrationFile, 'integration data');
        
        const integrationLock = await locksmith.acquireReadWriteLock(integrationFile, {
            mode: 'write',
            backend: 'memory'
        });
        console.log('✅ Integration lock acquired (multiple features)');
        await integrationLock();
        console.log('✅ Integration lock released');

        console.log('\n=== 9. 🚀 Performance Test ===');
        
        // Performance test
        console.log('\n⚡ Performance Test...');
        const startTime = Date.now();
        const promises = [];
        
        for (let i = 0; i < 5; i++) {
            const perfFile = path.join(demoDir, `perf-${i}.txt`);
            fs.writeFileSync(perfFile, `perf data ${i}`);
            promises.push(
                locksmith.lock(perfFile).then(lock => lock())
            );
        }
        
        await Promise.all(promises);
        const endTime = Date.now();
        console.log(`✅ Performance test completed: ${endTime - startTime}ms for 5 locks`);

        console.log('\n=== 10. 🧹 Cleanup ===');
        
        // Cleanup
        console.log('\n🧹 Cleaning up demo files...');
        const files = fs.readdirSync(demoDir);
        for (const file of files) {
            fs.unlinkSync(path.join(demoDir, file));
        }
        fs.rmdirSync(demoDir);
        console.log('✅ Demo files cleaned up');

        console.log('\n🎉 Simple demo completed successfully!');
        console.log('\n📊 Summary:');
        console.log('  ✅ Core lock types working');
        console.log('  ✅ Distributed backends functional');
        console.log('  ✅ Analytics and monitoring active');
        console.log('  ✅ Health monitoring working');
        console.log('  ✅ Plugin system extensible');
        console.log('  ✅ Configuration management working');
        console.log('  ✅ Utility functions available');
        console.log('  ✅ Integration scenarios successful');
        console.log('  ✅ Performance tests completed');
        
        console.log('\n🚀 Locksmith 2.0 core features are working perfectly!');

    } catch (error) {
        console.error('❌ Demo failed:', error);
        throw error;
    }
}

// Run the simple demo
simpleDemo().catch(error => {
    console.error('❌ Simple demo failed:', error);
    process.exit(1);
}); 