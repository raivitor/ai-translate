# Ai Translate API

Backend local em `Express + TypeScript`, com:

- healthcheck em `/healthcheck` e `/api/healthcheck`
- CORS configurado para o renderer Electron/Vite
- criacao de client secrets efemeros em `/api/realtime/translations/client-secret`
- testes unitarios e de integracao com `node:test` e `supertest`

## Scripts

- `npm run dev`: sobe a API em modo watch
- `npm run build`: compila para `dist`
- `npm test`: executa testes unitarios
- `npm run test:integration`: executa integracoes HTTP locais
- `npm run test:all`: executa unitarios + integracao
- `npm run validate`: roda lint, typecheck e testes unitarios

## Configuracao

1. Copie `api/.env.example` para `api/.env`.
2. Configure `OPENAI_API_KEY` para criar sessoes reais com a OpenAI.
3. Mantenha `OPENAI_REALTIME_MODEL=gpt-realtime-translate`.
