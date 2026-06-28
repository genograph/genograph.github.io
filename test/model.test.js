/* Tests for the pure data model (public/lib/model.js). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  normalizeDate, splitPlaceCountry, buildModel, serialize, rootIdOf,
  birthSortIds, siblingIds, isValidTree, validateTree, yearOf, norm, searchText
} from '../public/lib/model.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXAMPLE = path.join(__dirname, '..', 'examples', 'lusignan.json');
const loadExample = () => JSON.parse(readFileSync(EXAMPLE, 'utf8'));

test('normalizeDate — structured forms pass through', () => {
  assert.deepEqual(normalizeDate('1815'), { value: '1815', uncertain: false });
  assert.deepEqual(normalizeDate('1815.12'), { value: '1815.12', uncertain: false });
  assert.deepEqual(normalizeDate('1815.12.10'), { value: '1815.12.10', uncertain: false });
  assert.deepEqual(normalizeDate('1815.3.7'), { value: '1815.03.07', uncertain: false }); // zero-pads
});

test('normalizeDate — GEDCOM forms', () => {
  assert.deepEqual(normalizeDate('7 JAN 1996'), { value: '1996.01.07', uncertain: false });
  assert.deepEqual(normalizeDate('SEP 1938'), { value: '1938.09', uncertain: false });
  assert.deepEqual(normalizeDate('ABT 1896'), { value: '1896', uncertain: true });
  assert.deepEqual(normalizeDate('~1900'), { value: '1900', uncertain: true });
  assert.deepEqual(normalizeDate('CIRCA 1700'), { value: '1700', uncertain: true });
});

test('normalizeDate — empty / unrecognized', () => {
  assert.equal(normalizeDate(''), null);
  assert.equal(normalizeDate(null), null);
  assert.equal(normalizeDate(undefined), null);
  assert.equal(normalizeDate('not a date'), null);
});

test('splitPlaceCountry — splits a known trailing country', () => {
  const p = { birth_place: 'London, England' };
  splitPlaceCountry(p, 'birth_place');
  assert.equal(p.birth_place, 'London');
  assert.equal(p.birth_country, 'England');
});

test('splitPlaceCountry — leaves a plain place alone, never overwrites', () => {
  const a = { birth_place: 'Paris' };
  splitPlaceCountry(a, 'birth_place');
  assert.equal(a.birth_place, 'Paris');
  assert.equal(a.birth_country, undefined);

  const b = { birth_place: 'Berlin, Germany', birth_country: 'Existing' };
  splitPlaceCountry(b, 'birth_place');
  assert.equal(b.birth_place, 'Berlin, Germany');     // untouched because country already set
  assert.equal(b.birth_country, 'Existing');
});

test('buildModel — assigns stable, unique ids to people lacking them', () => {
  const m = buildModel({ people: [{ name: 'A' }, { name: 'B' }, { id: 'p1', name: 'C' }] });
  const ids = m.people.map(p => p.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
  for (const id of ids) assert.ok(id, 'every person has an id');
});

test('buildModel — resolves relationships by explicit id', () => {
  const m = buildModel({
    people: [
      { id: 'a', name: 'Parent', sex: 'M', children_ids: ['b'] },
      { id: 'b', name: 'Child', sex: 'F', father_id: 'a' }
    ]
  });
  assert.equal(m.byId.get('b')._father, 'a');
  assert.ok(m.byId.get('a')._children.includes('b'), 'parent gains the child by reciprocity');
});

test('buildModel — disambiguates duplicate names by reciprocity', () => {
  // Two different "Mehmet"; the child names its father "Mehmet". Only the Mehmet
  // who lists the child as his child should be chosen.
  const m = buildModel({
    people: [
      { id: 'm1', name: 'Mehmet', sex: 'M', children: ['Kid'] },
      { id: 'm2', name: 'Mehmet', sex: 'M' },
      { id: 'k', name: 'Kid', sex: 'M', father: 'Mehmet' }
    ]
  });
  assert.equal(m.byId.get('k')._father, 'm1', 'picks the reciprocating parent');
});

test('buildModel — symmetric spouses', () => {
  const m = buildModel({
    people: [
      { id: 'h', name: 'H', sex: 'M', spouse_ids: ['w'] },
      { id: 'w', name: 'W', sex: 'F' }
    ]
  });
  assert.ok(m.byId.get('h')._spouses.includes('w'));
  assert.ok(m.byId.get('w')._spouses.includes('h'), 'spouse link is mirrored');
});

test('buildModel — keeps truly ambiguous references as unresolved (lossless)', () => {
  // Two "Pat"s, neither reciprocating the spouse link nor sharing children: no
  // evidence to choose, so the reference is preserved rather than guessed.
  const m = buildModel({
    people: [
      { id: 'a', name: 'Pat', sex: 'F' },
      { id: 'b', name: 'Pat', sex: 'F' },
      { id: 'c', name: 'X', sex: 'M', spouse: 'Pat' }
    ]
  });
  assert.equal(m.byId.get('c')._spouses.length, 0);
  assert.ok(m.byId.get('c')._unres.spouses.includes('Pat'), 'ambiguous spouse kept as unresolved');
});

test('buildModel — tie-breaks an ambiguous parent by sex (best effort)', () => {
  // Two males named "Twin", neither listing the child: resolver falls back to the
  // first sex-matching candidate rather than dropping the link.
  const m = buildModel({
    people: [
      { id: 'a', name: 'Twin', sex: 'M' },
      { id: 'b', name: 'Twin', sex: 'M' },
      { id: 'c', name: 'X', sex: 'F', father: 'Twin' }
    ]
  });
  assert.equal(m.byId.get('c')._father, 'a');
});

test('buildModel — joins multi-line note arrays into a string', () => {
  const m = buildModel({ people: [{ id: 'a', name: 'A', notes: ['one', 'two'] }] });
  assert.equal(m.byId.get('a').notes, 'one\n\ntwo');
});

test('serialize — round-trips relationships and is idempotent', () => {
  const m1 = buildModel(loadExample());
  const out1 = serialize(m1);
  const m2 = buildModel(JSON.parse(JSON.stringify(out1)));
  const out2 = serialize(m2);

  // same set of people and same key relationships after a full round-trip
  assert.equal(out1.people.length, out2.people.length);
  const guy1 = m1.byId.get('p1'), guy2 = m2.byId.get('p1');
  assert.equal(guy2._father, guy1._father);
  assert.equal(guy2._mother, guy1._mother);
  assert.deepEqual(guy2._spouses, guy1._spouses);
  assert.deepEqual([...guy2._children].sort(), [...guy1._children].sort());
});

test('serialize — drops runtime fields and false flags', () => {
  const m = buildModel({ people: [{ id: 'a', name: 'A', deceased: false, occupation: '' }] });
  const out = serialize(m);
  const a = out.people[0];
  assert.ok(!('_father' in a), 'no underscore fields');
  assert.ok(!('deceased' in a), 'false flags omitted');
  assert.ok(!('occupation' in a), 'empty strings omitted');
});

test('serialize — writes both id and name relationship fields', () => {
  const m = buildModel({
    people: [
      { id: 'a', name: 'Parent', sex: 'M', children_ids: ['b'] },
      { id: 'b', name: 'Child', sex: 'F', father_id: 'a' }
    ]
  });
  const child = serialize(m).people.find(p => p.id === 'b');
  assert.equal(child.father_id, 'a');
  assert.equal(child.father, 'Parent');
});

test('birthSortIds — oldest first, undated keep file order last', () => {
  const m = buildModel({
    people: [
      { id: 'a', name: 'A', birth_date: '1950' },
      { id: 'b', name: 'B' },
      { id: 'c', name: 'C', birth_date: '1930' },
      { id: 'd', name: 'D' }
    ]
  });
  assert.deepEqual(birthSortIds(m, ['a', 'b', 'c', 'd']), ['c', 'a', 'b', 'd']);
});

test('siblingIds — other children of the shared parents', () => {
  const m = buildModel(loadExample());
  const guy = m.byId.get('p1');
  const sibs = siblingIds(m, guy);
  assert.ok(sibs.includes('p4'), 'Aimery is a sibling');
  assert.ok(!sibs.includes('p1'), 'self is excluded');
  assert.ok(!sibs.includes('p11'), 'spouse is not a sibling');
});

test('rootIdOf — prefers lineage:root, falls back to first person', () => {
  assert.equal(rootIdOf(buildModel(loadExample())), 'p1');
  assert.equal(rootIdOf(buildModel({ people: [{ id: 'x', name: 'X' }] })), 'x');
});

test('isValidTree / validateTree', () => {
  assert.equal(isValidTree({ people: [] }), true);
  assert.equal(isValidTree({}), false);
  assert.equal(isValidTree([]), false);
  assert.equal(isValidTree(null), false);
  assert.throws(() => validateTree({ nope: 1 }), /people/);
});

test('helpers — yearOf, norm, searchText', () => {
  assert.equal(yearOf('1896.05'), '1896');
  assert.equal(yearOf('no year'), null);
  assert.equal(norm('İSTANBUL'), 'istanbul');
  assert.ok(searchText({ name: 'Ada', aliases: 'Countess', maiden_name: 'Byron' }).includes('byron'));
});

test('example file — loads, is valid, has Guy as root with no lost references', () => {
  const raw = loadExample();
  assert.ok(isValidTree(raw));
  const m = buildModel(raw);
  assert.equal(rootIdOf(m), 'p1');
  let unresolved = 0;
  for (const p of m.people) {
    const u = p._unres;
    unresolved += (u.father ? 1 : 0) + (u.mother ? 1 : 0) + u.spouses.length + u.children.length;
  }
  assert.equal(unresolved, 0, 'every reference in the example resolves to an id');
});
