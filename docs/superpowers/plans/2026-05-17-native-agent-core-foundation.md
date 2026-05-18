# Native Agent Core Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the native `super-agents` core practically useful by registering safe project tools with mature agent-facing names, keeping default permissions read-only, and normalizing tool results.

**Architecture:** Keep `ChatOrchestrator -> AgentCore -> ToolRegistry -> ModelGateway`. Add capability in `builtin-tools.ts`, register tools in `ChatOrchestrator`, and keep safety gates in `PermissionManager` plus `AgentCore` result normalization.

**Tech Stack:** TypeScript, Electron main process modules, `node:test`, existing `tsconfig.test.json` compilation pipeline.

---

### Task 1: Register Read-Only Built-In Tools

**Files:**
- Modify: `electron/chat-orchestrator.ts`
- Modify: `electron/agent-core/default-agents.ts`
- Test: `tests/electron/agent-core.test.ts`

- [x] **Step 1: Write failing test**

Add a test that constructs a default registry and verifies `read`, `list`, `grep`, and `glob` are exposed to the first model request for the default assistant. Assert that legacy `workspace_*` names are not exposed to the model.

- [x] **Step 2: Run test to verify it fails**

Run: `npm run test:electron -- tests/electron/agent-core.test.ts`

Expected: the new test fails because the default agent does not yet expose the mature built-in tool names.

- [x] **Step 3: Implement minimal code**

Import `createBuiltinToolDefinitions` in `chat-orchestrator.ts`, register each tool in the `ToolRegistry`, and update `DEFAULT_AGENT_ID` policy to allow only read tools and read risk.

- [x] **Step 4: Run test to verify it passes**

Run: `npm run test:electron -- tests/electron/agent-core.test.ts`

Expected: the test passes.

### Task 2: Add Safe Write, Edit, Glob, And Shell Tool Definitions

**Files:**
- Modify: `electron/agent-core/builtin-tools.ts`
- Test: `tests/electron/agent-core.test.ts`

- [x] **Step 1: Write failing tests**

Add tests for `write` writing inside a temporary project, refusing `../escape.txt`, `glob` matching files inside the project only, `edit` replacing text inside the project only, and `bash` returning capped output for a simple command.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm run test:electron -- tests/electron/agent-core.test.ts`

Expected: failures because the new tool names do not exist or are not exposed yet.

- [x] **Step 3: Implement minimal code**

Add `write` with project path confinement and UTF-8 writes. Add `glob` with project path confinement and result caps. Add `edit` with exact text replacement. Add `bash` with project cwd, timeout, output cap, and destructive command guard. Keep the old `workspace_*` names as registry aliases only.

- [x] **Step 4: Run tests to verify they pass**

Run: `npm run test:electron -- tests/electron/agent-core.test.ts`

Expected: new tests pass.

### Task 3: Normalize Tool Results And Errors

**Files:**
- Modify: `electron/agent-core/agent-loop.ts`
- Test: `tests/electron/agent-core.test.ts`

- [x] **Step 1: Write failing tests**

Add tests showing a tool that throws produces a bounded `[TOOL_ERROR]` tool message and a tool returning a very large result is truncated before being sent back to the model.

- [x] **Step 2: Run tests to verify they fail**

Run: `npm run test:electron -- tests/electron/agent-core.test.ts`

Expected: the throwing tool currently rejects the turn or leaks an unsanitized error.

- [x] **Step 3: Implement minimal code**

Wrap `tool.execute` in `try/catch`, add local helpers to strip structural tags/fences from errors, cap tool output, and preserve metadata about truncation.

- [x] **Step 4: Run tests to verify they pass**

Run: `npm run test:electron -- tests/electron/agent-core.test.ts`

Expected: error and truncation tests pass.

### Task 4: Verify Integration

**Files:**
- No new files.

- [x] **Step 1: Run focused Electron tests**

Run: `npm run test:electron`

Expected: all Electron tests pass.

- [x] **Step 2: Run TypeScript/build verification if needed**

Run: `npm run build:main`

Expected: Electron main process build completes.

- [x] **Step 3: Review diff**

Run: `git diff -- electron/agent-core electron/chat-orchestrator.ts tests/electron/agent-core.test.ts docs/superpowers`

Expected: diff only contains Phase 1 native core foundation changes.
