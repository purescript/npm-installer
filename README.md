# purescript-installer

A command-line tool to install [PureScript](https://github.com/purescript/purescript) to the current working directory

1. First, it checks if a PureScript binary has been already cached in a disk, and restores that if available
2. The second plan: if no cache is available, it downloads a prebuilt binary from [the PureScript release page](https://github.com/purescript/purescript/releases).
3. The last resort: if no prebuilt binary is provided for the current platform or the downloaded binary doesn't work correctly, it downloads [the PureScript source code](https://github.com/purescript/purescript/tree/master) and compile it with [Stack](https://docs.haskellstack.org/).

*In most cases users don't need to install this CLI directly, but would rather use [`purescript` npm package](https://github.com/purescript-contrib/node-purescript).*

## Installation

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

## Related project

* [install-purescript](https://github.com/shinnn/install-purescript) — API for this module

## License

[ISC License](./LICENSE) © 2017 - 2019 Watanabe Shinnosuke
