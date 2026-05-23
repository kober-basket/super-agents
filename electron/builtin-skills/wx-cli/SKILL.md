---
name: wx-cli
description: Use when the user explicitly asks to search or inspect local WeChat/微信 data, including chat history, contacts, sessions, unread/new messages, official-account articles, favorites, or local attachments through the wx-cli command-line tool.
---

# wx-cli

Use `wx` only as a local, read-only WeChat data lookup helper. Prefer small, targeted queries and JSON output so results are easy to inspect.

## Safety Boundaries

- Do not run `wx init`, `sudo wx init`, `wx init --force`, `codesign`, `tccutil`, or any command that changes WeChat, system permissions, or local key material unless the user explicitly asks for initialization and confirms the risk.
- Do not send messages, auto-reply, add friends, group-send, protocol-login, hook, inject, or automate WeChat UI/network behavior.
- Do not upload or reveal `all_keys.json`, decrypted database cache files, raw database files, private tokens, or large exports unless the user explicitly requests that exact artifact.
- Ask for confirmation before full-library searches, exports, attachment extraction, SNS/favorites queries, or returning large amounts of third-party personal data.
- If `wx` is missing or not initialized, explain the manual setup steps instead of trying invasive setup automatically.

## Quick Checks

Check availability:

```bash
wx --version
```

Use JSON for agent consumption:

```bash
wx sessions --json
wx history "CHAT_NAME" -n 50 --json
wx search "KEYWORD" -n 50 --json
```

## Common Tasks

Recent sessions:

```bash
wx sessions --json
```

Recent chat history:

```bash
wx history "CHAT_NAME" -n 50 --json
```

Search a specific chat:

```bash
wx search "KEYWORD" --in "CHAT_NAME" -n 50 --json
```

Search contacts before querying an ambiguous chat name:

```bash
wx contacts --query "NAME" --json
```

Official-account articles:

```bash
wx biz-articles -n 50 --json
wx biz-articles --account "ACCOUNT_NAME" -n 50 --json
```

Unread or new messages:

```bash
wx unread --json
wx new-messages -n 50 --json
```

## Result Handling

- Summarize only the relevant rows for the user's question.
- Preserve names, timestamps, and source chat/account when useful.
- If output includes `meta.status` such as `possibly_stale` or `possibly_stale_unknown_shards`, tell the user results may be stale and that manual `wx init --force` may be needed.
- Keep default limits small. Increase `-n` only when the user asks for more.
