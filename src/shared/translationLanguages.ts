export const TRANSLATION_LANGUAGES = [
  { code: 'pt', label: 'Português (Brasil)' },
  { code: 'en', label: 'Inglês' },
] as const

export type TranslationLanguageCode = (typeof TRANSLATION_LANGUAGES)[number]['code']
export type TranslationLanguageOption = (typeof TRANSLATION_LANGUAGES)[number]

export const SUPPORTED_TRANSLATION_LANGUAGE_CODES = new Set<string>(
  TRANSLATION_LANGUAGES.map(language => language.code),
)

export function resolveTranslationLanguageCode(rawLanguage: string): TranslationLanguageCode | undefined {
  const normalized = rawLanguage.trim().toLowerCase()
  const canonicalCode = normalized === 'pt-br' ? 'pt' : normalized

  return SUPPORTED_TRANSLATION_LANGUAGE_CODES.has(canonicalCode)
    ? (canonicalCode as TranslationLanguageCode)
    : undefined
}
