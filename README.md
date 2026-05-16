# Ai Translate Desktop

Desktop shell em `Electron + Vite + React`.

O renderer lista microfones e saidas de audio, captura o microfone escolhido,
abre uma sessao WebRTC com `gpt-realtime-translate` e toca a traducao no
dispositivo de saida escolhido. No Linux, rode `./setup-audio.sh` na raiz do
repositorio para criar os sinks/sources virtuais usados pelo Google Meet.

## Scripts

- `npm run dev`: sobe o renderer Vite para uso com Electron em desenvolvimento
- `npm run build`: compila TypeScript e gera o renderer
- `npm run start`: abre o Electron usando o build local
- `npm run validate`: roda lint, typecheck e testes
