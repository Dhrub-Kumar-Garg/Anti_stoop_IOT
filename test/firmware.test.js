const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('firmware tap, averaging, feedback, and original delayed detection with simulated GPIO', t => {
  const compiler = process.env.CXX || 'c++';
  const probe = spawnSync(compiler, ['--version']);
  if (probe.error?.code === 'ENOENT') return t.skip('C++ compiler not installed');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'posturepal-firmware-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const executable = path.join(dir, 'firmware-test');
  const build = spawnSync(compiler, ['-std=c++11', '-I', path.join(__dirname, 'firmware-stubs'), path.join(__dirname, 'firmware_harness.cpp'), '-o', executable], { encoding: 'utf8' });
  assert.equal(build.status, 0, build.stderr);
  const run = spawnSync(executable, [], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
});
