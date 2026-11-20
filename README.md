# Ai Translate Desktop

Aplicativo desktop Linux em `Electron + Vite + React` para tradução simultânea de chamadas no Google Meet via OpenAI
Realtime (`gpt-realtime-translate`).

## Principais recursos

- **Áudio virtual PipeWire automático:** cria os nós virtuais (`AI-Translate-To-Meet`,
  `AI-Translate-Virtual-Mic-for-Meet`, `AI-Translate-From-Meet` e `AI-Translate-Meet-Audio-Capture`) ao iniciar o app e
  os encerra ao sair. O script `./setup-audio.sh` continua disponível como utilitário CLI opcional (`--check` /
  `--remove`).
- **Tradução bidirecional via WebRTC:** sessões Outbound (sua fala) e Inbound (áudio do Meet) com controle individual ou
  botão único **Iniciar/Parar reunião**.
- **Resiliência e controles em reunião:** reconexão automática com backoff, rollover preventivo aos 55 minutos, hot-swap
  de microfone/saída ao vivo, medidores de áudio (VU meters), volume da tradução, telemetria RTT e atalho global de mute
  (`Ctrl+Shift+M`).
- **Chave da API segura:** armazenada cifrada via Electron `safeStorage` fora do renderer.

## Scripts

- `npm run dev`: inicia o renderer Vite e o Electron em desenvolvimento
- `npm run build`: compila o processo principal/preload e o renderer
- `npm run start`: abre o Electron usando o build local
- `npm run validate`: roda lint (`eslint`), typecheck (`tsc`) e testes unitários (`node --test`)
- `npm run package:dir`: gera o bundle descompactado Linux em `release/`
- `npm run package`: gera os pacotes Linux (`.AppImage` e `.deb`) em `release/`
