# Ai Translate Desktop

Desktop shell em `Electron + Vite + React`.

O renderer lista microfones e saidas de audio, captura o microfone escolhido,
abre uma sessao WebRTC com `gpt-realtime-translate` e toca a traducao no
dispositivo de saida escolhido, normalmente VB-CABLE/Voicemeeter para alimentar
o microfone do Google Meet.

## Scripts

- `npm run dev`: sobe o renderer Vite para uso com Electron em desenvolvimento
- `npm run build`: compila TypeScript e gera o renderer
- `npm run start`: abre o Electron usando o build local
- `npm run validate`: roda lint, typecheck e testes
