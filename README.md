# Ai Translate Desktop

Aplicativo desktop Linux em `Electron + Vite + React` para tradução simultânea de **baixíssima latência** em qualquer
chamada de vídeo ou voz (**Google Meet**, **Microsoft Teams** web/desktop e **Discord** web/desktop) via OpenAI Realtime
(`gpt-realtime-translate`).

## Definições fixas do software

- **Headset fixo (entrada e saída):** o microfone de entrada e a saída de som são sempre o **HyperX Cloud III** (com
  prioridade automática para saída analógica e entrada mono, sem fallback silencioso para microfone de webcam ou
  alto-falantes internos).
- **Compatível com qualquer vídeo chamada:** funciona com **Google Meet**, **Microsoft Teams (web e app instalado)**,
  **Discord (web e app instalado)** e qualquer outro software de chamada no Linux via PipeWire.
- **Idiomas fixos (sempre Português do Brasil ↔ Inglês):**
  - **Outbound (sua fala → chamada):** você fala sempre em **Português do Brasil (`pt-BR`)** e os participantes da
    chamada ouvem em **Inglês (`en`)**.
  - **Inbound (chamada → seu fone):** o áudio da chamada chega sempre em **Inglês (`en`)** e você ouve traduzido em
    **Português do Brasil (`pt-BR`)**.
- **Foco absoluto em latência mínima:** projetado para manter a conversa natural, sem parecer que existe um sistema de
  tradução no meio:
  - Ponte virtual PipeWire em 48 kHz mono com latência alvo de `5 ms` e quantum de `128` amostras (~2,7 ms).
  - WebRTC com `jitterBufferTarget = 0`, `contentHint = 'speech'`, captura 48 kHz mono com DSP do navegador desativado
    por padrão e `AudioContext` em modo `interactive` a 48 kHz.
  - Sessões OpenAI Realtime sem transcrição extra desnecessária e redução de ruído desativada no Inbound (áudio já
    tratado pela chamada).

## Configuração nos aplicativos de chamada

Ao abrir o Ai Translate, os nós virtuais do PipeWire são criados automaticamente (e encerrados ao sair). No **Google
Meet**, **Microsoft Teams (web ou instalado)** ou **Discord (web ou instalado)**, selecione:

- **Microfone (Entrada):** `AI-Translate-Virtual-Mic`
- **Alto-falante (Saída):** `AI-Translate-Call-Speaker`

> **Dica de latência mínima:** no Discord, Teams ou Meet, desative filtros redundantes no microfone virtual (como Krisp
> / supressão de ruído / cancelamento de eco) — a voz traduzida pela OpenAI já sai limpa e isso evita dezenas de
> milissegundos extras de atraso.

## Principais recursos

- **Áudio virtual PipeWire automático:** cria os nós virtuais (`AI-Translate-To-Call`, `AI-Translate-Virtual-Mic`,
  `AI-Translate-Call-Speaker` e `AI-Translate-Call-Capture`) ao iniciar o app e os encerra ao sair. O script
  `./setup-audio.sh` continua disponível como utilitário CLI opcional (`--check` / `--remove`).
- **Tradução bidirecional via WebRTC:** sessões Outbound (`PT-BR → EN`) e Inbound (`EN → PT-BR`) com controle individual
  ou botão único **Iniciar/Parar chamada**.
- **Resiliência e controles em chamada:** reconexão automática rápida com backoff exponencial, rollover preventivo aos
  55 minutos, detecção de desconexão do HyperX Cloud III, medidores de áudio (VU meters), volume da tradução, telemetria
  de `RTT` e `Jitter`, e atalho global de mute (`Ctrl+Shift+M`).
- **Chave da API segura:** armazenada cifrada via Electron `safeStorage` fora do renderer.

## Scripts

- `npm run dev`: inicia o renderer Vite e o Electron em desenvolvimento
- `npm run build`: compila o processo principal/preload e o renderer
- `npm run start`: abre o Electron usando o build local
- `npm run validate`: roda lint (`eslint`), typecheck (`tsc`) e testes unitários (`node --test`)
- `npm run package:dir`: gera o bundle descompactado Linux em `release/`
- `npm run package`: gera os pacotes Linux (`.AppImage` e `.deb`) em `release/`
