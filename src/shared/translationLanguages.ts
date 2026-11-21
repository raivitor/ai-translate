export type TranslationLanguageCode = 'en' | 'pt'

export const SUPPORTED_TRANSLATION_LANGUAGE_CODES: ReadonlySet<string> = new Set<TranslationLanguageCode>(['en', 'pt'])

export const TRANSLATION_ROUTES = {
  outbound: {
    sourceLabel: 'Português (Brasil)',
    targetLanguage: 'en',
    targetLabel: 'Inglês',
  },
  inbound: {
    sourceLabel: 'Inglês',
    targetLanguage: 'pt',
    targetLabel: 'Português (Brasil)',
  },
} as const

export function resolveTranslationLanguageCode(rawLanguage: string): TranslationLanguageCode | undefined {
  const normalized = rawLanguage.trim().toLowerCase().replaceAll('_', '-')

  if (normalized === 'pt' || normalized === 'pt-br') {
    return 'pt'
  }

  if (normalized === 'en' || normalized === 'en-us' || normalized === 'en-gb') {
    return 'en'
  }

  return undefined
}
