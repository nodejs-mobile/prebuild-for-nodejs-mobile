#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const {mkdirp} = require('mkdirp');
const rimraf = require('rimraf');
const TOML = require('@iarna/toml');
const {chunksToLinesAsync, chomp} = require('@rauschma/stringio');
const {spawn, exec} = require('child_process');
const p = require('util').promisify;

const target = /** @type {Target} */ (process.argv[2]);
const verbose = process.argv.includes('--verbose');
const androidSdkVer = process.argv
  .filter((arg) => arg.startsWith('--sdk'))
  .map((arg) => parseInt(arg.slice(5)))
  .find((arg) => !isNaN(arg)) ?? 24;

if (androidSdkVer < 24) {
  console.error(
    'ERROR: Invalid Android SDK version specified to prebuild-for-nodejs-mobile' +
      ', must be >= 24',
  );
  process.exit(1);
}

const VALID_MIN_IOS_VERSION = '13.0'; // This is hard-coded in nodejs-mobile
const VALID_TARGETS = /** @type {Array<Target>} */ ([
  'ios-arm64',
  'ios-arm64-simulator',
  'ios-x64-simulator',
  'android-arm',
  'android-arm64',
  'android-x64',
]);
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

/** @type {'ios' | 'android'} */
let platform;
/** @type {'arm64' | 'arm' | 'x64'} */
let arch;
/** @type {string | undefined} */
let simulatorTag;

[platform, arch, simulatorTag] = /** @type {any} */ (target.split('-'));

const iossim = !!simulatorTag;

if (platform === 'android' && !process.env.ANDROID_NDK_HOME) {
  console.error(
    'ANDROID_NDK_HOME missing. Please call this tool again, ' +
      'providing the ANDROID_NDK_HOME env var first',
  );
  process.exit(1);
}

/**
 * @typedef {'gyp' | 'rust-neon' | 'rust-node-bindgen'} AddonType
 * @typedef {'ios-arm64' |
 *  'ios-arm64-simulator' |
 *  'ios-x64-simulator' |
 *  'android-arm' |
 *  'android-arm64' |
 *  'android-x64'
 * } Target
 * @typedef {'aarch64-apple-ios' |
 *  'x86_64-apple-ios' |
 *  'aarch64-apple-ios-sim' |
 *  'arm-linux-androideabi' |
 *  'aarch64-linux-android' |
 *  'x86_64-linux-android'
 * } RustTriple
 * @typedef {{
 *   scripts?: {
 *     install?: string;
 *     rebuild?: string;
 *   };
 *   gypfile?: boolean;
 * }} PackageJSON
 */

/**
 * @param {import('stream').Readable} readable
 * @param {Array<string>=} pushable
 */
async function echoReadable(readable, pushable) {
  for await (const line of chunksToLinesAsync(readable)) {
    const lineStr = chomp(line);
    console.log(lineStr);
    pushable?.push(lineStr);
  }
}

/**
 * @param {import('stream').Readable} readable
 * @returns {Promise<Array<string>>}
 */
async function readableToArray(readable) {
  const arr = [];
  for await (const line of chunksToLinesAsync(readable)) {
    arr.push(chomp(line));
  }
  return arr;
}

/**
 * @param {string} pathToModule
 * @returns {PackageJSON | null}
 */
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

/**
 * @param {string} cwd
 * @returns {boolean}
 */
function isGypNodeAddon(cwd) {
  const pkgJSON = getPackageJSON(cwd);
  if (
    !pkgJSON?.scripts?.install &&
    !pkgJSON?.scripts?.rebuild &&
    !pkgJSON?.gypfile
  ) {
    return false;
  }

  const pathToBindingGYP = path.join(cwd, 'binding.gyp');
  if (!fs.existsSync(pathToBindingGYP)) return false;
  return true;
}

/**
 * @returns {RustTriple}
 */
function getRustTriple() {
  switch (target) {
    case 'ios-arm64':
      return 'aarch64-apple-ios';
    case 'ios-arm64-simulator':
      return 'aarch64-apple-ios-sim';
    case 'ios-x64-simulator':
      return 'x86_64-apple-ios';
    case 'android-arm':
      return 'arm-linux-androideabi';
    case 'android-arm64':
      return 'aarch64-linux-android';
    case 'android-x64':
      return 'x86_64-linux-android';
    default:
      console.error('Unrecognized target for Rust compilation: ' + target);
      process.exit(1);
  }
}

/**
 * @param {string} cwd
 * @returns {string | null}
 */
