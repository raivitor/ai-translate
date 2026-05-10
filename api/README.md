# API Boilerplate

Boilerplate mínimo em `Express + TypeScript + Drizzle + Postgres`, com:

- healthcheck em `/healthcheck` e `/api/healthcheck`
- CRUD completo de exemplo em `/api/items`
- validação com `zod`
- testes unitários e de integração com `node:test` e `supertest`

## Estrutura

- `src/app.ts`: configuração do Express e healthcheck
- `src/routes`: rotas HTTP
- `src/controllers`: camada HTTP
- `src/services`: regras de negócio
- `src/database`: client do Drizzle e schema do banco
- `src/test`: setup e fixtures para integração

## Endpoints

- `GET /healthcheck`
- `GET /api/healthcheck`
- `GET /api/items`
- `GET /api/items/:id`
- `POST /api/items`
- `PUT /api/items/:id`
- `DELETE /api/items/:id`

## Scripts

- `npm run dev`: sobe a API em modo watch
- `npm run build`: compila para `dist`
- `npm test`: executa testes unitários
- `npm run test:integration`: executa integrações HTTP com banco real
- `npm run test:all`: executa unitários + integração
- `npm run validate`: roda lint, typecheck e testes unitários

## Banco de dados

1. Copie `api/.env.example` para `api/.env`.
2. Configure `DATABASE_URL`.
3. Configure `TEST_DATABASE_URL` apontando para um banco de testes dedicado.
4. Rode `npm run db:migrate`.

Para desenvolvimento local, o `docker-compose.yml` sobe um Postgres simples para a `DATABASE_URL`.
