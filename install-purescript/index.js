'use strict';

const fs = require('fs');
const { execFile } = require('child_process');
const path = require('path');
const { inspect, promisify } = require('util');
const { pipeline: pump } = require('stream');
const {createHash, randomUUID} = require('crypto');
const isPlainObj = require('is-plain-obj');
const Observable = require('zen-observable');
const envPaths = require('env-paths');

const downloadOrBuildPurescript = require('../download-or-build-purescript/index.js');
const { getBuildProfile } = require('../download-purescript/index.js');

function addId(obj, id) {
	Object.defineProperty(obj, 'id', {
		value: id,
		writable: true
	});

	return obj;
}

const defaultCacheRootDir = path.join(envPaths('purescript-npm-installer').cache, 'binaries-v1');
const defaultBinName = `purs${process.platform === 'win32' ? '.exe' : ''}`;
const cacheIdSuffix = `-${getBuildProfile()}`;

module.exports = function installPurescript(...args) {
	return new Observable(observer => {
		const argLen = args.length;

		if (argLen > 1) {
			const error = new RangeError(`Exepcted 0 or 1 argument ([<Object>]), but got ${argLen} arguments.`);

			error.code = 'ERR_TOO_MANY_ARGS';
			throw error;
		}

		const [options = {}] = args;

		if (args.length === 1) {
			if (!isPlainObj(options)) {
				throw new TypeError(`Expected an object to set install-purescript options, but got ${
					inspect(options)
				}.`);
			}

			if (options.forceReinstall !== undefined && typeof options.forceReinstall !== 'boolean') {
				throw new TypeError(`Expected \`forceReinstall\` option to be a Boolean value, but got ${
					inspect(options.forceReinstall)
				}.`);
			}
		}

		const subscriptions = new Set();

		function cancelInstallation() {
			for (const subscription of subscriptions) {
				subscription.unsubscribe();
			}
		}

		const binName = typeof options.rename === 'function' ? path.normalize(`${options.rename(defaultBinName)}`) : defaultBinName;
		const cwd = process.cwd();
		const binPath = path.join(cwd, binName);
		const cacheId = `${options.version || downloadOrBuildPurescript.defaultVersion}${cacheIdSuffix}`;
		const cacheRootDir = typeof options.cacheRootDir === 'string' ? options.cacheRootDir : defaultCacheRootDir;
		const cachePath = path.join(cacheRootDir, createHash('sha256').update(cacheId).digest('hex'));

		function main() {
			subscriptions.add(downloadOrBuildPurescript(options).subscribe({
				next(val) {
					observer.next(val);
				},
				error(err) {
					observer.error(err);
				},
				async complete() {
					observer.next({id: 'write-cache'});
					const temporaryPath = `${cachePath}.${randomUUID()}.tmp`;
					let size;

					try {
						await fs.promises.mkdir(cacheRootDir, {recursive: true});
						await fs.promises.copyFile(binPath, temporaryPath);
						({size} = await fs.promises.stat(temporaryPath));
						// Publish only a complete binary; concurrent writers use distinct temporary files.
						await fs.promises.rename(temporaryPath, cachePath);
					} catch (err) {
						await fs.promises.rm(temporaryPath, {force: true}).catch(() => {});
						observer.next({
							id: 'write-cache:fail',
							error: addId(err, 'write-cache')
						});
						observer.complete();

						return;
					}

					observer.next({id: 'write-cache:complete', path: cachePath, size});
					observer.complete();
				}
			}));
		}

		if (options.forceReinstall) {
			main();
			return cancelInstallation;
		}

		(async () => {
			const searchCacheValue = {
				id: 'search-cache',
				found: false
			};

			const [info] = await Promise.all([
				fs.promises.stat(cachePath).catch(err => {
					if (err.code === 'ENOENT') return null;
					throw err;
				}),
				(async () => {
					let binStat;
					try {
						binStat = await promisify(fs.stat)(binPath);

						if (binStat.isDirectory()) {
							const error = new Error(`Tried to create a PureScript binary at ${binPath}, but a directory already exists there.`);

							error.code = 'EISDIR';
							error.path = binPath;
							observer.error(error);
						} else {
							await promisify(fs.unlink)(binPath);
						}
					} catch (err) {
						if (err.code !== 'ENOENT') {
							throw err;
						}
					}
				})()
			]);

			if (info == null) {
				if (observer.closed) {
					return;
				}

				observer.next(searchCacheValue);
				main();

				return;
			}

			const binMode = info.mode;

			if (observer.closed) {
				return;
			}

			searchCacheValue.found = true;
			searchCacheValue.path = cachePath;
			observer.next(searchCacheValue);
			observer.next({id: 'restore-cache'});

			try {
				await promisify(pump)(
					fs.createReadStream(cachePath),
					fs.createWriteStream(binPath)
				);
				await promisify(fs.chmod)(binPath, binMode);
			} catch (err) {
				observer.next({
					id: 'restore-cache:fail',
					error: addId(err, 'restore-cache')
				});

				main();
				return;
			}

			observer.next({id: 'restore-cache:complete'});
			observer.next({id: 'check-binary'});

			try {
				const {stdout} = await promisify(execFile)(binPath, ['--version'], {timeout: 8000, ...options});
				if (stdout.trim() !== (options.version || downloadOrBuildPurescript.defaultVersion)) {
					throw new Error('Cached compiler version does not match the requested version.');
				}
			} catch (err) {
				observer.next({
					id: 'check-binary:fail',
					error: addId(err, 'check-binary')
				});

				main();
				return;
			}

			observer.next({id: 'check-binary:complete'});
			observer.complete();
		})().catch(err => observer.error(err));

		return cancelInstallation;
	});
};

Object.defineProperties(module.exports, {
	defaultCacheRootDir: {
		enumerable: true,
		value: defaultCacheRootDir
	},
	defaultVersion: {
		enumerable: true,
		value: downloadOrBuildPurescript.defaultVersion
	},
	supportedBuildFlags: {
		enumerable: true,
		value: downloadOrBuildPurescript.supportedBuildFlags
	}
});
