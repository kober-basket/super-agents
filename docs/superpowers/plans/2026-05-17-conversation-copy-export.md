# Conversation Copy Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-message copy controls and a no-dialog conversation export menu for Markdown, PDF, and Word.

**Architecture:** Keep export serialization in a focused Electron-side module so it can be tested without rendering the app. Expose one preload IPC method that exports the active conversation into the workspace `exports/conversations/` directory. Keep UI changes inside the chat workspace and pass toast-friendly callbacks from the app shell.

**Tech Stack:** Electron IPC, React, TypeScript, Node test runner, Chromium print-to-PDF, OpenXML `.docx` package generation.

---

### Task 1: Export Formatting Core

**Files:**
- Create: `electron/conversation-export.ts`
- Test: `tests/electron/conversation-export.test.ts`
- Modify: `tsconfig.test.json`

- [ ] **Step 1: Write failing tests** for Markdown content, filename sanitization, and export path generation.
- [ ] **Step 2: Run `npm run test:electron`** and verify the new tests fail because the module is missing.
- [ ] **Step 3: Implement formatter helpers** for plain text, Markdown, HTML, filename normalization, and export directory naming.
- [ ] **Step 4: Re-run `npm run test:electron`** and verify the formatter tests pass.

### Task 2: Export Writers And IPC

**Files:**
- Modify: `electron/conversation-export.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/types.ts`
- Modify: `src/desktop-agent.d.ts`
- Test: `tests/electron/conversation-export.test.ts`

- [ ] **Step 1: Add tests** for `.md` and `.docx` file creation into `exports/conversations/`.
- [ ] **Step 2: Run tests** and verify file writer tests fail before implementation.
- [ ] **Step 3: Implement `exportConversationToFile`** with Markdown writing, DOCX zip generation, and PDF generation via hidden `BrowserWindow.printToPDF`.
- [ ] **Step 4: Wire `desktop:export-conversation`** through main and preload.
- [ ] **Step 5: Re-run tests** and confirm writer coverage passes.

### Task 3: Chat UI Controls

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/features/chat/ChatWorkspace.tsx`
- Modify: `src/styles.css`

- [ ] **Step 1: Add per-message copy buttons** using `navigator.clipboard.writeText`.
- [ ] **Step 2: Add export dropdown** with PDF, Markdown, and Word options.
- [ ] **Step 3: Call the export IPC** from `App.tsx`, show a toast with the exported path, and keep the menu disabled when no conversation is active.
- [ ] **Step 4: Style controls** to stay compact and not shift message layout.

### Task 4: Verification

**Files:**
- Verify the files touched above.

- [ ] **Step 1: Run `npm run test:electron`**.
- [ ] **Step 2: Run `npm run build`**.
- [ ] **Step 3: Inspect `git diff --stat`** and report only the relevant changed files.