function getRustNodeAddonCargoTOML(cwd) {
  const pkgJSON = getPackageJSON(cwd);
  if (!pkgJSON || !pkgJSON.scripts || !pkgJSON.scripts.install) return null;

  const pathToCargoTOML = path.join(cwd, 'Cargo.toml');
  if (!fs.existsSync(pathToCargoTOML)) return null;
  return fs.readFileSync(pathToCargoTOML, {encoding: 'utf8'});
}

/**
 * @param {string} cwd
 * @returns {boolean}
 */
function isNeonRustModule(cwd) {
  const cargoTOML = getRustNodeAddonCargoTOML(cwd);
  if (!cargoTOML) return false;
  if (!cargoTOML.includes('neon')) return false;
  return true;
}

/**
 * @param {string} cwd
 * @returns {boolean}
 */
function isNodeBindgenRustModule(cwd) {
  const cargoTOML = getRustNodeAddonCargoTOML(cwd);
  if (!cargoTOML) return false;
  if (!cargoTOML.includes('node-bindgen')) return false;
  return true;
}

/**
 * @param {Array<string>} stderr
 */
function isNodeBindgenCopyError(stderr) {
  return stderr.some((line) =>
    line.includes(`thread 'main' panicked at 'copy failed of "`),
  );
}

/**
 * Moves ${cwd}/target/${triple}/release/*.so to ./index.node
 * because nj-cli doesn't do this for us in the case of mobile targets
 * https://github.com/infinyon/node-bindgen/blob/97357ba1beda7e027f40ffbbd529f653ea54781b/nj-cli/src/main.rs#L146-L165
 *
 * @param {string} cwd
 */
function fixNodeBindgenCopyError(cwd) {
  const triple = getRustTriple();
  const pathToReleaseDir = path.join(cwd, 'target', triple, 'release');
  const pathToIndexNode = path.join(cwd, 'index.node');

  const ext = platform === 'android' ? '.so' : '.dylib';

  const outputFiles = fs
    .readdirSync(pathToReleaseDir)
    .filter((f) => f.endsWith(ext));
  if (outputFiles.length !== 1) {
    console.error(
      `ERROR: Could not find a single ${ext} file in ${pathToReleaseDir}`,
    );
    process.exit(1);
  }
  const outputFile = outputFiles[0];
  const pathToOutputFile = path.join(pathToReleaseDir, outputFile);
  fs.renameSync(pathToOutputFile, pathToIndexNode);

  if (verbose) {
    console.log(
      `node-bindgen error workaround!\n` +
        `Renamed ${pathToOutputFile} to ${pathToIndexNode}`,
    );
  }
}

/**
 * Since npm 7+, the environment variable npm_config_node_gyp (which we rely on
 * in scripts/ios-build-native-modules.sh) has not been forwarded to package
 * scripts, so here we patch each module's package.json to replace
 * node-gyp-build with our fork, node-gyp-build-mobile. This fork reads a
 * different environment variable, originally created in
 * scripts/ios-build-native-modules.sh, pointing to node-mobile-gyp.
 *
 * @param {string} cwd
 */
function patchPackageJSONNodeGypBuild(cwd) {
  const packageJSONPath = path.join(cwd, 'package.json');
  const packageJSONReadData = fs.readFileSync(packageJSONPath, 'utf-8');
  let packageJSON;
  try {
    packageJSON = JSON.parse(packageJSONReadData);
  } catch (err) {
    console.error('patcher failed to parse ' + packageJSONPath);
    process.exit(0);
  }
  if (!packageJSON) return false;
  if (!packageJSON.scripts) return false;
  if (!packageJSON.scripts.install) return false;
  if (!packageJSON.scripts.install.includes('node-gyp-build')) return false;
  packageJSON.scripts.install = packageJSON.scripts.install.replace(
    /node-gyp-build(?!-)/g,
    `${require.resolve('node-gyp-build-mobile/bin.js')}`,
  );
  const packageJSONWriteData = JSON.stringify(packageJSON, null, 2);
  fs.renameSync(packageJSONPath, packageJSONPath + '.bak');
  fs.writeFileSync(packageJSONPath, packageJSONWriteData);
  return true;
}

/**
 * @param {string} cwd
 */
function undoPackageJSONPatch(cwd) {
  const packageJSONPath = path.join(cwd, 'package.json');
  const packageJSONBackupPath = path.join(cwd, 'package.json.bak');
  if (fs.existsSync(packageJSONBackupPath)) {
    fs.unlinkSync(packageJSONPath);
    fs.copyFileSync(packageJSONBackupPath, packageJSONPath);
    fs.unlinkSync(packageJSONBackupPath);
  }
}

