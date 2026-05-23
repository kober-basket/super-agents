# Memory Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-pass long-term memory module with UI management, local persistence, prompt injection, and an agent-facing memory tool.

**Architecture:** Electron owns memory persistence through `MemoryService`; `WorkspaceService` exposes memory operations to IPC and prompt preparation. The native agent core receives `memoryPrompt` in each turn, and a `memory` tool delegates to the same service. React owns only view state and calls the existing `workspaceClient` bridge.

**Tech Stack:** Electron, TypeScript, React, Node test runner, local JSON persistence.

---

### Task 1: Types And Service

**Files:**
- Modify: `src/types.ts`
- Create: `electron/memory-service.ts`
- Test: `tests/electron/memory-service.test.ts`

- [ ] Add shared memory types: `MemoryEntryType`, `MemoryScope`, `MemoryEntry`, `MemoryCatalogPayload`, `MemoryCreateInput`, `MemoryUpdateInput`.
- [ ] Write failing tests for create/list/search/update/delete, prompt context formatting, and secret-like content rejection.
- [ ] Implement `MemoryService` with `readJsonFile` and `writeJsonFile`.
- [ ] Run `npm run test:electron` and verify the new tests pass.

### Task 2: Workspace Bridge And Prompt Injection

**Files:**
- Modify: `electron/workspace-service.ts`
- Modify: `electron/main.ts`
- Modify: `electron/preload.ts`
- Modify: `src/desktop-agent.d.ts`
- Modify: `src/services/workspace-client.ts`
- Modify: `src/services/browser-desktop-agent.ts`
- Modify: `electron/chat/prompt-context.ts`
- Modify: `electron/chat-orchestrator.ts`
- Modify: `electron/agent-core/agent-loop.ts`
- Test: `tests/electron/chat-orchestrator.test.ts`

- [ ] Add workspace methods and IPC handlers for listing, adding, updating, deleting, and searching memory.
- [ ] Extend `PreparedPrompt` and `AgentCore.sendTurn()` with `memoryPrompt`.
- [ ] Write a failing orchestrator test proving memory prompt is forwarded to native core.
- [ ] Build memory prompt context in `prepareChatPrompt()` using current user content and workspace root.
- [ ] Run `npm run test:electron`.

### Task 3: Agent Memory Tool

**Files:**
- Create: `electron/agent-core/builtin-tools/memory-tool.ts`
- Modify: `electron/agent-core/builtin-tools.ts`
- Modify: `electron/agent-core/default-agents.ts`
- Modify: `electron/chat-orchestrator.ts`
- Modify: `electron/tool-catalog.ts` only if catalog behavior requires adjustment.
- Test: `tests/electron/builtin-tools.test.ts`
- Test: `tests/electron/agent-core.test.ts`
- Test: `tests/electron/tool-catalog.test.ts`

- [ ] Write failing tests for `memory` tool list/add/replace/remove.
- [ ] Add `memory` to default built-in agent tools.
- [ ] Register the memory tool with `WorkspaceService` in `ChatOrchestrator`.
- [ ] Update built-in tool catalog expectations.
- [ ] Run `npm run test:electron`.

### Task 4: Memory UI

**Files:**
- Modify: `src/types.ts`
- Modify: `src/features/navigation/PrimarySidebar.tsx`
- Modify: `src/App.tsx`
- Create: `src/features/memory/MemoryView.tsx`
- Modify: `src/styles.css`
- Test: `tests/frontend/navigation.test.tsx`
- Test: `tests/frontend/memory-view.test.tsx`

- [ ] Write failing frontend tests for sidebar order and MemoryView rendering.
- [ ] Add `memory` to `AppSection` and sidebar button between tools and knowledge.
- [ ] Add MemoryView with filters, search, create/edit modal, delete confirmation, and enabled toggle.
- [ ] Wire App state to `workspaceClient` memory methods.
- [ ] Add responsive styles consistent with existing workspace pages.
- [ ] Run `npm run test:electron`.

### Task 5: Documentation And Verification

**Files:**
- Modify: `AGENTS.md`

- [ ] Document memory service, UI module, tool, and tests in the agent guide.
- [ ] Run `npm run test:electron`.
- [ ] If frontend behavior changed visually, run the app and inspect the Memory page in the browser.
