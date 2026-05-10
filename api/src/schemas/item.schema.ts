import { z } from 'zod'

const itemNameSchema = z
  .string({
    message: 'Nome é obrigatório',
  })
  .trim()
  .min(1, 'Nome é obrigatório')
  .max(120, 'Nome deve ter no máximo 120 caracteres')

const itemDescriptionSchema = z
  .string({
    message: 'Descrição deve ser um texto',
  })
  .trim()
  .min(1, 'Descrição não pode ser vazia')
  .max(500, 'Descrição deve ter no máximo 500 caracteres')
  .nullable()

export const itemIdParametersSchema = z
  .object({
    id: z.string().uuid('ID inválido'),
  })
  .strict()

export const createItemSchema = z
  .object({
    name: itemNameSchema,
    description: itemDescriptionSchema.optional(),
  })
  .strict()

export const updateItemSchema = z
  .object({
    name: itemNameSchema.optional(),
    description: itemDescriptionSchema.optional(),
  })
  .strict()
  .refine(data => Object.keys(data).length > 0, {
    message: 'Informe ao menos um campo para atualização',
  })

export type ItemIdParameters = z.infer<typeof itemIdParametersSchema>
export type CreateItemInput = z.infer<typeof createItemSchema>
export type UpdateItemInput = z.infer<typeof updateItemSchema>
