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

  const exmail = inferMailSetup("person@exmail.qq.com");
  assert.equal(exmail.providerId, "qq-exmail");
  assert.equal(exmail.incoming.host, "imap.exmail.qq.com");

  const neteaseVip = inferMailSetup("person@vip.163.com");
  assert.equal(neteaseVip.providerId, "netease-vip-163");
  assert.equal(neteaseVip.outgoing.host, "smtp.vip.163.com");

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

test("password mailboxes search and read through the IMAP client", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "super-agents-mail-imap-"));
  const seen: string[] = [];
  const fakeImapClient = {
    searchMessages: async ({ account, credential, query, limit }: any) => {
      seen.push(`search:${account.email}:${credential.username}:${query}:${limit}`);
      return [
        {
          id: "42",
          accountId: account.id,
          subject: "验证码",
          from: "service@example.com",
          to: [account.email],
          date: "2026-05-23T10:00:00.000Z",
          snippet: "Your code is 123456",
          unread: true,
        },
      ];
    },
    readMessage: async ({ account, credential, messageId }: any) => {
      seen.push(`read:${account.email}:${credential.username}:${messageId}`);
      return {
        id: messageId,
        accountId: account.id,
        subject: "验证码",
        from: "service@example.com",
        to: [account.email],
        date: "2026-05-23T10:00:00.000Z",
        snippet: "Your code is 123456",
        unread: true,
        body: "Your code is 123456.",
      };
    },
  };
  const service = new MailService(tempDir, { imapClient: fakeImapClient } as any);

  try {
    const account = await service.createAccount({ email: "owner@qq.com" });
    await service.savePasswordCredentials({
      accountId: account.id,
      username: "owner@qq.com",
      password: "mail-app-password",
    });

    const messages = await service.searchMessages({ accountId: account.id, query: "验证码", limit: 2 });
    assert.equal(messages.length, 1);
    assert.equal(messages[0]?.id, "42");
    assert.equal(messages[0]?.unread, true);

    const message = await service.readMessage({ accountId: account.id, messageId: "42" });
    assert.equal(message.body, "Your code is 123456.");
    assert.deepEqual(seen, [
      "search:owner@qq.com:owner@qq.com:验证码:2",
      "read:owner@qq.com:owner@qq.com:42",
    ]);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
