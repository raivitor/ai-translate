# Ai Translate API

API em `Express + TypeScript + Drizzle + Postgres`, com:

- healthcheck em `/healthcheck` e `/api/healthcheck`
- CRUD de exemplo em `/api/items`
- validacao com `zod`
- testes unitarios e de integracao com `node:test` e `supertest`

## Scripts

- `npm run dev`: sobe a API em modo watch
- `npm run build`: compila para `dist`
- `npm test`: executa testes unitarios
- `npm run test:integration`: executa integracoes HTTP com banco real
- `npm run test:all`: executa unitarios + integracao
- `npm run validate`: roda lint, typecheck e testes unitarios

## Banco de dados

1. Copie `api/.env.example` para `api/.env`.
2. Configure `DATABASE_URL`.
3. Configure `TEST_DATABASE_URL` apontando para um banco de testes dedicado.
4. Rode `npm run db:migrate`.

Para desenvolvimento local, o `docker-compose.yml` sobe um Postgres simples para a `DATABASE_URL`.