/**
 * @param {string} cwd
 * @returns {import('child_process').ChildProcess}
 */
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
    androidEnvs.RANLIB = `${toolchainPath}/bin/llvm-ranlib`;
  }

  if (platform === 'ios') {
    GYP_DEFINES += ` iossim=${iossim}`;
  }

  const mobileGyp = require.resolve('nodejs-mobile-gyp/bin/node-gyp.js');

  const env = {
    GYP_DEFINES,
    NODEJS_MOBILE_GYP: mobileGyp,
    npm_config_nodedir: nodeMobileHeaders,
    npm_config_platform: platform,
    npm_config_format: platform === 'ios' ? 'make-ios' : 'make-android',
    npm_config_arch: arch,
    ...androidEnvs,
    ...process.env,
  };

  const VERBOSE = '--loglevel=verbose';
  const patchedInstallScript = patchPackageJSONNodeGypBuild(cwd);
  if (patchedInstallScript) {
    return spawn('npm', ['run', 'install', VERBOSE], {cwd, env});
  } else {
    return spawn('node', [mobileGyp, 'rebuild', VERBOSE], {cwd, env});
  }
}

/**
 * @param {string} filename
 * @returns {Promise<void>}
 */
async function hackIOSMinVersion(filename) {
  const task1 = await p(exec)(`vtool -show ${filename}`);
  const lines = task1.stdout.split('\n');

  // Get SDK version from vtool
  const sdkVersionLine = lines.find((line) => line.includes('sdk '));
  if (!sdkVersionLine) {
    console.error(
      'Faulty prebuild for iOS, missing SDK version in the Mach-O bundle',
    );
    process.exit(1);
  }
  const sdkVersion = sdkVersionLine
    .trim()
    .split('sdk')
    .map((x) => x.trim())[1];

  // Get MIN iOS version from vtool
  const currentMinVersionLine = lines.find((line) => line.includes('minos'));
  const currentMinVersion =
    currentMinVersionLine
      ?.trim()
      .split('minos')
      .map((x) => x.trim())[1] ?? '0.0';

  // If it's already correct, do nothing
  if (currentMinVersion === VALID_MIN_IOS_VERSION) return;

  console.log(
    `Minimum iOS version supported is incorrect (${currentMinVersion}), ` +
      `patching it with "vtool" to become ${VALID_MIN_IOS_VERSION}`,
  );
  await p(exec)(
    [
      'vtool',
      '-set-version-min',
      'ios',
      VALID_MIN_IOS_VERSION,
      sdkVersion, // preserve SDK version as it was
      `-output ${filename}`,
      filename,
    ].join(' '),
  );
}

/**
 * @param {string} cwd
 * @param {string} dst
 * @returns {Promise<Array<string>>}
 */
async function moveGypOutput(cwd, dst) {
  const src = path.join(cwd, 'build', 'Release');
  const ready = [];
  for (const filename of fs.readdirSync(src)) {
    if (filename.endsWith('.node')) {
      const srcFilename = path.resolve(src, filename);
      const dstFilename = path.resolve(dst, filename);
      // @ts-ignore
      await rimraf(dstFilename);
      // Apply index.node/index hack for iOS, if necessary:
      if (platform === 'ios' && fs.lstatSync(srcFilename).isFile()) {
        const inside = path.parse(path.basename(dstFilename)).name;
        await mkdirp(dstFilename);
        fs.renameSync(
          path.resolve(srcFilename),
          path.resolve(dstFilename, inside),
        );
      } else {
        fs.renameSync(srcFilename, dstFilename);
      }
      ready.push(dstFilename.split(cwd + '/')[1]);
    }
  }
  return ready;
}

/**
 *
 * @param {string} cwd
 * @returns {import('child_process').ChildProcess}
 */
