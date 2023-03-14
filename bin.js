#!/usr/bin/env node
const path = require('path');
const fs = require('fs');
const { mkdirp } = require('mkdirp');
const rimraf = require('rimraf')
const { chunksToLinesAsync, chomp } = require('@rauschma/stringio');
const spawn = require('child_process').spawn
const p = require('util').promisify;

const VALID_TARGETS = ['ios-arm64', 'ios-x64', 'android-arm', 'android-arm64', 'android-x64'];
const target = process.argv[2];
const verbose = process.argv.includes('--verbose');
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

const [platform, arch] = target.split('-');
const cargoBuildTarget =
  target === 'ios-arm64' ? 'aarch64-apple-ios' :
    target === 'ios-x64' ? 'x86_64-apple-ios' :
      target === 'android-arm' ? 'arm-linux-androideabi' :
        target === 'android-arm64' ? 'aarch64-linux-android' :
          target === 'android-x64' ? 'x86_64-linux-android' :
            'TODO'

const mobileGyp = require.resolve('nodejs-mobile-gyp/bin/node-gyp.js');
const nodeMobileHeaders = path.resolve(path.dirname(require.resolve('nodejs-mobile-react-native')), 'ios', 'libnode');

(async function main() {
  const buildOutputFolder = path.join(process.cwd(), 'build', 'Release');
  const prebuildOutputFolder = path.join(process.cwd(), 'prebuilds', target);
  await mkdirp(prebuildOutputFolder);

  let GYP_DEFINES = `OS=${platform} target_arch=${arch} target_platform=${platform}`;
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
    }
  })

  let stderr;
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