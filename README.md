# Ai Translate

Aplicacao desktop para preparar traducao em tempo real de conversas no Google Meet usando `Electron + React`, backend local em `Node/Express`, OpenAI Realtime Translation via WebRTC e roteamento de audio com VB-CABLE.

O MVP atual captura seu microfone no Electron, cria uma sessao efemera de
Realtime Translation no backend local, envia audio por WebRTC para a OpenAI e
toca o audio traduzido em ingles no dispositivo de saida escolhido.

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

## Fluxo de audio MVP

- Google Meet usa VB-CABLE/Voicemeeter como microfone.
- Google Meet usa seu fone normal como alto-falante.
- O app desktop captura seu microfone fisico.
- A sessao `gpt-realtime-translate` traduz PT -> EN via WebRTC.
- O app toca o audio traduzido em VB-CABLE/Voicemeeter.

## Fluxo avancado futuro

- Google Meet usa a saida traduzida PT -> EN como microfone.
- Google Meet usa um cabo virtual separado como alto-falante.
- O app captura esse cabo virtual, traduz EN -> PT e toca no seu fone.

## Observacao Windows

Parte do desenvolvimento compila no WSL2, mas os testes reais de dispositivos,
VB-CABLE/Voicemeeter, `setSinkId` e Electron como app desktop precisam rodar no
Windows 11 nativo.

## Qualidade

```bash
npm run validate
npm run build
npm run format:all
```
