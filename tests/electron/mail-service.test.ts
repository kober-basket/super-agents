import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { EncryptedCredentialStore } from "../../electron/mail/credential-store";
import { MailService } from "../../electron/mail/mail-service";
import { inferMailSetup } from "../../electron/mail/provider-presets";

test("infers OAuth and password mail setup from the email domain", () => {
  const gmail = inferMailSetup("person@gmail.com");
  assert.equal(gmail.providerId, "gmail");
  assert.equal(gmail.authType, "oauth");
  assert.equal(gmail.oauthProvider, "google");

  const outlook = inferMailSetup("person@outlook.com");
  assert.equal(outlook.providerId, "microsoft");
  assert.equal(outlook.authType, "oauth");
  assert.equal(outlook.oauthProvider, "microsoft");

  const qq = inferMailSetup("person@qq.com");
  assert.equal(qq.providerId, "qq");
  assert.equal(qq.authType, "password");
  assert.equal(qq.incoming.host, "imap.qq.com");
  assert.equal(qq.outgoing.host, "smtp.qq.com");

  const custom = inferMailSetup("person@example.org");
  assert.equal(custom.providerId, "custom");
  assert.equal(custom.authType, "password");
  assert.equal(custom.advancedRequired, true);
  assert.equal(custom.incoming.host, "imap.example.org");
});

test("encrypted credential store does not persist raw secrets", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-mail-secret-"));
  const store = new EncryptedCredentialStore(tempDir);

  try {
    await store.set("account-1", {
      kind: "oauth",
      accessToken: "access-token-secret",
      refreshToken: "refresh-token-secret",
      expiresAt: 123456,
    });

    const roundTrip = await store.get("account-1");
    assert.equal(roundTrip?.kind, "oauth");
    assert.equal(roundTrip?.accessToken, "access-token-secret");
    assert.equal(roundTrip?.refreshToken, "refresh-token-secret");

    const persisted = await readFile(path.join(tempDir, "secrets.json"), "utf8");
    assert.doesNotMatch(persisted, /access-token-secret/);
    assert.doesNotMatch(persisted, /refresh-token-secret/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("mail service stores account summaries separately from credentials and creates local drafts", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-mail-service-"));
  const service = new MailService(tempDir);

  try {
    const account = await service.createAccount({ email: "owner@qq.com", displayName: "Owner" });
    assert.equal(account.email, "owner@qq.com");
    assert.equal(account.providerId, "qq");
    assert.equal(account.status, "needs_auth");

    await service.savePasswordCredentials({
      accountId: account.id,
      username: "owner@qq.com",
      password: "mail-app-password",
    });

    const accounts = await service.listAccounts();
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0]?.status, "connected");
    assert.equal(accounts[0]?.email, "owner@qq.com");

    const accountFile = await readFile(path.join(tempDir, "accounts.json"), "utf8");
    assert.doesNotMatch(accountFile, /mail-app-password/);

    const draft = await service.createDraft({
      accountId: account.id,
      to: ["friend@example.com"],
      subject: "Hello",
      body: "A short draft body.",
    });
    assert.equal(draft.accountId, account.id);
    assert.deepEqual(draft.to, ["friend@example.com"]);
    assert.match(draft.preview, /A short draft body/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
