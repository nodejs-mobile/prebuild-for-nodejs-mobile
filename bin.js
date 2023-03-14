#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { mkdirp } = require('mkdirp');
const rimraf = require('rimraf')
const { chunksToLinesAsync, chomp } = require('@rauschma/stringio');
const spawn = require('child_process').spawn
const p = require('util').promisify;

async function echoReadable(readable) {
  for await (const line of chunksToLinesAsync(readable)) {
    console.log(chomp(line));
  }
}

async function readableToArray(readable) {
  const arr = [];
  for await (const line of chunksToLinesAsync(readable)) {
    arr.push(chomp(line));
  }
  return arr;
}

const VALID_TARGETS = ['ios-arm64', 'ios-x64', 'android-arm', 'android-arm64', 'android-x64'];
const target = process.argv[2];
const verbose = process.argv.includes('--verbose');
const androidSdkVer = 21; // TODO: this should be CLI-configurable
if (!target) {
  console.error(
    'ERROR: Must specify a target to prebuild-for-nodejs-mobile' +
    ', one of these:\n' +
    VALID_TARGETS.map((t) => `  * ${t}`).join('\n'),
  );
  process.exit(1);
}
if (!VALID_TARGETS.includes(target)) {
  console.error(
    `ERROR: Invalid target "${target}" specified to prebuild-for-nodejs-mobile` +
    ', must be one of these:\n' +
    VALID_TARGETS.map((t) => `  * ${t}`).join('\n'),
  );
  process.exit(1);
}

const [platform, arch] = target.split('-');

if (platform === 'android' && !process.env.ANDROID_NDK_HOME) {
  console.error('ANDROID_NDK_HOME missing. Please call this tool again, ' +
    'providing the ANDROID_NDK_HOME env var first');
  process.exit(1);
}

const cargoBuildTarget =
  target === 'ios-arm64' ? 'aarch64-apple-ios' :
    target === 'ios-x64' ? 'x86_64-apple-ios' :
      target === 'android-arm' ? 'arm-linux-androideabi' :
        target === 'android-arm64' ? 'aarch64-linux-android' :
          target === 'android-x64' ? 'x86_64-linux-android' :
            'TODO'

const mobileGyp = require.resolve('nodejs-mobile-gyp/bin/node-gyp.js');

(async function main() {
  const buildOutputFolder = path.join(process.cwd(), 'build', 'Release');
  const prebuildOutputFolder = path.join(process.cwd(), 'prebuilds', target);
  await mkdirp(prebuildOutputFolder);

  const nodeMobileHeaders = path.resolve(
    path.dirname(require.resolve('nodejs-mobile-react-native')),
    platform,
    'libnode'
  );

  let GYP_DEFINES = `OS=${platform} target_platform=${platform} target_arch=${arch}`;

  const androidEnvs = {};
  if (platform === 'android') {
    let compilerPrefix = '';
    switch (arch) {
      case 'arm':
        compilerPrefix = `armv7a-linux-androideabi${androidSdkVer}`
        break;
      case 'arm64':
        compilerPrefix = `aarch64-linux-android${androidSdkVer}`
        break
      case 'x64':
        compilerPrefix = `x86_64-linux-android${androidSdkVer}`
        break
    }

    GYP_DEFINES += ` v8_target_arch=${arch}`;
    GYP_DEFINES += ` android_target_arch=${arch}`;
    GYP_DEFINES += ` target=${compilerPrefix}`
    if (process.platform === 'darwin')
      GYP_DEFINES += ' host_os=mac';
    else if (process.platform === 'linux')
      GYP_DEFINES += ' host_os=linux';
    else {
      console.error('Compiling Android modules is only supported on Mac or Linux');
      process.exit(1)
    }

    let hostTag = '';
    if (process.platform === 'darwin') {
      hostTag = 'darwin-x86_64';
    } else {
      hostTag = 'linux-x86_64';
    }
    const toolchainPath = `${process.env.ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/${hostTag}`
    androidEnvs.TOOLCHAIN = toolchainPath;
    androidEnvs.AR = `${toolchainPath}/bin/llvm-ar`;
    androidEnvs.CC = `${toolchainPath}/bin/${compilerPrefix}-clang`;
    androidEnvs.CXX = `${toolchainPath}/bin/${compilerPrefix}-clang++`;
    androidEnvs.LINK = `${toolchainPath}/bin/${compilerPrefix}-clang++`;
  }

  const rebuild = spawn('node', [mobileGyp, 'rebuild', '--napi', '--strip'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GYP_DEFINES,
      CARGO_BUILD_TARGET: cargoBuildTarget,
      npm_config_nodedir: nodeMobileHeaders,
      npm_config_platform: platform,
      npm_config_format: platform === 'ios' ? 'make-ios' : 'make-android',
      npm_config_arch: arch,
      ...androidEnvs,
    }
  })

  let stderr = [];
  if (verbose) {
    await Promise.all([
      echoReadable(rebuild.stdout),
      echoReadable(rebuild.stderr)
    ]);
  } else {
    stderr = await readableToArray(rebuild.stderr)
  }
  try {
    await p(rebuild.on.bind(rebuild))('close');
  } catch (code) {
    console.error('Exited with code ' + code);
    for (const line of stderr) console.log(line)
    process.exit(code)
  }

  const ready = []
  for (const filename of fs.readdirSync(buildOutputFolder)) {
    if (filename.endsWith('.node')) {
      await rimraf(path.resolve(prebuildOutputFolder, filename));
      fs.renameSync(
        path.resolve(buildOutputFolder, filename),
        path.resolve(prebuildOutputFolder, filename)
      );
      ready.push(path.resolve(prebuildOutputFolder, filename).split(process.cwd() + '/')[1]);
    }
  }
  for (const filename of ready) {
    console.log('BUILT ' + filename);
  }
})();
