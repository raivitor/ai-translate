import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  resolveTranslationLanguageCode,
  SUPPORTED_TRANSLATION_LANGUAGE_CODES,
  TRANSLATION_ROUTES,
} from './translationLanguages.js'

test('TRANSLATION_ROUTES fixes outbound to PT-BR -> EN and inbound to EN -> PT-BR', () => {
  assert.deepStrictEqual(TRANSLATION_ROUTES.outbound, {
    sourceLabel: 'Português (Brasil)',
    targetLanguage: 'en',
    targetLabel: 'Inglês',
  })

  assert.deepStrictEqual(TRANSLATION_ROUTES.inbound, {
    sourceLabel: 'Inglês',
    targetLanguage: 'pt',
    targetLabel: 'Português (Brasil)',
  })

  assert.deepStrictEqual([...SUPPORTED_TRANSLATION_LANGUAGE_CODES], ['en', 'pt'])
})

test('resolveTranslationLanguageCode accepts Brazilian Portuguese and English variants only', () => {
  assert.strictEqual(resolveTranslationLanguageCode('pt'), 'pt')
  assert.strictEqual(resolveTranslationLanguageCode('pt-BR'), 'pt')
  assert.strictEqual(resolveTranslationLanguageCode('  PT_br  '), 'pt')
  assert.strictEqual(resolveTranslationLanguageCode('en'), 'en')
  assert.strictEqual(resolveTranslationLanguageCode('en-US'), 'en')
  assert.strictEqual(resolveTranslationLanguageCode('en_GB'), 'en')

  assert.strictEqual(resolveTranslationLanguageCode('pt-PT'), undefined)
  assert.strictEqual(resolveTranslationLanguageCode('es'), undefined)
  assert.strictEqual(resolveTranslationLanguageCode('fr'), undefined)
  assert.strictEqual(resolveTranslationLanguageCode('ar'), undefined)
  assert.strictEqual(resolveTranslationLanguageCode(''), undefined)
})
