#!/usr/bin/env node

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
