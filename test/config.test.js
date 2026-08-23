/* Tests for private, validated persistent configuration. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('config — writes atomically with private permissions and rejects invalid shapes', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'genograph-config-'));
  const dir = path.join(base, 'settings');
  const previous = process.env.GENOGRAPH_CONFIG_DIR;
  process.env.GENOGRAPH_CONFIG_DIR = dir;
  t.after(async () => {
    if (previous === undefined) delete process.env.GENOGRAPH_CONFIG_DIR;
    else process.env.GENOGRAPH_CONFIG_DIR = previous;
    await fs.rm(base, { recursive: true, force: true });
  });

  const config = await import(`../src/config.js?test=${Date.now()}`);
  await config.writeConfig({ dataDir: '/tmp/family-trees' });
  assert.equal((await config.readConfig()).dataDir, '/tmp/family-trees');
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(dir)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(config.configPath())).mode & 0o777, 0o600);
  }

  await fs.writeFile(config.configPath(), JSON.stringify({ dataDir: { unexpected: true } }));
  assert.deepEqual(await config.readConfig(), {});
});
