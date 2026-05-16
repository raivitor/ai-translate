import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  createClientSecret,
  SUPPORTED_TARGET_LANGUAGES,
} from "./openaiRealtimeHandler.js";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("createClientSecret returns value and expiresAt on success", async () => {
  let capturedUrl = "";
  let capturedAuthHeader = "";
  let capturedBody: Record<string, unknown> = {};

  globalThis.fetch = (input, init) => {
    capturedUrl = String(input);
    capturedAuthHeader = new Headers(init?.headers).get("Authorization") ?? "";
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

    return Promise.resolve(
      Response.json({ value: "ek_test_secret", expires_at: 1_756_310_470 }),
    );
  };

  const result = await createClientSecret({
    targetLanguage: "en",
    apiKey: "test-key",
  });

  assert.strictEqual(result.value, "ek_test_secret");
  assert.strictEqual(result.expiresAt, 1_756_310_470);
  assert.strictEqual(
    capturedUrl,
    "https://api.openai.com/v1/realtime/translations/client_secrets",
  );
  assert.strictEqual(capturedAuthHeader, "Bearer test-key");

  const session = capturedBody.session as Record<string, unknown>;
  const audio = session.audio as Record<string, unknown>;
  const output = audio.output as Record<string, unknown>;
  const input = audio.input as Record<string, unknown>;
  assert.strictEqual(output.language, "en");
  assert.strictEqual(input.noise_reduction, null);
  assert.ok(!("transcription" in input));
});

test("createClientSecret includes transcription config when enabled", async () => {
  let capturedBody: Record<string, unknown> = {};

  globalThis.fetch = (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

    return Promise.resolve(
      Response.json({ value: "ek_test_secret", expires_at: 1_756_310_470 }),
    );
  };

  await createClientSecret({
    targetLanguage: "pt",
    enableTranscription: true,
    apiKey: "test-key",
  });

  const session = capturedBody.session as Record<string, unknown>;
  const audio = session.audio as Record<string, unknown>;
  const inputConfig = audio.input as Record<string, unknown>;
  const transcription = inputConfig.transcription as Record<string, unknown>;
  assert.strictEqual(transcription.model, "gpt-realtime-whisper");
});

test("createClientSecret omits transcription when explicitly disabled", async () => {
  let capturedBody: Record<string, unknown> = {};

  globalThis.fetch = (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

    return Promise.resolve(
      Response.json({ value: "ek_test_secret", expires_at: 0 }),
    );
  };

  await createClientSecret({
    targetLanguage: "en",
    enableTranscription: false,
    apiKey: "test-key",
  });

  const session = capturedBody.session as Record<string, unknown>;
  const audio = session.audio as Record<string, unknown>;
  const inputConfig = audio.input as Record<string, unknown>;
  assert.ok(!("transcription" in inputConfig));
});

test("createClientSecret uses custom model when provided", async () => {
  let capturedBody: Record<string, unknown> = {};

  globalThis.fetch = (_input, init) => {
    capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;

    return Promise.resolve(
      Response.json({ value: "ek_test_secret", expires_at: 0 }),
    );
  };

  await createClientSecret({
    targetLanguage: "en",
    apiKey: "test-key",
    model: "gpt-realtime-custom",
  });

  const session = capturedBody.session as Record<string, unknown>;
  assert.strictEqual(session.model, "gpt-realtime-custom");
});

test("createClientSecret throws for unsupported language without calling OpenAI", async () => {
  let fetchWasCalled = false;

  globalThis.fetch = () => {
    fetchWasCalled = true;
    return Promise.resolve(Response.json({}));
  };

  await assert.rejects(
    () => createClientSecret({ targetLanguage: "fr", apiKey: "test-key" }),
    (err: Error) => {
      assert.match(err.message, /targetLanguage/);
      return true;
    },
  );

  assert.strictEqual(fetchWasCalled, false);
});

test("createClientSecret rejects all unsupported languages", async () => {
  const unsupported = ["fr", "de", "es", "zh", "ja", "", "EN", "PT"];

  for (const lang of unsupported) {
    if (SUPPORTED_TARGET_LANGUAGES.has(lang)) {
      continue;
    }

    globalThis.fetch = () => Promise.resolve(Response.json({}));

    await assert.rejects(
      () => createClientSecret({ targetLanguage: lang, apiKey: "test-key" }),
      `Expected rejection for language: ${lang}`,
    );
  }
});

test("createClientSecret throws when OpenAI returns a non-OK response", async () => {
  globalThis.fetch = () => {
    return Promise.resolve(
      new Response(JSON.stringify({ error: "invalid_api_key" }), {
        status: 401,
      }),
    );
  };

  await assert.rejects(
    () => createClientSecret({ targetLanguage: "en", apiKey: "bad-key" }),
    (err: Error) => {
      assert.match(err.message, /401/);
      return true;
    },
  );
});

test("createClientSecret throws when OpenAI response lacks a value field", async () => {
  globalThis.fetch = () => {
    return Promise.resolve(Response.json({ expires_at: 123 }));
  };

  await assert.rejects(
    () => createClientSecret({ targetLanguage: "en", apiKey: "test-key" }),
    (err: Error) => {
      assert.match(err.message, /client secret/i);
      return true;
    },
  );
});
