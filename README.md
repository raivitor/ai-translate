# boilerplate-2026

Boilerplate com `web` em `Next.js 16 + React 19` e `api` em `Express + TypeScript + Drizzle + Postgres`.

## Criar um projeto novo

O fluxo principal agora é:

```bash
npm run bootstrap -- meu-projeto
``` 

Isso atualiza os nomes do projeto, `package.json`, lockfiles, `README`s e os defaults de banco em
`api/.env.example` e `api/docker-compose.yml`.

O formato abaixo tambem funciona:

```bash
npm run bootstrap --meu-projeto
```

Mas no `npm 11` ele gera um warning de CLI desconhecida. O formato com `-- meu-projeto` eh o
recomendado.

## Depois do bootstrap

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

Para desenvolvimento:

```bash
npm run dev --prefix api
npm run dev --prefix web
```

Para validar tudo:

```bash
npm run ci:simulate
```
