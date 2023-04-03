const tape = require('tape');
const {exec} = require('child_process');
const p = require('util').promisify;
const path = require('path');

tape('GYP-based native module for android-arm(v7)', async (t) => {
  const prebuild4 = path.join(__dirname, '..', 'bin.js');
  const project = path.join(__dirname, 'helloworld');
  const target = 'android-arm';

  await p(exec)('npm install', {cwd: project});
  t.pass('npm install');

  const task1 = await p(exec)(`${prebuild4} ${target}`, {cwd: project});
  t.true(task1.stdout.includes('BUILT '), 'prebuild done');

  const pathToOutput = path.join('prebuilds', target, 'helloworld.node');

  const task2 = await p(exec)(`file ${pathToOutput}`, {cwd: project});
  t.true(
    task2.stdout.includes('ELF 32-bit LSB shared object, ARM, EABI5'),
    'ELF correct',
  );

  const task3 = await p(exec)(`readelf -d ${pathToOutput}`, {cwd: project});
  t.true(
    task3.stdout.includes('Shared library: [libnode.so]'),
    'Dynamically links with libnode.so',
  );
});

tape('GYP-based native module for android-arm64(v8)', async (t) => {
  const prebuild4 = path.join(__dirname, '..', 'bin.js');
  const project = path.join(__dirname, 'helloworld');
  const target = 'android-arm64';

  await p(exec)('npm install', {cwd: project});
  t.pass('npm install');

  const task1 = await p(exec)(`${prebuild4} ${target}`, {cwd: project});
  t.true(task1.stdout.includes('BUILT '), 'prebuild done');

  const pathToOutput = path.join('prebuilds', target, 'helloworld.node');

  const task2 = await p(exec)(`file ${pathToOutput}`, {cwd: project});
  t.true(
    task2.stdout.includes('ELF 64-bit LSB shared object, ARM aarch64'),
    'ELF correct',
  );

  const task3 = await p(exec)(`readelf -d ${pathToOutput}`, {cwd: project});
  t.true(
    task3.stdout.includes('Shared library: [libnode.so]'),
    'Dynamically links with libnode.so',
  );
});
