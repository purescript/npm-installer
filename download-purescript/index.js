'use strict';

const { basename } = require('path');
const { inspect } = require('util');
const os = require('os');
const semver = require('semver');

const dlTar = require('../dl-tar/index.js');
const isPlainObj = require('is-plain-obj');
const Observable = require('zen-observable');

const supportedPlatforms = new Map([
  // on all OSes, os.machine returns x86_64, process.arch returns x64
  ['linux-x64', 'linux64'],
  ['darwin-x64', 'macos'],
  ['win32-x64', 'win64'],
  ['linux-x86_64', 'linux64'],
  ['darwin-x86_64', 'macos'],
  ['win32-x86_64', 'win64'],

  ['darwin-arm64', 'macos-arm64'],
  // on Linux os.machine returns aarch64, process.arch returns arm64
  ['linux-aarch64', 'linux-arm64'],
  ['linux-arm64', 'linux-arm64'],
]);

const DEFAULT_VERSION = '0.15.0';
const VERSION_ERROR = `Expected \`version\` option to be a string of PureScript version, for example '${DEFAULT_VERSION}'`;
const defaultOptions = {
  filter: function isPurs(filePath) {
    return basename(filePath, '.exe') === 'purs';
  },
  version: DEFAULT_VERSION,
  baseUrl: 'https://github.com/purescript/purescript/releases/download/'
};

function createUnsupportedPlatformError(buildProfile) {
  const error = new Error(`Prebuilt \`purs\` binary is not provided for your combination of operating system and architecture: '${buildProfile}'.`);

  error.code = 'ERR_UNSUPPORTED_PLATFORM';
  Error.captureStackTrace(error, createUnsupportedPlatformError);

  return new Observable(observer => observer.error(error));
}

function getBuildProfile() {
  let architecture = process.arch;
  // It's only defined from Node 16.18 onwards
  if (typeof os.machine === 'function') {
    architecture = os.machine();
  }

  return `${process.platform}-${architecture}`;
}

exports.downloadPurescript = function (...args) {
  let buildProfile = getBuildProfile();
  const archiveName = supportedPlatforms.get(buildProfile);

  if (!archiveName) {
    return createUnsupportedPlatformError(buildProfile);
  }

  if (args.length > 1) {
    const error = new RangeError(`Expected 0 or 1 argument ([<Object>]), but got ${argLen} arguments.`);
    error.code = 'ERR_TOO_MANY_ARGS';
    return new Observable(observer => observer.error(error));
  }

  let options = defaultOptions;

  if (args.length === 1) {
    const [newOptions] = args;

    if (!isPlainObj(newOptions)) {
      return new Observable(observer => {
        observer.error(new TypeError(`Expected download-purescript option to be an object, but got ${inspect(newOptions)}.`));
      });
    }

    options = { ...defaultOptions, ...newOptions };

    if (options.followRedirect !== undefined && !options.followRedirect) {
      return new Observable(observer => observer.error(new Error('`followRedirect` option cannot be disabled.')));
    }

    if (options.strip !== undefined && options.strip !== 1) {
      return new Observable(observer => {
        observer.error(new Error(`\`strip\` option is unchangeable, but ${inspect(options.strip)} was provided.`));
      });
    }

    if (options.version !== undefined) {
      if (typeof options.version !== 'string') {
        return new Observable(observer => {
          observer.error(new TypeError(`${VERSION_ERROR}, but got a non-string value ${inspect(options.version)}.`));
        });
      }

      if (options.version.length === 0) {
        options.version = DEFAULT_VERSION;
      }

      if (!semver.valid(options.version)) {
        return new Observable(observer => {
          observer.error(new Error(`${VERSION_ERROR}, but got an invalid version ${inspect(options.version)}.`));
        });
      }
    }
  }

  const url = `v${options.version}/${archiveName}.tar.gz`;
  return dlTar(url, process.cwd(), options);
}

exports.defaultVersion = DEFAULT_VERSION;

exports.getBuildProfile = getBuildProfile;