function buildRustModule(cwd) {
  const triple = getRustTriple();

  const androidEnvs = /** @type {Record<string, string>} */ ({});
  if (platform === 'android') {
    if (!process.env.ANDROID_NDK_HOME) {
      console.error('ANDROID_NDK_HOME environment variable should be set');
      process.exit(1);
    }

    const nodeMobileBin = path.resolve(
      path.dirname(require.resolve('nodejs-mobile-react-native')),
      'android',
      'libnode',
      'bin',
    );

    let compilerPrefix = '';
    let ndkArch = '';
    switch (arch) {
      case 'arm':
        compilerPrefix = `armv7a-linux-androideabi${androidSdkVer}`;
        ndkArch = 'armeabi-v7a';
        break;
      case 'arm64':
        compilerPrefix = `aarch64-linux-android${androidSdkVer}`;
        ndkArch = 'arm64-v8a';
        break;
      case 'x64':
        compilerPrefix = `x86_64-linux-android${androidSdkVer}`;
        ndkArch = 'x86_64';
        break;
    }

    let hostTag = '';
    if (process.platform === 'darwin') {
      hostTag = 'darwin-x86_64';
    } else {
      hostTag = 'linux-x86_64';
    }
    const toolchainPath = `${process.env.ANDROID_NDK_HOME}/toolchains/llvm/prebuilt/${hostTag}`;

    const TRIPLE = triple.toUpperCase().replace(/-/g, '_');
    const llvmAR = `${toolchainPath}/bin/llvm-ar`;
    const clang = `${toolchainPath}/bin/${compilerPrefix}-clang`;
    const clangXX = `${toolchainPath}/bin/${compilerPrefix}-clang++`;

    // Set environment variables
    androidEnvs[`CARGO_TARGET_${TRIPLE}_LINKER`] = clangXX;
    androidEnvs['CC'] = clang;
    androidEnvs['CXX'] = clangXX;
    androidEnvs['AR'] = llvmAR;

    // Patch cwd to have empty build.rs file
    // This is necessary for Cargo.toml `links = "node"` to work
    const buildRsPath = path.join(cwd, 'build.rs');
    if (!fs.existsSync(buildRsPath)) {
      console.log('Creating empty build.rs file');
      fs.closeSync(fs.openSync(buildRsPath, 'w'));
      fs.closeSync(fs.openSync(buildRsPath + '.deleteme', 'w'));
    }

    // Patch Cargo.toml file to have `links = "node"`
    // This is necessary for .cargo/config.toml patches to work
    const cargoTomlPath = path.join(cwd, 'Cargo.toml');
    if (!fs.existsSync(cargoTomlPath)) {
      console.error('Cargo.toml file not found');
      process.exit(1);
    }
    fs.copyFileSync(cargoTomlPath, cargoTomlPath + '.bak');
    const cargoTomlStr = fs.readFileSync(cargoTomlPath, 'utf8') + '\n';
    const cargoToml = TOML.parse(cargoTomlStr);
    // @ts-ignore
    if (cargoToml.package.links) {
      console.error('Cargo.toml file already has a `links` field');
      process.exit(1);
    }
    console.log('Patching Cargo.toml file to have `links = "node"`');
    // @ts-ignore
    cargoToml.package.links = 'node';
    fs.writeFileSync(cargoTomlPath, TOML.stringify(cargoToml));

    // Patch .cargo/config.toml file to link `node` as nodejs-mobile
    const dotCargoPath = path.join(cwd, '.cargo');
    const configTomlPath = path.join(dotCargoPath, 'config.toml');
    if (!fs.existsSync(dotCargoPath)) {
      fs.mkdirSync(dotCargoPath);
    }
    let existingConfig = '';
    if (fs.existsSync(configTomlPath)) {
      existingConfig = fs.readFileSync(configTomlPath, 'utf8') + '\n';
      fs.copyFileSync(configTomlPath, configTomlPath + '.bak');
    }
    fs.writeFileSync(
      configTomlPath,
      existingConfig +
        [
          `[target.${triple}.node]`,
          `rustc-link-search = ["${nodeMobileBin}/${ndkArch}"]`,
          `rustc-link-lib = ["node"]`,
        ].join('\n'),
    );
    if (verbose) {
      console.log('Patched .cargo/config.toml file with:\n```');
      console.log(fs.readFileSync(configTomlPath, 'utf8'));
      console.log('```');
    }
  }

  return spawn('npm', ['run', 'install'], {
    cwd,
    env: {
      CARGO_BUILD_TARGET: triple,
      CARGO_TERM_VERBOSE: 'true',
      npm_config_platform: platform,
      npm_config_arch: arch,
      ...androidEnvs,
      ...process.env,
    },
  });
}

/**
 * @param {string} cwd
 */
