import type { ZodError } from 'zod'

/**
 * Formato padrão de erro de validação
 */
export interface ValidationErrorResponse {
  message: string
  errors: string[]
}

/**
 * Formata erros do Zod para formato padronizado da API
 * @param error - Erro do Zod
 * @returns Objeto com mensagem e array de erros
 */
export function formatZodError(error: ZodError): ValidationErrorResponse {
  const errors = error.issues.map(err => {
    const path = err.path.length > 0 ? `${err.path.join('.')}: ` : ''
    return `${path}${err.message}`
  })

  return {
    message: 'Dados inválidos',
    errors,
  }
}
