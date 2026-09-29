import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLocale, t } from '../src/i18n';

test('English and German with parameters', () => {
  setLocale('en');
  assert.equal(t('prefs.testOk', { n: 3, model: 'm', dims: 4096, ms: 12 }), 'Connected: 3 models on the server; m returns 4096 dimensions (12 ms).');
  setLocale('de');
  assert.equal(t('prefs.indexNow'), 'Jetzt indexieren');
  setLocale(null);
});
