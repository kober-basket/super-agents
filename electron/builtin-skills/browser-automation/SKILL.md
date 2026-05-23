---
name: browser-automation
description: Use when the user asks the agent to operate, inspect, test, debug, or automate the built-in Super Agents browser shown in the right-side workspace. Guides use of browser_* tools against the same visible Electron webview session the user can see.
---

# Browser Automation

Operate the built-in right-side Browser workspace, not an external Chrome window.

## Workflow

1. Call `browser_list_pages` to see registered internal webview pages.
2. If more than one page exists, call `browser_select_page` with the page the user means.
3. Navigate with `browser_navigate` when the task needs a new URL, back, forward, or reload.
4. Call `browser_wait_for` when you know expected page text.
5. Call `browser_snapshot` before interacting. Use only fresh `uid` values from the latest snapshot.
6. Prefer `browser_fill_form` when filling more than one field. Use `browser_fill` for a single input, select, checkbox, radio, switch, or editable element.
7. Use `browser_click` for buttons, links, toggles, menus, and submissions that the user explicitly requested.
8. Use `browser_hover` for hover menus/tooltips, `browser_drag` for drag-and-drop, and `browser_type_text` only after focusing the right editable element.
9. Use `browser_press_key` for keyboard shortcuts and submit keys such as `Enter`.
10. Use `browser_upload_file` only when the user asked to attach or upload a specific local file.
11. Use console/network tools for debugging: list first, then get one item by id only when detail is needed.
12. Use `browser_evaluate` for focused inspection that the snapshot cannot expose.
13. Use `browser_screenshot` only when visual evidence matters or the user asks to see the page.

## Rules

- Treat the browser as shared user state. Avoid submitting forms, making purchases, deleting content, or sending messages unless the user clearly asked for that action.
- After any navigation or major DOM update, call `browser_snapshot` again before reusing a `uid`.
- If a `uid` fails, take a fresh snapshot and retry once with the new `uid`.
- Keep outputs compact. Use snapshots for structure, screenshots for visual layout, and `browser_evaluate` for small JSON-serializable facts.
- Do not save screenshots or network bodies unless the user asked for an artifact or the detail is needed for debugging.
- Treat file upload, form submission, purchase flows, account changes, and message sending as user-visible actions that require explicit intent.
- If `browser_list_pages` reports no pages, tell the user to open the right-side Browser workspace or open a web preview first.

## Common Patterns

Open a site and inspect it:

```text
browser_list_pages
browser_navigate {"url":"https://example.com"}
browser_wait_for {"text":["Example Domain"]}
browser_snapshot
```

Fill and submit a form:

```text
browser_snapshot
browser_fill_form {"elements":[{"uid":"<input uid>","value":"search text"}]}
browser_press_key {"key":"Enter"}
browser_wait_for {"text":["expected result text"]}
browser_snapshot
```

Debug page errors:

```text
browser_list_console_messages {"types":["error","warn"]}
browser_get_console_message {"msgid":1}
browser_list_network_requests {"resourceTypes":["fetch","xhr"]}
browser_get_network_request {"reqid":1}
```

Inspect dynamic state:

```text
browser_evaluate {"function":"() => ({ title: document.title, url: location.href })"}
```
