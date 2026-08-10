import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLanguage } from '../public/lib/i18n.js';

test('initialLanguage — saved manual choice wins', () => {
  assert.equal(initialLanguage('tr', 'en-US'), 'tr');
  assert.equal(initialLanguage('en', 'tr-TR'), 'en');
});

test('initialLanguage — Turkish system locales default to Turkish', () => {
  assert.equal(initialLanguage(null, 'tr'), 'tr');
  assert.equal(initialLanguage(null, 'tr-TR'), 'tr');
  assert.equal(initialLanguage(null, 'TR_tr'), 'tr');
});

test('initialLanguage — every other or missing locale defaults to English', () => {
  assert.equal(initialLanguage(null, 'en-US'), 'en');
  assert.equal(initialLanguage(null, 'de-DE'), 'en');
  assert.equal(initialLanguage(null, ''), 'en');
  assert.equal(initialLanguage('invalid', 'tr-TR'), 'tr');
});
