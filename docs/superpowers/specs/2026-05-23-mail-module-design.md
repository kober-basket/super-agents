# Mail module design

Date: 2026-05-23
Repository: super-agents

## Goal

Add a generic mail capability that agents can use with minimal user setup. The first version supports:

- Provider detection from an email address.
- OAuth-first setup for Gmail and Microsoft/Outlook accounts.
- Password/app-password setup for common IMAP/SMTP providers.
- A local authorization and account-management surface in Settings.
- Built-in agent tools for account discovery, mail search/read, draft creation, and approved sending.
- A bundled mail skill that teaches agents safe and practical mail workflows.

## User experience

The user should normally type only an email address. The app infers the provider and asks for the smallest remaining set of fields:

- Gmail: email plus OAuth client settings when the app has no packaged OAuth client.
- Microsoft/Outlook/Office 365: email plus OAuth client id when the app has no packaged OAuth client.
- Known IMAP/SMTP providers: email plus password/app password.
- Unknown domains: email plus advanced IMAP/SMTP host, port, TLS, username, and password fields.

OAuth accounts use a desktop browser authorization flow and store refresh/access tokens locally. Password accounts store the password/app password locally.

## Capability boundaries

- Read actions are network-risk tools.
- Draft and send actions are write-risk tools and should stay approval-gated by default.
- Secrets must not be written into `AppConfig` or exported through the renderer as plaintext.
- Tool results must be short, structured, and truncated before entering model context.
- The bundled skill should be concise and operational, not a long tutorial.

## Safety rules

- Sending mail requires an explicit `mail_send` tool call and normal tool approval.
- The model should create a local draft first when the user has not explicitly asked to send immediately.
- The tool should return recipient, subject, account, and preview text for approval.
- HTML mail bodies should be converted to plain text before being shown to the model.
- Attachments are out of scope for this first version.

## Scope for this implementation

- Add mail account/provider types.
- Add a local mail service with encrypted-at-rest secret storage.
- Add provider inference and setup metadata.
- Add Gmail and Microsoft Graph API clients for OAuth-backed search/read/send.
- Add local draft storage.
- Add Electron IPC/preload/client methods for mail setup.
- Add a Settings > Mail page for account setup and connection management.
- Add `mail`, `mail_draft`, and `mail_send` built-in tools.
- Add `email-assistant` built-in skill.
- Add focused Electron tests for provider inference, credential storage, and tool registration/behavior.

## Out of scope

- Attachments.
- Full IMAP/SMTP protocol implementation without a vetted dependency.
- Background sync and notifications.
- Shared/team credential vaults.
- Complex mailbox rules and labels.
