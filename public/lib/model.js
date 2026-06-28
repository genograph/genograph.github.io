/* ============================================================
 * Famaile Tree — pure data model (no DOM, no globals)
 *
 * Loads a raw tree object ({ people: [...] }) into a working model,
 * resolving relationships by stable id (names can repeat in a family),
 * and serializes it back to a clean, portable JSON shape.
 *
 * Imported both by the browser app and by the Node test suite.
 * ============================================================ */
'use strict';

/* ---------------- small utilities ---------------- */

/** Coerce a value into an array: null -> [], scalar -> [scalar], array -> itself. */
export const asArr = v => v == null ? [] : (Array.isArray(v) ? v : [v]);

// Turkish-aware lowercase folding so search/matching ignores diacritics.
const TRMAP = { 'ı': 'i', 'i̇': 'i', 'ş': 's', 'ğ': 'g', 'ü': 'u', 'ö': 'o', 'ç': 'c', 'â': 'a', 'î': 'i', 'û': 'u' };
export const norm = s => String(s ?? '').toLocaleLowerCase('tr').replace(/[ıi̇şğüöçâîû]/g, c => TRMAP[c] || c);

/** Normalized, searchable text for a person (name + aliases + maiden name). */
export const searchText = p => norm([p.name, p.aliases, p.maiden_name].filter(Boolean).join(' '));

/** First 4-digit year found in a date-ish string, or null. */
export const yearOf = d => { const m = /\d{4}/.exec(String(d ?? '')); return m ? m[0] : null; };

/* ---------------- dates ---------------- */
/* Structured dates: YYYY / YYYY.MM / YYYY.MM.DD plus an "uncertain" flag.
   Legacy GEDCOM-style values ("7 JAN 1996", "SEP 1938", "ABT 1896") are
   normalized on load; ABT/EST/CIRCA/~ prefixes become the uncertain flag. */
const GMON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const pad2 = n => String(n).padStart(2, '0');

/** Matches an already-structured date value (used for UI validation). */
export const DATE_RE = /^\d{4}(\.\d{2})?(\.\d{2})?$/;

/**
 * Normalize a free-form date string into { value, uncertain } or null.
 * Returns null for empty/unrecognized input (unless an uncertainty prefix
 * was present, in which case the cleaned remainder is kept).
 */
export function normalizeDate(s) {
  if (s == null || s === '') return null;
  let str = String(s).trim(), uncertain = false;
  const ab = /^(ABT|ABOUT|EST|CAL|CIRCA|CA\.?|C\.|~)\s*/i.exec(str);
  if (ab) { uncertain = true; str = str.slice(ab[0].length).trim(); }
  let m = /^(\d{4})(?:\.(\d{1,2}))?(?:\.(\d{1,2}))?$/.exec(str);
  if (m) return { value: m[1] + (m[2] ? '.' + pad2(+m[2]) : '') + (m[3] ? '.' + pad2(+m[3]) : ''), uncertain };
  m = /^(\d{1,2})\s+([A-Z]{3})\s+(\d{3,4})$/i.exec(str);
  if (m && GMON[m[2].toUpperCase()]) return { value: `${m[3]}.${pad2(GMON[m[2].toUpperCase()])}.${pad2(+m[1])}`, uncertain };
  m = /^([A-Z]{3})\s+(\d{3,4})$/i.exec(str);
  if (m && GMON[m[1].toUpperCase()]) return { value: `${m[2]}.${pad2(GMON[m[1].toUpperCase()])}`, uncertain };
  return uncertain ? { value: str, uncertain } : null;
}

/* ---------------- causes of death ---------------- */
export const CAUSES = ['natural', 'illness', 'accident', 'war', 'childbirth', 'homicide', 'suicide', 'unknown', 'other'];

/* ---------------- places ---------------- */
/* Known country names (normalized) used to split legacy "City, Region, Country"
   place strings into a place + a separate country field on first load. */
const COUNTRIES = new Set([
  'turkey', 'turkiye', 'cyprus', 'kibris', 'kktc', 'northern cyprus', 'kuzey kibris',
  'united states', 'united states of america', 'usa', 'us',
  'england', 'united kingdom', 'uk', 'scotland', 'wales', 'ireland',
  'germany', 'almanya', 'greece', 'yunanistan', 'italy', 'italya', 'spain', 'ispanya',
  'france', 'fransa', 'netherlands', 'hollanda', 'australia', 'avustralya',
  'canada', 'kanada', 'singapore', 'singapur', 'belgium', 'belcika',
  'austria', 'switzerland', 'sweden', 'norway', 'denmark', 'portugal', 'poland',
  'russia', 'ukraine', 'romania', 'bulgaria', 'serbia', 'croatia', 'hungary',
  'israel', 'lebanon', 'syria', 'egypt', 'iran', 'iraq', 'jordan',
  'india', 'china', 'japan', 'brazil', 'argentina', 'mexico', 'new zealand', 'south africa'
]);

