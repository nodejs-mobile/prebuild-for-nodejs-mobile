#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const {mkdirp} = require('mkdirp');
const rimraf = require('rimraf');
const {chunksToLinesAsync, chomp} = require('@rauschma/stringio');
const spawn = require('child_process').spawn;
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

const target = process.argv[2];
const verbose = process.argv.includes('--verbose');
const androidSdkVer = process.argv.includes('--sdk31')
  ? 31
  : process.argv.includes('--sdk30')
  ? 30
  : process.argv.includes('--sdk29')
  ? 29
  : process.argv.includes('--sdk28')
  ? 28
  : process.argv.includes('--sdk27')
  ? 27
  : process.argv.includes('--sdk26')
  ? 26
  : process.argv.includes('--sdk25')
  ? 25
  : process.argv.includes('--sdk24')
  ? 24
  : process.argv.includes('--sdk23')
  ? 23
  : process.argv.includes('--sdk22')
  ? 22
  : 21; // TODO make this less ugly :)

const VALID_TARGETS = [
  'ios-arm64',
  'ios-x64',
  'android-arm',
  'android-arm64',
  'android-x64',
];
const listedTargets = VALID_TARGETS.map((t) => `  * ${t}`).join('\n');
if (!target) {
  console.error(
    'ERROR: Must specify a target to prebuild-for-nodejs-mobile' +
      ', one of these:\n' +
      listedTargets,
  );
  process.exit(1);
}
if (!VALID_TARGETS.includes(target)) {
  console.error(
    `ERROR: Invalid target "${target}" specified to prebuild-for-nodejs-mobile` +
      ', must be one of these:\n' +
      listedTargets,
  );
  process.exit(1);
}

const [platform, arch] = target.split('-');

if (platform === 'android' && !process.env.ANDROID_NDK_HOME) {
  console.error(
    'ANDROID_NDK_HOME missing. Please call this tool again, ' +
      'providing the ANDROID_NDK_HOME env var first',
  );
  process.exit(1);
}

function getPackageJSON(pathToModule) {
  const pathToPkgJSON = path.join(pathToModule, 'package.json');
  if (!fs.existsSync(pathToPkgJSON)) return null;
  const pkgJSONRaw = fs.readFileSync(pathToPkgJSON, {encoding: 'utf8'});
  try {
    var pkgJSON = JSON.parse(pkgJSONRaw);
  } catch {
    return null;
  }
  return pkgJSON;
}

function isGypModule(cwd) {
  const pkgJSON = getPackageJSON(cwd);
  if (!pkgJSON || !pkgJSON.scripts) return false;
  if (!pkgJSON.scripts.install && !pkgJSON.scripts.rebuild) return false;

  const pathToBindingGYP = path.join(cwd, 'binding.gyp');
  if (!fs.existsSync(pathToBindingGYP)) return false;
  return true;
}

function isNeonModule(cwd) {
  const pkgJSON = getPackageJSON(cwd);
  if (!pkgJSON || !pkgJSON.scripts || !pkgJSON.scripts.install) return false;

  const pathToCargoTOML = path.join(cwd, 'Cargo.toml');
  if (!fs.existsSync(pathToCargoTOML)) return false;
  const cargoTOML = fs.readFileSync(pathToCargoTOML, {encoding: 'utf8'});
  if (!cargoTOML.includes('neon')) return false;
  return true;
}

function buildGypModule(cwd) {
  const nodeMobileHeaders = path.resolve(
    path.dirname(require.resolve('nodejs-mobile-react-native')),
    platform,
    'libnode',
  );

  let GYP_DEFINES = `OS=${platform} target_platform=${platform} target_arch=${arch}`;

  const androidEnvs = {};
  if (platform === 'android') {
    if (!process.env.ANDROID_NDK_HOME) {
      console.error('ANDROID_NDK_HOME environment variable should be set');
      process.exit(1);
    }

    let compilerPrefix = '';
    switch (arch) {
      case 'arm':
        compilerPrefix = `armv7a-linux-androideabi${androidSdkVer}`;
        break;
      case 'arm64':
        compilerPrefix = `aarch64-linux-android${androidSdkVer}`;
        break;
      case 'x64':
        compilerPrefix = `x86_64-linux-android${androidSdkVer}`;
        break;
    }

    GYP_DEFINES += ` v8_target_arch=${arch}`;
    GYP_DEFINES += ` android_target_arch=${arch}`;
    GYP_DEFINES += ` target=${compilerPrefix}`;
    if (process.platform === 'darwin') GYP_DEFINES += ' host_os=mac';
    else if (process.platform === 'linux') GYP_DEFINES += ' host_os=linux';
    else {
      console.error(
        'Compiling Android modules is only supported on Mac or Linux',
      );
      process.exit(1);
    }

    let hostTag = '';
    if (process.platform === 'darwin') {
      hostTag = 'darwin-x86_64';
    } else {
      hostTag = 'linux-x86_64';
    }
    const toolchainPath = `${process.env.ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/${hostTag}`;
    androidEnvs.TOOLCHAIN = toolchainPath;
    androidEnvs.AR = `${toolchainPath}/bin/llvm-ar`;
    androidEnvs.CC = `${toolchainPath}/bin/${compilerPrefix}-clang`;
    androidEnvs.CXX = `${toolchainPath}/bin/${compilerPrefix}-clang++`;
    androidEnvs.LINK = `${toolchainPath}/bin/${compilerPrefix}-clang++`;
  }

  const mobileGyp = require.resolve('nodejs-mobile-gyp/bin/node-gyp.js');

  return spawn('node', [mobileGyp, 'rebuild'], {
    cwd,
    env: {
      GYP_DEFINES,
      npm_config_nodedir: nodeMobileHeaders,
      npm_config_platform: platform,
      npm_config_format: platform === 'ios' ? 'make-ios' : 'make-android',
      npm_config_arch: arch,
      ...androidEnvs,
      ...process.env,
    },
  });
}

