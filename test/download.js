'use strict';

const {test, before, after} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const {once} = require('node:events');
const {join} = require('node:path');
const {tmpdir} = require('node:os');
const {execFile} = require('node:child_process');
const {promisify} = require('node:util');
const tar = require('tar');
const download = require('../dl-tar');

let directory;
let archive;
let server;
let baseUrl;
let attempts = 0;

before(async () => {
	directory = await fs.mkdtemp(join(tmpdir(), 'installer-download-'));
	await fs.mkdir(join(directory, 'package'));
	await fs.writeFile(join(directory, 'package', 'payload'), 'archive payload');
	await tar.create({cwd: directory, file: join(directory, 'archive.tgz'), gzip: true}, ['package']);
	archive = await fs.readFile(join(directory, 'archive.tgz'));
	server = http.createServer((request, response) => {
		if (request.url === '/redirect') {
			response.writeHead(302, {location: '/archive'}).end();
		} else if (request.url === '/retry' && ++attempts === 1) {
			response.writeHead(503).end();
		} else if (request.url === '/missing') {
			response.writeHead(404).end();
		} else if (request.url === '/invalid') {
			response.end('not an archive');
		} else if (request.url === '/pending') {
			// Wait for cancellation before sending any headers.
		} else if (request.url === '/streaming') {
			response.writeHead(200);
			response.write(archive.subarray(0, -8));
		} else {
			response.writeHead(200, {'x-received-header': request.headers['x-test'] || ''});
			response.end(archive);
		}
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
	server.closeAllConnections();
	await new Promise(resolve => server.close(resolve));
	await fs.rm(directory, {recursive: true, force: true});
});

function extract(url, destination, options) {
	return new Promise((resolve, reject) => {
		const progress = [];
		download(url, destination, options).subscribe({
			next: event => progress.push(event),
			error: reject,
			complete: () => resolve(progress)
		});
	});
}

test('redirects, request headers, extraction and progress', async () => {
	const destination = join(directory, 'redirect-result');
	const progress = await extract('/redirect', destination, {baseUrl, headers: {'x-test': 'preserved'}});
	assert.equal(await fs.readFile(join(destination, 'payload'), 'utf8'), 'archive payload');
	assert.ok(progress.length > 0);
	const last = progress.at(-1).response;
	assert.equal(last.url, `${baseUrl}/archive`);
	assert.equal(last.headers.get('x-received-header'), 'preserved');
	assert.equal(last.bytes, archive.length);
});

test('retries transient HTTP errors', async () => {
	const destination = join(directory, 'retry-result');
	await extract(`${baseUrl}/retry`, destination);
	assert.equal(attempts, 2);
	assert.equal(await fs.readFile(join(destination, 'payload'), 'utf8'), 'archive payload');
});

test('reports HTTP and extraction failures', async () => {
	await assert.rejects(extract(`${baseUrl}/missing`, join(directory, 'missing-result')), /404 Not Found/);
	await assert.rejects(extract(`${baseUrl}/invalid`, join(directory, 'invalid-result')), /Unrecognized archive format/);
});

for (const state of ['pending', 'streaming']) {
	test(`unsubscribe closes a ${state} request`, async () => {
		const received = once(server, 'request');
		let notifications = 0;
		let progressed;
		const progress = new Promise(resolve => { progressed = resolve; });
		const subscription = download(`${baseUrl}/${state}`, join(directory, state)).subscribe({
			next: () => { notifications++; progressed(); },
			error: () => notifications++,
			complete: () => notifications++
		});
		const [request] = await received;
		if (state === 'streaming') await progress;
		const beforeCancel = notifications;
		const closed = new Promise(resolve => request.socket.once('close', resolve));
		subscription.unsubscribe();
		await closed;
		assert.equal(notifications, beforeCancel);
	});
}

test('honors HTTP_PROXY and NO_PROXY', async t => {
	let connections = 0;
	const proxy = http.createServer((request, response) => {
		connections++;
		const upstream = http.request(request.url, {headers: request.headers}, incoming => {
			response.writeHead(incoming.statusCode, incoming.headers);
			incoming.pipe(response);
		});
		upstream.on('error', error => response.destroy(error));
		request.pipe(upstream);
	});
	proxy.listen(0, '127.0.0.1');
	await once(proxy, 'listening');
	t.after(async () => {
		proxy.closeAllConnections();
		await new Promise(resolve => proxy.close(resolve));
	});
	const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;
	for (const bypass of ['', '127.0.0.1']) {
		const destination = join(directory, bypass ? 'bypassed' : 'proxied');
		const {stderr} = await promisify(execFile)(process.execPath, ['-e', `
			const download = require(${JSON.stringify(require.resolve('../dl-tar'))});
			download(process.argv[1], process.argv[2]).subscribe({
				error(error) { console.error(error); process.exitCode = 1; }
			});
		`, `${baseUrl}/archive`, destination], {
			timeout: 10000,
			env: {...process.env, HTTP_PROXY: proxyUrl, http_proxy: proxyUrl, NO_PROXY: bypass, no_proxy: bypass}
		});
		assert.equal(stderr, '');
		assert.equal(await fs.readFile(join(destination, 'payload'), 'utf8'), 'archive payload');
		assert.equal(connections, 1, 'proxy used once, then bypassed');
	}
});
