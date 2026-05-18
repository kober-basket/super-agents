# Native Agent Core Foundation Design

## Goal

Strengthen the current `super-agents` native agent core so it is useful for real project work while keeping the Electron app in control of model routing, UI, permissions, and conversation persistence.

## Context

The current core is a local TypeScript runtime in `electron/agent-core`. It already has an `AgentCore`, registries, a permission manager, prompt composer, OpenAI-compatible model gateway, and a small set of project-local tools. `ChatOrchestrator` instantiates the core, but it creates an empty `ToolRegistry`, so the default desktop assistant cannot actually use the built-in tools.

Reference systems inform the direction:

- Claude Code is strongest at coding workflows: read/search/edit/shell tools, permission prompts, concurrent safe reads, and context compaction.
- Hermes-Agent is strongest as a broad agent platform: tool registry, toolsets, result protection, provider routing, memory, delegation, browser, MCP, and Codex runtime bridging.
- `super-agents` should keep its own native core and absorb the first practical layer: mature built-in tool names, conservative permissions, bounded outputs, and tests.

## Scope

Phase 1 builds a safe foundation only:

- Register native built-in tools in `ChatOrchestrator`.
- Enable the default assistant to use read-only tools by default: `read`, `list`, `grep`, and `glob`.
- Add minimal write/edit tools guarded by permission policy.
- Add a minimal `bash` tool guarded by permission policy and limited output.
- Add result/error normalization inside `AgentCore` so oversized or thrown tool output does not destabilize the conversation.
- Add tests for registration, project path safety, write/edit/shell behavior, and result normalization.

Out of scope for Phase 1:

- Full Claude Code parity.
- Hermes-style memory providers, subagent delegation, browser automation, code execution sandboxes, or context compression.
- User-facing approval dialog UI. The existing `approvalHandler` interface remains the seam.
- Replacing the current OpenAI-compatible model gateway.

## Architecture

The implementation keeps the current native architecture:

`ChatOrchestrator -> AgentCore -> ToolRegistry -> ToolDefinition.execute -> ModelGateway`

`electron/agent-core/builtin-tools.ts` becomes the home for safe local tools. Tools use Claude Code/opencode-style names: `read`, `list`, `grep`, `glob`, `write`, `edit`, and `bash`. They share project-root path resolution and output trimming helpers. `ChatOrchestrator` registers these definitions when constructing the native core. `default-agents.ts` grants the default assistant only read-only tools automatically, while write/edit/bash remain available only to agents whose policy explicitly allows them.

`AgentCore` owns tool result normalization because every tool, including future MCP tools, passes through the same execution path. It catches tool execution errors and turns them into bounded tool-result messages instead of failing the whole turn. This follows Hermes' practical lesson: tool outputs should be useful to the model, but never unbounded or structurally noisy.

## Permissions

The default assistant should be useful but conservative:

- Allowed without approval: `read`, `list`, `grep`, `glob`.
- Registered but not allowed automatically: `write`, `edit`, `bash`.
- Legacy `workspace_*` names remain registry aliases only; they are not exposed to the model.
- Write/edit/bash tools use risks `write` and `shell`; current default `allowRisk: ["read"]` denies them unless the agent policy changes.
- If a caller opts into `requireApprovalFor`, the existing `approvalHandler` path handles the decision.

This gives the UI a clean future path: expose a mode toggle or per-tool approval without changing the tool execution model.

## Tool Behavior

Read tools remain project-confined. A path that resolves outside `workspaceRoot` is rejected.

`write` writes UTF-8 text inside the project only. It creates parent directories under the project root, refuses files above a conservative input size, and returns a short metadata summary rather than echoing the whole content.

`edit` replaces exact text inside a project file. It refuses project escapes, no-op replacements, and missing target text.

`bash` runs a command inside the project through the platform shell with a timeout, output cap, and basic destructive-command guard. It is not enabled for the default assistant in Phase 1; tests exercise permission denial and explicit opt-in behavior.

All tool results are normalized by `AgentCore`:

- Successful results are capped before being appended to model history.
- Tool errors become `[TOOL_ERROR] ...` messages.
- Error messages are stripped of role-like framing tags and code fences.

## Testing

Tests live in `tests/electron/agent-core.test.ts` and use the existing scripted model gateway. Coverage must include:

- Built-in tools reject project escape paths.
- `ChatOrchestrator` registers built-in tools for the native core.
- Default agent exposes `read`, `list`, `grep`, and `glob` to the model.
- Default policy denies write/edit/bash tools.
- Explicitly allowed write tool can create a project file.
- Glob finds project files by pattern.
- Edit can apply a single exact replacement.
- Bash tool output is capped.
- Tool execution errors are returned to the model as sanitized tool messages.

## Risks

The main risk is accidentally making the assistant more capable than the permission model can safely express. Phase 1 avoids this by registering write/edit/bash tools but keeping default policy read-only.

The second risk is touching user changes in an already dirty branch. The implementation will keep edits scoped to `electron/agent-core`, `electron/chat-orchestrator.ts`, `electron/agent-core/default-agents.ts`, and related tests/docs.
