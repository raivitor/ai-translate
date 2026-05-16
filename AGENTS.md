# Repository Guidelines

## Project Overview

Ai Translate is a Linux desktop app for real-time Google Meet translation. Electron/React captures microphone or Meet audio, the local Express API creates ephemeral OpenAI Realtime Translation sessions, and WebRTC streams PT -> EN and EN -> PT audio. PipeWire/PulseAudio helpers manage the virtual audio devices.

## Project Structure & Module Organization

Workspace packages:

- `api/`: Express + TypeScript backend. Runtime code lives in `api/src`, with routes in `api/src/routes`, config in `api/src/config`, and test helpers in `api/src/test`.
- `desktop/`: Electron + Vite + React app. Main code is in `desktop/src/main`, preload in `desktop/src/preload`, and renderer UI/services in `desktop/src/renderer`.
- Root utilities live in `scripts/`, `setup-audio.sh`, and `check-package-age.js`. Do not edit generated `dist/` output.

## Build, Test, and Development Commands

- `nvm use && npm install`: use Node 24 and install dependencies.
- `cp api/.env.example api/.env`: create local API configuration.
- `./setup-audio.sh`: create Linux virtual audio devices.
- `npm start` or `npm run dev`: run API and desktop app together.
- `npm run dev:api` / `npm run dev:desktop`: run one workspace.
- `npm run build`: compile all workspaces.
- `npm run validate`: run lint, typecheck, and tests.
- `npm run test --workspace api`: run API unit tests; use `npm run test:integration --workspace api` for HTTP integration tests.

## Coding Style & Naming Conventions

Use TypeScript ES modules. `.editorconfig` enforces UTF-8, LF endings, final newlines, and 2-space indentation. Prettier is the formatting source of truth.

Follow existing naming patterns: React components use `PascalCase.tsx`, services/modules use descriptive `camelCase` or lowercase names, and tests use `*.unit.spec.ts` or `*.integration.spec.ts`. Prefer explicit type imports and sorted imports.

## Testing Guidelines

The API uses Node's test runner and `supertest`. Unit tests should be colocated as `*.unit.spec.ts`; integration tests should use `*.integration.spec.ts` and shared setup from `api/src/test`. Desktop currently uses `node --test`; add focused tests for non-trivial logic outside UI rendering.

Run targeted tests, then `npm run validate`.

## Commit & Pull Request Guidelines

Git history uses concise Conventional Commit-style prefixes, mainly `feat:` and `fix:`. Keep commits scoped to one change, for example `fix: handle realtime session errors`.

PRs should include a short summary, test results, linked issues when applicable, and screenshots or recordings for desktop UI changes. Mention audio setup, `.env` changes, or OpenAI integration behavior.

## Security & Configuration Tips

Do not commit `api/.env` or secrets. Set `OPENAI_API_KEY` only locally. Keep `OPENAI_REALTIME_MODEL=gpt-realtime-translate` unless the API contract is intentionally updated.