async function moveGypOutput(cwd, dst) {
  const src = path.join(cwd, 'build', 'Release');
  const ready = [];
  for (const filename of fs.readdirSync(src)) {
    if (filename.endsWith('.node')) {
      await rimraf(path.resolve(dst, filename));
      fs.renameSync(path.resolve(src, filename), path.resolve(dst, filename));
      ready.push(path.resolve(dst, filename).split(cwd + '/')[1]);
    }
  }
  return ready;
}

function buildNeonModule(cwd) {
  const cargoBuildTarget =
    target === 'ios-arm64'
      ? 'aarch64-apple-ios'
      : target === 'ios-x64'
      ? 'x86_64-apple-ios'
      : target === 'android-arm'
      ? 'arm-linux-androideabi'
      : target === 'android-arm64'
      ? 'aarch64-linux-android'
      : target === 'android-x64'
      ? 'x86_64-linux-android'
      : '';

  if (cargoBuildTarget === '') {
    console.error('Unrecognized target for Rust compilation: ' + target);
    process.exit(1);
  }

  const androidEnvs = {};
  if (platform === 'android') {
    if (!process.env.ANDROID_NDK_HOME) {
      console.error('ANDROID_NDK_HOME environment variable should be set');
      process.exit(1);
    }

    let compilerPrefix = '';
    switch (arch) {
      case 'arm':
        compilerPrefix = `armv7a-linux-androideabi${androidSdkVer}`;
        break;
      case 'arm64':
        compilerPrefix = `aarch64-linux-android${androidSdkVer}`;
        break;
      case 'x64':
        compilerPrefix = `x86_64-linux-android${androidSdkVer}`;
        break;
    }

    let hostTag = '';
    if (process.platform === 'darwin') {
      hostTag = 'darwin-x86_64';
    } else {
      hostTag = 'linux-x86_64';
    }
    const toolchainPath = `${process.env.ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/${hostTag}`;

    const CBT = cargoBuildTarget.toUpperCase().replace(/-/g, '_');
    const androidAR = `${toolchainPath}/bin/llvm-ar`;
    const androidLinker = `${toolchainPath}/bin/${compilerPrefix}-clang++`;
    androidEnvs[`CARGO_TARGET_${CBT}_AR`] = androidAR;
    androidEnvs[`CARGO_TARGET_${CBT}_LINKER`] = androidLinker;
  }

  return spawn('npm', ['run', 'install'], {
    cwd,
    env: {
      CARGO_BUILD_TARGET: cargoBuildTarget,
      npm_config_platform: platform,
      npm_config_arch: arch,
      ...androidEnvs,
      ...process.env,
    },
  });
}

async function moveNeonOutput(cwd, dst) {
  const srcIndexNode = path.join(cwd, 'index.node');
  const dstIndexNode = path.resolve(dst, 'index.node');
  if (!fs.existsSync(srcIndexNode)) return [];
  await rimraf(dstIndexNode);
  fs.renameSync(srcIndexNode, dstIndexNode);
  return [dstIndexNode.split(cwd + '/')[1]];
}

(async function main() {
  // Build the module
  const cwd = process.cwd();
  let task;
  let type = 'unknown';
  if (isGypModule(cwd)) {
    task = buildGypModule(cwd);
    type = 'gyp';
  } else if (isNeonModule(cwd)) {
    task = buildNeonModule(cwd);
    type = 'neon';
  } else {
    console.error('No native module (GYP or Neon) found in this folder');
    process.exit(1);
  }

  // Wait for compilation to finish
  let stderr = [];
  if (verbose) {
    await Promise.all([echoReadable(task.stdout), echoReadable(task.stderr)]);
  } else {
    stderr = await readableToArray(task.stderr);
  }
  try {
    await p(task.on.bind(task))('close');
  } catch (code) {
    console.error('Exited with code ' + code);
    for (const line of stderr) console.log(line);
    process.exit(code);
  }

  // Move outputs to prebuilds folder
  const prebuildOutputFolder = path.join(cwd, 'prebuilds', target);
  await mkdirp(prebuildOutputFolder);
  let ready = [];
  if (type === 'gyp') {
    ready = await moveGypOutput(cwd, prebuildOutputFolder);
  } else if (type === 'neon') {
    ready = await moveNeonOutput(cwd, prebuildOutputFolder);
  }
  for (const filename of ready) {
    console.log('BUILT ' + filename);
  }
})();
