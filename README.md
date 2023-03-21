# prebuild-for-nodejs-mobile

> CLI tool to compile native modules to work on [nodejs-mobile](https://github.com/nodejs-mobile/nodejs-mobile)

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

For Android, you can specify the Android SDK version with `--sdkXX`, otherwise by default it will be `21`, the lowest supported.

```sh
$ npx prebuild-for-nodejs-mobile android-arm64 --sdk28
```

## Features

- [x] Compiles native modules for iOS
- [x] Compiles native modules for Android
- [x] Can customize the Android SDK target API version
- [x] Compiles Rust (specifically [Neon](https://neon-bindings.com)) Node.js native modules
- [ ] Can customize build flags

## License

MIT