/** If p[key] ends in a recognized country and p has no country yet, split it out. */
export function splitPlaceCountry(p, key) {
  const ck = key.replace('_place', '_country');
  if (p[ck] || !p[key]) return;
  const parts = String(p[key]).split(',').map(s => s.trim()).filter(Boolean);
  if (!parts.length) return;
  if (COUNTRIES.has(norm(parts[parts.length - 1]))) {
    p[ck] = parts.pop();
    if (parts.length) p[key] = parts.join(', '); else delete p[key];
  }
}

/* ---------------- ordering helpers ---------------- */

/** Sort ids oldest -> youngest; people without a birth date keep file order, after the dated ones. */
export function birthSortIds(model, ids) {
  const key = id => {
    const p = model.byId.get(id);
    return (p && p.birth_date && /^\d{4}/.test(p.birth_date)) ? String(p.birth_date) : '9999.99.99';
  };
  return ids.map((id, i) => [id, i])
    .sort((a, b) => { const ka = key(a[0]), kb = key(b[0]); return ka < kb ? -1 : ka > kb ? 1 : a[1] - b[1]; })
    .map(x => x[0]);
}

/** The other children of this person's father and/or mother (deduped, birth-sorted). */
export function siblingIds(model, p) {
  const ids = new Set();
  for (const parId of [p._father, p._mother]) {
    const parent = parId && model.byId.get(parId);
    if (parent) for (const c of parent._children) if (c !== p.id) ids.add(c);
  }
  return birthSortIds(model, [...ids]);
}

/* ---------------- validation ---------------- */

/** True when data looks like a tree document (an object with a people array). */
export function isValidTree(data) {
  return !!data && typeof data === 'object' && !Array.isArray(data) && Array.isArray(data.people);
}

/** Throwing variant used at trust boundaries (import / API). */
export function validateTree(data) {
  if (!isValidTree(data)) throw new Error('Not a valid tree file: expected an object with a "people" array.');
  return data;
}

/* ---------------- build (migrate) ---------------- */

/**
 * Build a working model from a raw tree object.
 *
 * - Assigns stable ids to people that lack one.
 * - Normalizes dates and splits legacy place/country strings.
 * - Resolves father/mother/spouse/children to ids, preferring explicit
 *   *_id fields, then disambiguating duplicate names by reciprocity.
 * - Records still-ambiguous name references on `_unres` so nothing is lost.
 * - Mirrors relationships (parent<->child, spouse<->spouse).
 *
 * Mutates the person objects inside `raw.people` (adds `_`-prefixed runtime
 * fields and normalized values) and returns { raw, people, byId }.
 */
