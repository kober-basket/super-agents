# Mail module implementation plan

Date: 2026-05-23
Repository: super-agents

## Step 1: Tests first

- Add `tests/electron/mail-service.test.ts`.
- Cover provider inference for Gmail, Microsoft, known IMAP domains, and unknown custom domains.
- Cover encrypted local secret storage by asserting the persisted file does not contain the raw password or token.
- Cover local draft creation and approval payload shaping.
- Extend `tests/electron/builtin-tools.test.ts` or add a focused section that asserts `mail`, `mail_draft`, and `mail_send` are registered with the expected risk boundaries.

Verification command:

```bash
npm run test:electron
```

## Step 2: Mail domain layer

- Add `electron/mail/types.ts` for account summaries, provider presets, OAuth config, password config, drafts, messages, and service options.
- Add `electron/mail/provider-presets.ts` with `inferMailSetup(email)`.
- Add `electron/mail/credential-store.ts` for local encrypted JSON secrets under app userData.
- Add `electron/mail/mail-service.ts` for account persistence, setup metadata, credential save/remove, draft creation, and provider client dispatch.

## Step 3: OAuth/API clients

- Add Gmail helpers for OAuth token exchange, refresh, search, read, and send through the Gmail API.
- Add Microsoft Graph helpers for OAuth token exchange, refresh, search, read, and send through Graph.
- Add an IMAP client for password/app-password accounts so QQ, Tencent Exmail, NetEase, and custom IMAP providers can search and read messages.
- Normalize provider responses into `MailMessageSummary` and `MailMessage`.
- Keep all returned text bounded and metadata-rich.

## Step 4: Built-in tools and skill

- Add `electron/agent-core/builtin-tools/mail-tools.ts`.
- Register `mail`, `mail_draft`, and `mail_send` in `electron/agent-core/builtin-tools.ts`.
- Add safe defaults to `electron/agent-core/default-agents.ts` so read mail is available and draft/send require approval.
- Add `electron/builtin-skills/email-assistant/SKILL.md`.

## Step 5: Desktop bridge and settings UI

- Add WorkspaceService methods for mail account list/create/update/disconnect and OAuth setup helpers.
- Expose methods through `electron/preload.ts`, `src/services/workspace-client.ts`, and `src/desktop-agent.d.ts`.
- Add a Mail settings section with provider inference, OAuth or password forms, account list, and disconnect action.
- Keep UI copy in Chinese and avoid showing secret values after save.

## Step 6: Verification and cleanup

- Run `npm run test:electron`.
- Run `npm run build` if preload/main/settings wiring changes need compilation proof.
- Summarize implemented behavior, validation results, and any remaining provider limitations.
