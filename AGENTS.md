# Repository Guidelines

## Project Overview

Ai Translate is a Linux desktop app for ultra-low-latency, real-time simultaneous translation for **any video or voice
call platform** — including **Google Meet**, **Microsoft Teams (web and desktop app)**, and **Discord (web and desktop
app)**.

### Fixed Software Definitions

- **Fixed Hardware (Input & Output):** Both microphone input and audio output are **always** the **HyperX Cloud III**
  headset (`isHyperXCloudIII` in `src/shared/deviceSelection.ts`, preferring non-digital input and analog stereo
  output). Never silently fall back to built-in mics, webcams, HDMI monitors, or other speakers.
- **Universal Video Call Support:** Not exclusive to Google Meet. Virtual PipeWire devices are platform-agnostic so any
  browser or native desktop call app (Google Meet, Teams web/desktop, Discord web/desktop) can route audio through:
  - Call Microphone (Input): `AI-Translate-Virtual-Mic` (fed internally by `AI-Translate-To-Call`)
  - Call Speaker (Output): `AI-Translate-Call-Speaker` (captured internally via `AI-Translate-Call-Capture`)
- **Fixed Languages (always Brazilian Portuguese):**
  - **Outbound (user → call):** Input is always **Brazilian Portuguese (`pt-BR`)**, translated so participants in the
    call always hear **English (`en`)**.
  - **Inbound (call → user):** Incoming call audio is always spoken in **English (`en`)**, translated so the user always
    hears **Brazilian Portuguese (`pt-BR`)** (mapped to OpenAI's canonical `'pt'` output code at the Realtime
    Translation API boundary).
- **Primary Goal — Minimum Possible Delay:** Every architectural and audio pipeline decision prioritizes the lowest
  possible end-to-end latency so conversations feel natural and seamless, without sounding like a translation system is
  in the middle:
  - Low-latency PipeWire loopbacks (`5 ms` target latency, `128/48000` quantum = ~2.7 ms) and `PIPEWIRE_LATENCY` hint on
    Electron's audio service.
  - WebRTC `receiver.jitterBufferTarget = 0`, 48 kHz mono `getUserMedia` with Browser DSP (AEC/NS/AGC) disabled by
    default, `MediaStreamTrack.contentHint = 'speech'`, and
    `AudioContext({ latencyHint: 'interactive', sampleRate: 48000 })` with parallel `AnalyserNode` tapping.
  - No unused transcription enabled on OpenAI Realtime Translation sessions (`gpt-realtime-translate`), and OpenAI
    `noise_reduction` disabled by default on Inbound call audio.

## Project Structure & Module Organization

This is a single-package Electron + Vite + React app. Main code is in `src/main`, preload in `src/preload`, shared
domain logic in `src/shared`, and renderer UI/services in `src/renderer`.

- `src/main/apiKeyStore.ts`: encrypts/decrypts the `OPENAI_API_KEY` via `safeStorage` and persists it to
  `userData/api-key.enc`.
- `src/main/openaiRealtimeHandler.ts`: creates ephemeral client secrets by calling the OpenAI Realtime Translation API.
- `src/main/audioBridge.ts`: manages low-latency PipeWire `pw-loopback` virtual audio bridges automatically.
- `src/shared/deviceSelection.ts`: enforces fixed `HyperX Cloud III` + virtual call bridge device routing and
  validation.
- `src/shared/translationLanguages.ts`: enforces the fixed `pt-BR ↔ en` translation routes.
- IPC channels (`aiTranslate:*`) bridge the main process to the renderer via the preload.
- Root utilities live in `setup-audio.sh` and `check-package-age.cjs`. Do not edit generated `dist/` output.

## Build, Test, and Development Commands

- `nvm use && npm install`: use Node 24 and install dependencies.
- `./setup-audio.sh`: optional CLI helper to manage Linux PipeWire virtual audio devices (`--check` / `--remove`).
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
