# Ai Translate

Aplicacao desktop para preparar traducao em tempo real de conversas no Google Meet usando `Electron + React`, backend local em `Node/Express`, OpenAI Realtime Translation via WebRTC e roteamento de audio com VB-CABLE.

Esta etapa deixa a infraestrutura pronta. A captura de audio, criacao de sessoes WebRTC e traducao real entram na proxima fase.

## Requisitos

- Node 24
- npm 11+
- VB-CABLE instalado no Windows para o fluxo real de audio

## Setup inicial

```bash
cp api/.env.example api/.env
nvm use
npm install
```

Configure `OPENAI_API_KEY` em `api/.env` apenas quando for implementar ou testar a integracao real com a OpenAI.

## Desenvolvimento

```bash
npm run dev:api
npm run dev:desktop
```

O renderer Electron usa `http://127.0.0.1:5173` em desenvolvimento e a API local usa `http://localhost:3001`.

## Fluxo de audio planejado

- Google Meet usa VB-CABLE como microfone.
- O app desktop captura/processa o audio local em uma fase futura.
- A sessao `gpt-realtime-translate` usa WebRTC para receber audio de origem e devolver audio traduzido.
- O usuario escuta a traducao em portugues no fone fisico.

## Qualidade

```bash
npm run validate
npm run build
npm run format:all
```