export function buildModel(raw) {
  validateTree(raw);
  const people = raw.people;

  // stable ids
  const used = new Set();
  people.forEach((p, i) => {
    if (!p.id) p.id = 'p' + (i + 1);
    while (used.has(p.id)) p.id += 'x';
    used.add(p.id);
  });

  const byId = new Map(people.map(p => [p.id, p]));
  const byName = new Map();
  for (const p of people) {
    if (!byName.has(p.name)) byName.set(p.name, []);
    byName.get(p.name).push(p);
  }

  // resolve a name reference to an id, using a scorer to disambiguate duplicates
  function resolve(refName, scorer) {
    if (!refName) return null;
    const cands = byName.get(refName) || [];
    if (!cands.length) return null;
    if (cands.length === 1) return cands[0].id;
    let best = null, bs = 0;
    for (const c of cands) { const s = scorer(c); if (s > bs) { bs = s; best = c; } }
    return best ? best.id : null;   // ambiguous with no evidence -> leave unresolved
  }

  for (const p of people) {
    if (Array.isArray(p.notes)) p.notes = p.notes.join('\n\n');
    for (const f of ['birth_date', 'death_date']) {
      const r = normalizeDate(p[f]);
      if (r) { p[f] = r.value; if (r.uncertain) p[f + '_uncertain'] = true; }
    }
    splitPlaceCountry(p, 'birth_place');
    splitPlaceCountry(p, 'death_place');
    p._unres = { father: null, mother: null, spouses: [], children: [] };

    // father / mother
    if (p.father_id && byId.has(p.father_id)) p._father = p.father_id;
    else {
      p._father = resolve(p.father, c => (asArr(c.children).includes(p.name) ? 2 : 0) + (c.sex === 'M' ? 1 : 0));
      if (p.father && !p._father) p._unres.father = p.father;
    }
    if (p.mother_id && byId.has(p.mother_id)) p._mother = p.mother_id;
    else {
      p._mother = resolve(p.mother, c => (asArr(c.children).includes(p.name) ? 2 : 0) + (c.sex === 'F' ? 1 : 0));
      if (p.mother && !p._mother) p._unres.mother = p.mother;
    }

    // spouses
    if (Array.isArray(p.spouse_ids) && p.spouse_ids.every(id => byId.has(id))) p._spouses = [...p.spouse_ids];
    else {
      p._spouses = [];
      for (const sn of asArr(p.spouse)) {
        const id = resolve(sn, c =>
          (asArr(c.spouse).includes(p.name) ? 2 : 0) +
          (asArr(c.children).some(ch => asArr(p.children).includes(ch)) ? 1 : 0));
        if (id && id !== p.id) p._spouses.push(id);
        else if (!id) p._unres.spouses.push(sn);
      }
    }

    // children
    if (Array.isArray(p.children_ids) && p.children_ids.every(id => byId.has(id))) p._children = [...p.children_ids];
    else {
      p._children = [];
      for (const cn of asArr(p.children)) {
        const id = resolve(cn, c => ((c.father === p.name || c.mother === p.name) ? 2 : 0));
        if (id && id !== p.id) p._children.push(id);
        else if (!id) p._unres.children.push(cn);
      }
    }
  }

  // reciprocity: parents' child lists & symmetric spouses
  for (const p of people) {
    if (p._father && byId.has(p._father)) {
      const f = byId.get(p._father);
      if (!f._children.includes(p.id)) f._children.push(p.id);
    }
    if (p._mother && byId.has(p._mother)) {
      const m = byId.get(p._mother);
      if (!m._children.includes(p.id)) m._children.push(p.id);
    }
    for (const s of p._spouses) {
      const sp = byId.get(s);
      if (sp && !sp._spouses.includes(p.id)) sp._spouses.push(p.id);
    }
  }

  return { raw, people, byId };
}

/** The reference/root person id for a model: lineage:'root', else the first person. */
export function rootIdOf(model) {
  const root = model.people.find(p => p.lineage === 'root') || model.people[0];
  return root ? root.id : null;
}

/* ---------------- serialize ---------------- */

/**
 * Serialize a model back to a clean tree object suitable for writing to disk.
 * Drops `_`-prefixed runtime fields and empty values, writes both id-based and
 * name-based relationship fields for portability, and refreshes the summary.
 */
export function serialize(model) {
  const nameOf = id => model.byId.get(id)?.name;
  const SKIP = new Set(['father', 'mother', 'spouse', 'children', 'father_id', 'mother_id', 'spouse_ids', 'children_ids', 'id', 'name']);
  const people = model.people.map(p => {
    const o = { id: p.id, name: p.name };
    for (const k of Object.keys(p)) {
      if (k.startsWith('_') || SKIP.has(k)) continue;
      const v = p[k];
      if (v === '' || v == null) continue;
      if (v === false) continue;   // false flags (deceased, *_uncertain, …) are simply omitted
      o[k] = v;
    }
    if (p._father) { o.father = nameOf(p._father); o.father_id = p._father; }
    else if (p._unres.father) o.father = p._unres.father;
    if (p._mother) { o.mother = nameOf(p._mother); o.mother_id = p._mother; }
    else if (p._unres.mother) o.mother = p._unres.mother;
    const spNames = [...p._spouses.map(nameOf), ...p._unres.spouses].filter(Boolean);
    if (spNames.length) {
      o.spouse = spNames.length === 1 ? spNames[0] : spNames;
      if (p._spouses.length) o.spouse_ids = [...p._spouses];
    }
    const chNames = [...p._children.map(nameOf), ...p._unres.children].filter(Boolean);
    if (chNames.length) {
      o.children = chNames;
      if (p._children.length) o.children_ids = [...p._children];
    }
    return o;
  });
  const raw = model.raw;
  raw.people = people;
  raw.summary = raw.summary || {};
  raw.summary.total_people = people.length;
  raw.summary.last_modified = new Date().toISOString();
  return raw;
}
