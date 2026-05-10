import type { NextFunction, Request, Response } from 'express'
import type { ZodSchema } from 'zod'
import { ZodError } from 'zod'

import { formatZodError } from '../utils/validation.js'

/**
 * Middleware factory para validação com Zod
 * @param schema - Schema Zod para validar o body da requisição
 * @returns Middleware Express que valida e retorna 400 em caso de erro
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Valida e transforma o body
      req.body = await schema.parseAsync(req.body)
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        const formatted = formatZodError(error)
        res.status(400).json(formatted)
        return
      }

      // Erro inesperado
      console.error('Erro de validação inesperado:', error)
      res.status(500).json({
        message: 'Erro interno de validação',
        errors: ['Erro inesperado ao validar dados'],
      })
    }
  }
}

/**
 * Middleware factory para validação de query params
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedQuery = await schema.parseAsync(req.query)
      req.query = parsedQuery as Request['query']
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        const formatted = formatZodError(error)
        res.status(400).json(formatted)
        return
      }

      console.error('Erro de validação inesperado:', error)
      res.status(500).json({
        message: 'Erro interno de validação',
        errors: ['Erro inesperado ao validar parâmetros'],
      })
    }
  }
}

/**
 * Middleware factory para validação de params
 */
export function validateParameters<T>(schema: ZodSchema<T>) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParameters = await schema.parseAsync(req.params)
      req.params = parsedParameters as Request['params']
      next()
    } catch (error) {
      if (error instanceof ZodError) {
        const formatted = formatZodError(error)
        res.status(400).json(formatted)
        return
      }

      console.error('Erro de validação inesperado:', error)
      res.status(500).json({
        message: 'Erro interno de validação',
        errors: ['Erro inesperado ao validar parâmetros'],
      })
    }
  }
}
