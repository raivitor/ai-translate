# Ai Translate

Aplicacao baseada no `boilerplate-2026`, com `web` em `Next.js 16 + React 19` e `api` em `Express + TypeScript + Drizzle + Postgres`.

## Requisitos

- Node 24
- npm 11+

## Setup inicial

```bash
cp api/.env.example api/.env
nvm use
npm ci --prefix api
npm ci --prefix web
```

Se for usar Postgres local via Docker:

```bash
docker compose -f api/docker-compose.yml up -d
npm run db:migrate --prefix api
```

## Desenvolvimento

```bash
npm run dev --prefix api
npm run dev --prefix web
```

## Qualidade

```bash
npm run ci:simulate
npm run format:all
```
