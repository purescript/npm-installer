# purescript-installer

A command-line tool to install [PureScript](https://github.com/purescript/purescript) to the current working directory

1. First, it checks if a PureScript binary has been already cached in a disk, and restores that if available
2. The second plan: if no cache is available, it downloads a prebuilt binary from [the PureScript release page](https://github.com/purescript/purescript/releases).
3. The last resort: if no prebuilt binary is provided for the current platform or the downloaded binary doesn't work correctly, it downloads [the PureScript source code](https://github.com/purescript/purescript/tree/master) and compile it with [Stack](https://docs.haskellstack.org/).

*In most cases users don't need to install this CLI directly, but would rather use the [`purescript` npm package](https://npmjs.com/package/purescript).*

## Installation

Requires Node.js `^22.19.0 || >=24.0.0`, including the supported Node 22, 24
and 26 LTS lines. Node 20 reached EOL on April 30, 2026 and is no longer
supported. Undici requires at least Node 22.19.0. This is a breaking change
from 0.3.6's `^20.17.0 || >=22.9.0` range (and the earlier `>=12` range);
publish it as a breaking release, not a patch selected by older wrappers.

Downloads honor `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY` (and their
lowercase equivalents), follow redirects and retry transient failures.
Compiler binaries are cached separately by version and platform in a new
`binaries-v1` directory. Old cacache entries are left untouched and are not
reused. Cache writes use atomic replacement; restored binaries must execute
and report the requested version. Cache-write failures do not prevent an
otherwise successful installation. Cached versions remain until the cache
directory is removed.

[Use](https://docs.npmjs.com/cli/install) [npm](https://docs.npmjs.com/about-npm/).

```
npm install purescript-installer
```

## CLI

Once this package is installed to the project directory, users can execute `install-purescript` command inside [npm scripts](https://docs.npmjs.com/misc/scripts#description).

```
Usage:
install-purescript [options]

Options:
--purs-ver <string> Specify PureScript version
--name     <string> Change a binary name
                        Default: 'purs.exe' on Windows, 'purs' on others
                        Or, if the current working directory contains package.json
                        with `bin` field specifying a path of `purs` command,
                        this option defaults to its value
--help,             Print usage information
--version           Print version

Also, these flags are passed to `stack install` command if provided:
--dry-run
--pedantic
--fast
--only-snapshot
--only-dependencies
--only-configure
--trace
--profile
--no-strip
--coverage
--no-run-tests
--no-run-benchmarks
```

## Developer Guide

Install the recorded dependency tree with `npm ci --engine-strict`, then run
`npm audit` and `npm test`. Tests use Node's built-in runner and strict
assertions with a 60-second timeout, including real compiler installations
and local HTTP/proxy fixtures. No warnings or audit findings are suppressed.
There is no JavaScript build step; building PureScript from source separately
requires Stack and its Haskell toolchain.

The glob/minimatch dependency paths have been removed rather than overridden:
downloads use Undici, binary caching and cleanup use Node's filesystem APIs,
and tests no longer depend on tap. Before releasing, run `npm pack`, install
the tarball in a fresh consumer without overrides, run `npm audit` and
`npm ls --all`, and exercise the installed `install-purescript` command.

The stable compiler versions in the integration tests reuse
[PR #42](https://github.com/purescript/npm-installer/pull/42), retaining the
prerelease case. [PR #39](https://github.com/purescript/npm-installer/pull/39)
was already superseded by the merged make-fetch-happen 15 upgrade; this
modernization removes that dependency entirely.

If you'd like to contribute to this project, here are instructions for testing your changes locally:

Checkout code and create global link to PS installer package:
```
git clone https://github.com/purescript/npm-installer.git
cd npm-installer
npm link
```

Create another project for testing, and add linked PS installer:
```
cd ..
mkdir test-installer
cd test-installer
npm init -y
npm link purescript-installer
```

Test PS installer. You may re-run this command without repeating any of the above steps to pick-up new PS installer changes.
```
npx install-purescript
```

## License

[ISC License](./LICENSE) © 2017 - 2019 Watanabe Shinnosuke
