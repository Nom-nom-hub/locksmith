#!/usr/bin/env node
const fs = require('graceful-fs');
const mkdirp = require('mkdirp');
const lockfile = require('./');

const tmpDir = `${__dirname}/demo-tmp`;
const fooFile = `${tmpDir}/foo`;
const fooDir = `${tmpDir}/foo-dir`;
const fooDirLock = `${fooDir}/dir.lock`;

async function main() {
    mkdirp.sync(tmpDir);
    if (!fs.existsSync(fooFile)) fs.writeFileSync(fooFile, '');
    if (!fs.existsSync(fooDir)) fs.mkdirSync(fooDir);
    
    console.log('--- DEMO: LockSmith API ---');

    // 1. Acquire and release a lock
    console.log('Acquiring lock on foo...');
    const release = await lockfile.lock(fooFile);
    console.log('Lock acquired. Releasing...');
    await release();
    console.log('Lock released.');

    // 2. Attempt to double-lock
    console.log('Acquiring lock on foo...');
    const release2 = await lockfile.lock(fooFile);
    console.log('Lock acquired. Attempting to double-lock (should fail)...');
    try {
        await lockfile.lock(fooFile);
        console.log('ERROR: Double-lock succeeded (should not happen)');
    } catch (err) {
        console.log('Double-lock failed as expected:', err.code);
    }
    await release2();
    console.log('Lock released.');

    // 3. Unlock and re-lock
    console.log('Acquiring lock on foo...');
    const release3 = await lockfile.lock(fooFile);
    console.log('Lock acquired. Releasing and re-locking...');
    await release3();
    const release4 = await lockfile.lock(fooFile);
    console.log('Re-lock acquired. Releasing...');
    await release4();
    console.log('Re-lock released.');

    // 4. Error on missing file
    console.log('Attempting to lock missing file (should fail)...');
    try {
        await lockfile.lock(`${tmpDir}/does-not-exist`);
        console.log('ERROR: Lock on missing file succeeded (should not happen)');
    } catch (err) {
        console.log('Lock on missing file failed as expected:', err.code);
    }

    // 5. Lockfile in a folder
    console.log('Acquiring lock on foo-dir with custom lockfile path...');
    const release5 = await lockfile.lock(fooDir, { lockfilePath: fooDirLock });
    console.log('Lock acquired. Lockfile exists:', fs.existsSync(fooDirLock));
    await release5();
    console.log('Lock released.');

    console.log('--- DEMO COMPLETE ---');
}

main().catch(err => {
    console.error('Demo error:', err);
    process.exit(1);
}); 