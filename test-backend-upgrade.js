const locksmith = require('./index.js');

async function testBackendUpgrade() {
    try {
        const file = 'backend-upgrade-test.txt';
        
        // Create file first
        require('fs').writeFileSync(file, 'test content');
        
        console.log('Acquiring read lock with memory backend...');
        // Acquire read lock with memory backend
        const readLock = await locksmith.acquireReadWriteLock(file, { 
            mode: 'read',
            backend: 'memory'
        });
        
        console.log('Read lock acquired successfully');
        
        console.log('Upgrading to write lock...');
        // Upgrade to write lock with same backend
        const writeLock = await locksmith.upgradeToWrite(file, { backend: 'memory' });
        
        console.log('Write lock acquired successfully');
        
        // Verify the upgrade worked
        console.log('Write lock is function:', typeof writeLock === 'function');
        
        // Release the write lock
        await writeLock();
        console.log('Write lock released successfully');
        
        console.log('Test passed!');
    } catch (error) {
        console.error('Test failed:', error.message);
        console.error(error.stack);
    }
}

testBackendUpgrade(); 