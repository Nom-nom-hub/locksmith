'use strict';

const fs = require('graceful-fs');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const lockfile = require('../');

const tmpDir = `${__dirname}/tmp`;

beforeAll(() => mkdirp.sync(tmpDir));
afterAll(() => { try { rimraf.sync(tmpDir); } catch (e) {} });
beforeEach(() => {
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    try { fs.writeFileSync(`${tmpDir}/foo`, ''); } catch (e) {}
});
afterEach(() => {
    try {
        const files = fs.readdirSync(tmpDir);
        for (const file of files) rimraf.sync(`${tmpDir}/${file}`);
    } catch (e) {}
});

describe('LockSmith basic API', () => {
    it('acquires and releases a lock', async () => {
        const release = await lockfile.lock(`${tmpDir}/foo`);
        expect(typeof release).toBe('function');
        await release();
    });

    it('fails if already locked', async () => {
        const release = await lockfile.lock(`${tmpDir}/foo`);
        await expect(lockfile.lock(`${tmpDir}/foo`)).rejects.toHaveProperty('code', 'ELOCKED');
        await release();
    });

    it('can re-lock after release', async () => {
        const release = await lockfile.lock(`${tmpDir}/foo`);
        await release();
        const release2 = await lockfile.lock(`${tmpDir}/foo`);
        await release2();
    });

    it('errors if file does not exist', async () => {
        await expect(lockfile.lock(`${tmpDir}/does-not-exist`)).rejects.toHaveProperty('code', 'ENOENT');
    });

    it('creates lockfile inside a folder', async () => {
        fs.mkdirSync(`${tmpDir}/foo-dir`);
        const release = await lockfile.lock(`${tmpDir}/foo-dir`, { lockfilePath: `${tmpDir}/foo-dir/dir.lock` });
        expect(fs.existsSync(`${tmpDir}/foo-dir/dir.lock`)).toBe(true);
        await release();
    });
});

// Add shared/exclusive lock and custom fs tests here if those are part of your public API
