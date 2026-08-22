import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(root, 'bin', 'genograph.js');

function run(...args) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5_000
  });
}

test('CLI — help and version exit successfully', () => {
  const help = run('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: genograph/);

  const version = run('--version');
  assert.equal(version.status, 0);
  assert.match(version.stdout, /^\d+\.\d+\.\d+\s*$/);
});

test('CLI — options that require values fail closed', () => {
  for (const option of ['--port', '--data', '--host']) {
    const result = run(option);
    assert.equal(result.status, 2, `${option} should exit with usage error`);
    assert.match(result.stderr, new RegExp(`Missing value for ${option}`));
  }
});

test('CLI — non-loopback hosts are rejected', () => {
  for (const host of ['0.0.0.0', '192.168.1.20', 'example.com']) {
    const result = run('--host', host);
    assert.equal(result.status, 2, `${host} should be rejected`);
    assert.match(result.stderr, /only accepts loopback hosts/);
  }
});
