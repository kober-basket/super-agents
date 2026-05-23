import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { readJsonFile, writeJsonFile } from "../store";
import type { MailCredential } from "./types";

interface PersistedSecret {
  version: 1;
  algorithm: "aes-256-gcm";
  iv: string;
  tag: string;
  ciphertext: string;
}

type SecretVault = Record<string, PersistedSecret>;

export class EncryptedCredentialStore {
  private readonly keyPath: string;
  private readonly secretsPath: string;

  constructor(private readonly rootPath: string) {
    this.keyPath = path.join(rootPath, "secret.key");
    this.secretsPath = path.join(rootPath, "secrets.json");
  }

  async get(id: string): Promise<MailCredential | null> {
    const vault = await this.loadVault();
    const secret = vault[id];
    if (!secret) {
      return null;
    }
    const key = await this.loadKey();
    const iv = Buffer.from(secret.iv, "base64");
    const tag = Buffer.from(secret.tag, "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(secret.ciphertext, "base64")),
      decipher.final(),
    ]).toString("utf8");
    return JSON.parse(decrypted) as MailCredential;
  }

  async set(id: string, credential: MailCredential) {
    const vault = await this.loadVault();
    const key = await this.loadKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([
      cipher.update(JSON.stringify(credential), "utf8"),
      cipher.final(),
    ]);
    vault[id] = {
      version: 1,
      algorithm: "aes-256-gcm",
      iv: iv.toString("base64"),
      tag: cipher.getAuthTag().toString("base64"),
      ciphertext: encrypted.toString("base64"),
    };
    await writeJsonFile(this.secretsPath, vault);
  }

  async remove(id: string) {
    const vault = await this.loadVault();
    if (!(id in vault)) {
      return;
    }
    delete vault[id];
    await writeJsonFile(this.secretsPath, vault);
  }

  private async loadVault(): Promise<SecretVault> {
    return await readJsonFile<SecretVault>(this.secretsPath, {});
  }

  private async loadKey(): Promise<Buffer> {
    await mkdir(this.rootPath, { recursive: true });
    try {
      const existing = Buffer.from((await readFile(this.keyPath, "utf8")).trim(), "base64");
      if (existing.byteLength === 32) {
        return existing;
      }
    } catch {
      // Generate a new app-local key below when the key file does not exist.
    }

    const key = randomBytes(32);
    await writeFile(this.keyPath, `${key.toString("base64")}\n`, { encoding: "utf8", mode: 0o600 });
    return key;
  }
}
