import { app, safeStorage } from "electron";
import fs from "node:fs";
import path from "node:path";

function getKeyFilePath(): string {
  return path.join(app.getPath("userData"), "api-key.enc");
}

export function saveApiKey(key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage encryption is not available on this system.");
  }

  const encrypted = safeStorage.encryptString(key);
  fs.writeFileSync(getKeyFilePath(), encrypted);
}

export function loadApiKey(): string | null {
  const filePath = getKeyFilePath();

  if (!fs.existsSync(filePath)) {
    return null;
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("safeStorage encryption is not available on this system.");
  }

  const encrypted = fs.readFileSync(filePath);
  return safeStorage.decryptString(encrypted);
}

export function clearApiKey(): void {
  const filePath = getKeyFilePath();

  if (fs.existsSync(filePath)) {
    fs.rmSync(filePath);
  }
}

export function hasApiKey(): boolean {
  return fs.existsSync(getKeyFilePath());
}
