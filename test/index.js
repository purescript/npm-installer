'use strict';

const fs = require('fs');
const {execFile} = require('child_process');
const util = require('util');
const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const {tmpdir} = require('os');
const {join} = require('path');

const installPurescript = require('../install-purescript/index.js');

const cacheRootDir = ".test-cache";
const originalCwd = process.cwd();
let testDir;
let cachePath;
const cachePaths = new Map();

before(async () => {
	testDir = await fs.promises.mkdtemp(join(tmpdir(), 'installer-test-'));
	process.chdir(testDir);
});
after(async () => {
	process.chdir(originalCwd);
	await fs.promises.rm(testDir, {recursive: true, force: true});
});

// Given an installPurescript observable, return a promise which resolves to a
// summary of the events which occurred during installation (i.e. without
// repeated events).
function summarizeEvents(observable) {
	let lastEventId;
	const uniqEvents = [];

	return new Promise((resolve, reject) => {
		observable.subscribe({
			next(event) {
				if (event.id !== lastEventId) {
					uniqEvents.push(event);
				}
				lastEventId = event.id;
			},
			error(err) {
				reject(err);
			},
			complete() {
				resolve(uniqEvents);
			}
		});
	});
};

function assertEvents(_found, _expected) {
	const found = _found.slice();
	const expected = _expected.slice();

	while (found.length > 0 && expected.length > 0) {
		const next = found.shift();
		if (next.id == expected[0].id) {
			const nextExpected = expected.shift();
			for (const [key, value] of Object.entries(nextExpected)) {
				assert.deepEqual(next[key], value, `received ${next.id} event: ${key}`);
			}
		}
	}

	assert.deepEqual(expected, [], 'received all expected events');
}

// return a promise which resolves once the given file has been unlinked,
// swallowing ENOENT errors (which indicate the file never existed in the first
// place).
async function unlinkIfExists(path) {
	try {
		await fs.promises.unlink(path);
	} catch(err) {
		if (err.code !== 'ENOENT') {
			throw err;
		}
	}
}

function testInstall(version, expectedEvents) {
	return (async () => {
		await unlinkIfExists('./purs');
		const events = await summarizeEvents(installPurescript({
			cacheRootDir,
			version
		}));
		assertEvents(events, expectedEvents);
		const cached = events.find(event => event.id === 'write-cache:complete');
		if (cached) {
			cachePath = cached.path;
			cachePaths.set(version, cachePath);
		}
		const {stdout} = await util.promisify(execFile)('./purs', ['--version'], {timeout: 1000});
		assert.equal(stdout.trim(), version);
	});
}

// Stable release versions from PR #42; keep the prerelease case below as well.
test('clean install', testInstall('0.15.7', [
	{ id: 'search-cache', found: false },
	{ id: 'download-binary' },
	{ id: 'check-binary' },
	{ id: 'write-cache:complete' }
]));

test('install from cache', testInstall('0.15.7', [
	{ id: 'search-cache', found: true },
	{ id: 'restore-cache' },
	{ id: 'check-binary' }
]));

test('recover from corrupt cache', async () => {
	await fs.promises.writeFile(cachePath, 'not a compiler');
	await testInstall('0.15.7', [
		{ id: 'search-cache', found: true },
		{ id: 'check-binary:fail' },
		{ id: 'download-binary' },
		{ id: 'write-cache:complete' }
	])();
	await testInstall('0.15.7', [
		{ id: 'search-cache', found: true },
		{ id: 'restore-cache:complete' },
		{ id: 'check-binary:complete' }
	])();
});

test('install a different version', testInstall('0.15.6', [
	{ id: 'search-cache', found: false },
	{ id: 'download-binary' },
	{ id: 'check-binary' },
	{ id: 'write-cache:complete' }
]));

test('install a different version from cache', testInstall('0.15.6', [
	{ id: 'search-cache', found: true },
	{ id: 'restore-cache' },
	{ id: 'check-binary' }
]));

test('reject a working cached binary of the wrong version', async () => {
	await fs.promises.copyFile('./purs', cachePaths.get('0.15.7'));
	await testInstall('0.15.7', [
		{ id: 'search-cache', found: true },
		{ id: 'check-binary:fail' },
		{ id: 'download-binary' },
		{ id: 'write-cache:complete' }
	])();
});

test('switch back to a cached version', testInstall('0.15.7', [
	{ id: 'search-cache', found: true },
	{ id: 'restore-cache' },
	{ id: 'check-binary:complete' }
]));

test('install a prerelease', testInstall('0.15.0-alpha-06', [
	{ id: 'search-cache', found: false },
	{ id: 'download-binary' },
	{ id: 'check-binary' },
	{ id: 'write-cache:complete' }
]));

test('concurrent writers publish a reusable cache entry', async () => {
	await Promise.all(['purs-a', 'purs-b'].map(async name => {
		const events = await summarizeEvents(installPurescript({
			cacheRootDir,
			version: '0.15.7',
			forceReinstall: true,
			rename: () => name
		}));
		assertEvents(events, [{id: 'write-cache:complete'}]);
		const {stdout} = await util.promisify(execFile)(`./${name}`, ['--version']);
		assert.equal(stdout.trim(), '0.15.7');
	}));
	assert.equal((await fs.promises.readdir(cacheRootDir)).some(name => name.endsWith('.tmp')), false);
	await testInstall('0.15.7', [
		{ id: 'search-cache', found: true },
		{ id: 'restore-cache:complete' },
		{ id: 'check-binary:complete' }
	])();
});

test('cache write failure does not fail installation', async () => {
	await fs.promises.writeFile('blocked-cache', 'not a directory');
	const events = await summarizeEvents(installPurescript({
		cacheRootDir: 'blocked-cache',
		version: '0.15.7',
		forceReinstall: true
	}));
	assertEvents(events, [{id: 'write-cache:fail'}]);
	const {stdout} = await util.promisify(execFile)('./purs', ['--version']);
	assert.equal(stdout.trim(), '0.15.7');
});
