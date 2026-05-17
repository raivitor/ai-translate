# Repository Guidelines

## Project Overview

Ai Translate is a Linux desktop app for real-time Google Meet translation. Electron/React captures microphone or Meet
audio, the Electron main process creates ephemeral OpenAI Realtime Translation sessions via IPC, and WebRTC streams PT
-> EN and EN -> PT audio. PipeWire/PulseAudio helpers manage the virtual audio devices.

## Project Structure & Module Organization

This is a single-package Electron + Vite + React app. Main code is in `src/main`, preload in `src/preload`, and renderer
UI/services in `src/renderer`.

- `src/main/apiKeyStore.ts`: encrypts/decrypts the `OPENAI_API_KEY` via `safeStorage` and persists it to
  `userData/api-key.enc`.
- `src/main/openaiRealtimeHandler.ts`: creates ephemeral client secrets by calling the OpenAI Realtime API.
- IPC channels (`aiTranslate:*`) bridge the main process to the renderer via the preload.
- Root utilities live in `setup-audio.sh` and `check-package-age.cjs`. Do not edit generated `dist/` output.

## Build, Test, and Development Commands

- `nvm use && npm install`: use Node 24 and install dependencies.
- `./setup-audio.sh`: create Linux virtual audio devices.
- `npm start` or `npm run dev`: run the desktop app.
- `npm run build`: compile the app.
- `npm run validate`: run lint, typecheck, and tests.
- `npm test`: run unit tests.

## Coding Style & Naming Conventions

Use TypeScript ES modules. `.editorconfig` enforces UTF-8, LF endings, final newlines, and 2-space indentation. Prettier
is the formatting source of truth.

Follow existing naming patterns: React components use `PascalCase.tsx`, services/modules use descriptive `camelCase` or
lowercase names, and tests use `*.unit.spec.ts` or `*.integration.spec.ts`. Prefer explicit type imports and sorted
imports.

## Testing Guidelines

The desktop uses Node's test runner. Unit tests should be colocated as `*.unit.spec.ts`; add focused tests for
non-trivial logic outside UI rendering (e.g., `openaiRealtimeHandler.unit.spec.ts`).

Run targeted tests, then `npm run validate`.

## Commit & Pull Request Guidelines

Git history uses concise Conventional Commit-style prefixes, mainly `feat:` and `fix:`. Keep commits scoped to one
change, for example `fix: handle realtime session errors`.

PRs should include a short summary, test results, linked issues when applicable, and screenshots or recordings for
desktop UI changes. Mention audio setup or OpenAI integration behavior.

## Security & Configuration Tips

The `OPENAI_API_KEY` is entered through the in-app Settings screen and stored encrypted in the OS user data directory
via Electron `safeStorage`. It never touches the renderer process. Do not commit secrets or log the API key. The OpenAI
Realtime model is hardcoded as `gpt-realtime-translate` in `openaiRealtimeHandler.ts`.