function undoRustPatches(cwd) {
  // Undo Cargo.toml patch
  const cargoTomlPath = path.join(cwd, 'Cargo.toml');
  if (fs.existsSync(cargoTomlPath + '.bak')) {
    fs.unlinkSync(cargoTomlPath);
    fs.copyFileSync(cargoTomlPath + '.bak', cargoTomlPath);
    fs.unlinkSync(cargoTomlPath + '.bak');
  }

  // Undo empty build.rs patch
  const buildRsPath = path.join(cwd, 'build.rs');
  if (fs.existsSync(buildRsPath + '.deleteme')) {
    fs.unlinkSync(buildRsPath);
    fs.unlinkSync(buildRsPath + '.deleteme');
  }

  // Undo .cargo/config.toml patch
  const dotCargoPath = path.join(cwd, '.cargo');
  if (!fs.existsSync(dotCargoPath)) return;
  const configTomlPath = path.join(dotCargoPath, 'config.toml');
  const configTomlBakPath = configTomlPath + '.bak';
  if (fs.existsSync(configTomlPath)) {
    fs.unlinkSync(configTomlPath);
  }
  if (fs.existsSync(configTomlBakPath)) {
    fs.copyFileSync(configTomlBakPath, configTomlPath);
  }
  if (fs.readdirSync(path.join(cwd, '.cargo')).length === 0) {
    fs.rmdirSync(path.join(cwd, '.cargo'));
  }
}

/**
 * @param {string} cwd
 * @param {string} dst
 * @returns {Promise<Array<string>>}
 */
async function moveRustOutput(cwd, dst) {
  let srcIndexNode = path.join(cwd, 'index.node'); // Neon output
  if (!fs.existsSync(srcIndexNode)) {
    srcIndexNode = path.join(cwd, 'dist', 'index.node'); // node-bindgen output
    if (!fs.existsSync(srcIndexNode)) return [];
  }
  const dstIndexNode = path.resolve(dst, 'index.node');
  // @ts-ignore
  await rimraf(dstIndexNode);
  // Apply index.node/index hack for iOS, if necessary:
  if (platform === 'ios' && fs.lstatSync(srcIndexNode).isFile()) {
    await mkdirp(dstIndexNode);
    fs.renameSync(
      path.resolve(srcIndexNode),
      path.resolve(dstIndexNode, 'index'),
    );
  } else {
    fs.renameSync(srcIndexNode, dstIndexNode);
  }
  return [dstIndexNode.split(cwd + '/')[1]];
}

/**
 * @param {AddonType} type
 * @param {Function} taskFn
 * @param {string} cwd
 * @returns {Promise<number>}
 */
async function waitForCompilationTask(type, taskFn, cwd) {
  const task = taskFn(cwd);
  let stderr = /** @type {Array<string>} */ ([]);
  if (verbose) {
    await Promise.all([
      echoReadable(task.stdout),
      echoReadable(task.stderr, stderr),
    ]);
  } else {
    stderr = await readableToArray(task.stderr);
  }
  try {
    await p(task.on.bind(task))('close');
  } catch (code) {
    if (type === 'rust-node-bindgen' && isNodeBindgenCopyError(stderr)) {
      fixNodeBindgenCopyError(cwd);
      return 0;
    }

    console.error('Exited with code ' + code);
    for (const line of stderr) console.log(line);
    return /** @type {number} */ (code);
  }
  return 0;
}

(async function main() {
  // Build the module
  const cwd = process.cwd();
  let task;
  let type = /** @type {AddonType} */ ('unknown');
  if (isGypNodeAddon(cwd)) {
    task = buildGypModule;
    type = 'gyp';
  } else if (isNeonRustModule(cwd)) {
    task = buildRustModule;
    type = 'rust-neon';
  } else if (isNodeBindgenRustModule(cwd)) {
    task = buildRustModule;
    type = 'rust-node-bindgen';
  } else {
    console.error('No native module (GYP or Rust) found in this folder');
    process.exit(1);
  }

  const code = await waitForCompilationTask(type, task, cwd);

  // Post-processing regardless of failure or success
  if (type.startsWith('rust')) undoRustPatches(cwd);
  if (type.startsWith('gyp')) undoPackageJSONPatch(cwd);

  // If success, move outputs to prebuilds folder
  if (code === 0) {
    const prebuildOutputFolder = path.join(cwd, 'prebuilds', target);
    await mkdirp(prebuildOutputFolder);
    let ready = /** @type {Array<string>} */ ([]);
    if (type === 'gyp') {
      ready = await moveGypOutput(cwd, prebuildOutputFolder);
    } else if (type.startsWith('rust')) {
      ready = await moveRustOutput(cwd, prebuildOutputFolder);
    }
    if (platform === 'ios') {
      for (const filename of ready) {
        const inside = path.parse(path.basename(filename)).name;
        const fullFilename = path.resolve(cwd, filename, inside);
        await hackIOSMinVersion(fullFilename);
      }
    }
    for (const filename of ready) {
      console.log('BUILT ' + filename);
    }
  }

  process.exit(code);
})();
