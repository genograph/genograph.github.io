/* Tests for the pure layout algorithm (public/lib/layout.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildModel, rootIdOf } from '../public/lib/model.js';
import { layout, CARD_W, CARD_H } from '../public/lib/layout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const example = () => buildModel(JSON.parse(readFileSync(path.join(__dirname, '..', 'examples', 'lusignan.json'), 'utf8')));

function overlaps(a, b) {
  return a.x < b.x + CARD_W && b.x < a.x + CARD_W && a.y < b.y + CARD_H && b.y < a.y + CARD_H;
}

for (const mode of ['full', 'close', 'ancestors']) {
  test(`layout (${mode}) — no two cards overlap`, () => {
    const m = example();
    const { cards } = layout(m, rootIdOf(m), mode);
    assert.ok(cards.length > 0, 'produces cards');
    for (let i = 0; i < cards.length; i++) {
      for (let j = i + 1; j < cards.length; j++) {
        assert.ok(!overlaps(cards[i], cards[j]),
          `cards ${cards[i].id} and ${cards[j].id} overlap in ${mode} mode`);
      }
    }
  });

  test(`layout (${mode}) — every card maps to a real person and bbox is finite`, () => {
    const m = example();
    const { cards, bbox } = layout(m, rootIdOf(m), mode);
    for (const c of cards) assert.ok(m.byId.has(c.id), `${c.id} exists`);
    assert.equal(new Set(cards.map(c => c.id)).size, cards.length, 'no duplicate cards');
    for (const v of [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]) assert.ok(Number.isFinite(v));
    assert.ok(bbox.maxX > bbox.minX && bbox.maxY > bbox.minY);
  });
}

test('layout — ancestors mode shows only the direct line (focus + parents)', () => {
  const m = example();
  const { cards } = layout(m, 'p1', 'ancestors');
  const ids = cards.map(c => c.id).sort();
  assert.deepEqual(ids, ['p1', 'p2', 'p3'], 'Guy + father + mother only');
});

test('layout — deterministic for the same inputs', () => {
  const m = example();
  const a = layout(m, rootIdOf(m), 'full');
  const b = layout(m, rootIdOf(m), 'full');
  assert.deepEqual(a.cards, b.cards);
  assert.deepEqual(a.segs, b.segs);
});

test('layout — empty / unknown focus yields an empty, finite result', () => {
  const m = buildModel({ people: [] });
  const { cards, bbox } = layout(m, null, 'full');
  assert.equal(cards.length, 0);
  for (const v of [bbox.minX, bbox.minY, bbox.maxX, bbox.maxY]) assert.ok(Number.isFinite(v));
});
