import { test } from 'node:test';
import assert from 'node:assert/strict';

import { SaveCoordinator } from '../public/lib/autosave.js';

test('an older save completion cannot clear a newer edit', async () => {
  const saves = new SaveCoordinator();
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  saves.markDirty();
  const first = saves.save(async revision => { await blocked; return revision; });
  saves.markDirty();
  release();
  const firstResult = await first;
  assert.equal(firstResult.ok, true);
  assert.equal(firstResult.dirty, true);
  assert.equal(saves.dirty, true);

  const secondResult = await saves.save(async revision => revision);
  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.dirty, false);
  assert.equal(saves.dirty, false);
});

test('writes are serialized in revision order', async () => {
  const saves = new SaveCoordinator();
  const order = [];
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  saves.markDirty();
  const first = saves.save(async revision => { order.push(`start-${revision}`); await blocked; order.push(`end-${revision}`); });
  saves.markDirty();
  const second = saves.save(async revision => { order.push(`start-${revision}`); order.push(`end-${revision}`); });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['start-1']);
  release();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});

test('a failed write remains dirty and can be retried', async () => {
  const saves = new SaveCoordinator();
  saves.markDirty();
  const failed = await saves.save(async () => { throw new Error('disk full'); });
  assert.equal(failed.ok, false);
  assert.equal(saves.dirty, true);
  const retried = await saves.save(async () => {});
  assert.equal(retried.ok, true);
  assert.equal(saves.dirty, false);
});
