# Ai Translate

Aplicacao desktop para preparar traducao em tempo real de conversas no Google Meet usando `Electron + React`, backend local em `Node/Express`, OpenAI Realtime Translation via WebRTC e roteamento de audio virtual no Linux com PipeWire/PulseAudio.

O MVP atual captura seu microfone no Electron, cria uma sessao efemera de
Realtime Translation no backend local, envia audio por WebRTC para a OpenAI e
toca o audio traduzido em ingles no dispositivo de saida escolhido.

## Requisitos

- Node 24
- npm 11+
- Linux com PipeWire + WirePlumber + `pipewire-pulse`, ou PulseAudio
- `pactl` disponivel no PATH

## Setup inicial

```bash
cp api/.env.example api/.env
nvm use
npm install
```

Configure `OPENAI_API_KEY` em `api/.env` apenas quando for implementar ou testar a integracao real com a OpenAI.

## Desenvolvimento

```bash
./setup-audio.sh
npm start
```

O renderer Electron usa `http://127.0.0.1:5173` em desenvolvimento e a API local usa `http://localhost:3001`.

## Setup de audio Linux

`./setup-audio.sh` cria dispositivos virtuais temporarios na sessao de audio do usuario:

- `AI-Translate-To-Meet`: saida onde o app toca a traducao PT -> EN.
- `AI-Translate-Virtual-Mic-for-Meet`: microfone virtual que o Meet deve usar.
- `AI-Translate-From-Meet`: saida que o Meet deve usar como alto-falante.
- `AI-Translate-Meet-Audio-Capture`: entrada que o app captura para traduzir EN -> PT.

Comandos uteis:

```bash
./setup-audio.sh --check
./setup-audio.sh --remove
```

## Fluxo de audio

- Google Meet usa `AI-Translate-Virtual-Mic-for-Meet` como microfone.
- Google Meet usa `AI-Translate-From-Meet` como alto-falante.
- O app desktop captura seu microfone fisico.
- A sessao `gpt-realtime-translate` traduz PT -> EN via WebRTC.
- O app toca o audio traduzido em `AI-Translate-To-Meet`.
- O app captura `AI-Translate-Meet-Audio-Capture`, traduz EN -> PT e toca no seu fone.

## Qualidade

```bash
npm run validate
npm run build
npm run format:all
```
