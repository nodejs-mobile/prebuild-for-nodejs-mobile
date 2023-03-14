# prebuild-for-nodejs-mobile

> CLI tool to compile node.js native modules for mobile

## Usage

Specify one of the supported targets:

```sh
$ npx prebuild-for-nodejs-mobile
ERROR: Must specify a target to prebuild-for-nodejs-mobile, one of these:
  * ios-arm64
  * ios-x64
  * android-arm
  * android-arm64
  * android-x64
```

Such as `ios-arm64`:

```sh
$ npx prebuild-for-nodejs-mobile ios-arm64
```

Use `--verbose` to see the whole compilation logs:

```sh
$ npx prebuild-for-nodejs-mobile ios-arm64 --verbose
```

## Features

- [x] Compiles native modules for iOS
- [x] Compiles native modules for Android
- [ ] Compiles Rust (e.g. Neon) native modules
- [ ] Can customize the Android SDK target API version
- [ ] Can customize build flags

## License

MIT
