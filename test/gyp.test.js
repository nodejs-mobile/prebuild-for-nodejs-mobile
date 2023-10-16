const tape = require('tape');
const {exec} = require('child_process');
const p = require('util').promisify;
const path = require('path');
const rimraf = require('rimraf');
const fs = require('fs');

tape('GYP-based native module for ios-arm64', async (t) => {
  if (process.platform !== 'darwin') {
    t.skip('Can only run on macOS');
    t.end();
    return;
  }
  const prebuild4 = path.join(__dirname, '..', 'bin.js');
  const project = path.join(__dirname, 'helloworld');
  const target = 'ios-arm64';

  if (!fs.existsSync(path.join(project, 'node_modules'))) {
    await p(exec)('npm install', {cwd: project});
    t.pass('npm install');
    await rimraf(path.join(project, 'build'));
  }

  const task1 = await p(exec)(`${prebuild4} ${target}`, {cwd: project});
  t.true(task1.stdout.includes('BUILT '), 'prebuild done');

  const pathToOutput = path.join(
    'prebuilds',
    target,
    'helloworld.node',
    'helloworld',
  );

  const task2 = await p(exec)(`file ${pathToOutput}`, {cwd: project});
  t.true(
    task2.stdout.includes(
      'Mach-O 64-bit dynamically linked shared library arm64',
    ),
    'Mach-O correct',
  );
});

tape('GYP-based native module for android-arm(v7)', async (t) => {
  const prebuild4 = path.join(__dirname, '..', 'bin.js');
  const project = path.join(__dirname, 'helloworld');
  const target = 'android-arm';

  if (!fs.existsSync(path.join(project, 'node_modules'))) {
    await p(exec)('npm install', {cwd: project});
    t.pass('npm install');
    await rimraf(path.join(project, 'build'));
  }

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

  if (!fs.existsSync(path.join(project, 'node_modules'))) {
    await p(exec)('npm install', {cwd: project});
    t.pass('npm install');
    await rimraf(path.join(project, 'build'));
  }

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

tape('GYP-based native module for android-x64', async (t) => {
  const prebuild4 = path.join(__dirname, '..', 'bin.js');
  const project = path.join(__dirname, 'helloworld');
  const target = 'android-x64';

  if (!fs.existsSync(path.join(project, 'node_modules'))) {
    await p(exec)('npm install', {cwd: project});
    t.pass('npm install');
    await rimraf(path.join(project, 'build'));
  }

  const task1 = await p(exec)(`${prebuild4} ${target}`, {cwd: project});
  t.true(task1.stdout.includes('BUILT '), 'prebuild done');

  const pathToOutput = path.join('prebuilds', target, 'helloworld.node');

  const task2 = await p(exec)(`file ${pathToOutput}`, {cwd: project});
  t.true(
    task2.stdout.includes('ELF 64-bit LSB shared object, x86-64'),
    'ELF correct',
  );
});
