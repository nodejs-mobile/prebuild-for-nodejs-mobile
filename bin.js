#!/usr/bin/env node
const util = require('util');
const path = require('path');
const fs = require('fs');
const { mkdirp } = require('mkdirp');
const exec = util.promisify(require('child_process').exec);

const VALID_TARGETS = ['ios-arm64', 'ios-x64', 'android-armv8'];
const target = process.argv[2];
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
const cargoBuildTarget =
  target === 'ios-arm64' ? 'aarch64-apple-ios' :
    target === 'ios-x64' ? 'x86_64-apple-ios' :
      'TODO'

const nodejsMobileGypBinFile = require.resolve('nodejs-mobile-gyp/bin/node-gyp.js');
const nodejsHeadersDir = path.resolve(path.dirname(require.resolve('nodejs-mobile-react-native')), 'ios', 'libnode');

(async function main() {
  await mkdirp(path.join(process.cwd(), 'prebuilds', target));

  const node = process.argv[0];
  await exec(`${node} ${nodejsMobileGypBinFile} rebuild ` + 
    `--target_arch=${arch} --target_platform=${platform} ` + 
    `--napi --strip`, {
    cwd: process.cwd(),
    maxBuffer: 32 * 1024 * 1024, // 32MB worth of logs in stdout
    env: {
      ...process.env,
      GYP_DEFINES: `OS=${platform}`,
      CARGO_BUILD_TARGET: cargoBuildTarget,
      npm_config_nodedir: nodejsHeadersDir,
      npm_config_platform: platform,
      npm_config_format: platform === 'ios' ? 'make-ios' : 'make-android',
      npm_config_arch: arch,
    }
  });

  // FIXME: native-prover.node needs to be generalized
  fs.renameSync(
    path.resolve(process.cwd(), 'build', 'Release', 'native-prover.node'), 
    path.resolve(process.cwd(), 'prebuilds', target, 'node.napi.node')
  );
})();