# Agent Runtime 架构重构执行计划

日期：2026-05-19

目标：把当前原生 agent runtime 从“能跑通”推进到“边界清楚、可持久、可替换”。本次覆盖 5 个改进点：拆分聊天编排、拆分模型网关、增加 TurnEventLog、拆分内置工具目录、持久化 AgentSession。

## 当前风险

- `electron/chat-orchestrator.ts` 同时负责 prompt 准备、知识库上下文、流式消息持久化、runtime trace 映射和事件 emit，后续加 coordinator/worker 时会继续膨胀。
- `electron/agent-core/openai-compatible-model-gateway.ts` 同时负责请求组装、SSE 解析、provider 兼容、伪工具调用修复和工具 delta 汇总，provider 差异难以隔离。
- `runtimeTrace` 目前是 UI 展示状态，不是完整 turn event journal；发生异常或重放时缺少低层事实记录。
- `electron/agent-core/builtin-tools.ts` 是单文件工具集合，schema、路径安全、shell、网络和 todo 工具混在一起。
- `AgentSession` 默认只存在内存里，conversation 已保存 `agent_session_id`，但应用重启后模型上下文会丢失。

## 实施步骤

1. 写入持久事件类型与日志模块。
   - 在共享类型中增加 `ChatTurnEventLogEntry`。
   - 新建 Electron 侧 `TurnEventLog`，只接受 agent event 和 turn lifecycle 事实，不承载 UI 展示推导。
   - `ChatOrchestrator` 每次处理 agent event 时追加日志，并在 trace 持久化时写入 `runtimeTrace.events`。

2. 持久化 AgentSession。
   - 把 session manager 抽成接口，保留 `InMemoryAgentSessionManager`。
   - 新增 `PersistentAgentSessionManager`，通过 `ConversationService` 的 SQLite 存储 session messages。
   - `ConversationService.initialize()` 创建/迁移 `agent_sessions` 表。
   - `ChatOrchestrator` 构造 `AgentCore` 时注入持久 session manager。

3. 拆分聊天编排。
   - 新建 `electron/chat/prompt-context.ts`：目录、附件、知识库、inline visual 指令和 prompt 准备纯逻辑。
   - 新建 `electron/chat/runtime-trace-recorder.ts`：把 `AgentEvent` 映射到 `ChatMessageRuntimeTrace`、timeline、activity 和前端事件需要的 patch。
   - `ChatOrchestrator` 保留生命周期、持久化和 IPC emit，不再直接堆 UI trace 细节。

4. 拆分模型网关。
   - 新建 `electron/agent-core/openai/message-mapper.ts`：agent messages -> OpenAI-compatible messages。
   - 新建 `electron/agent-core/openai/sse.ts`：SSE frame 解析。
   - 新建 `electron/agent-core/openai/tool-call-parser.ts`：工具输入解析、伪工具调用解析和 provider 修复。
   - `OpenAICompatibleModelGateway` 保留 provider config、HTTP 流和事件输出。

5. 拆分内置工具目录。
   - 新建 `electron/agent-core/builtin-tools/index.ts` 作为聚合入口。
   - 按职责新增 `filesystem-tools.ts`、`shell-tools.ts`、`web-tools.ts`、`todo-tools.ts` 和 `shared.ts`。
   - 保持 `createBuiltinToolDefinitions()` 的导出兼容，避免 UI 和测试大面积迁移。

6. 验证。
   - 补充 Electron 测试：event log 顺序、session manager 持久化、orchestrator 注入持久 session。
   - 补充 gateway parser 纯逻辑测试，确保 Qwen/GLM/伪工具调用兼容行为不回退。
   - 运行 `npm run test:electron`。
   - 如果涉及打包入口或 TypeScript 引用路径，运行 `npm run build`。

## 完成标准

- 聊天 UI 中已有 thought/status/tool/timeline 行为保持不变。
- `runtimeTrace.events` 能记录同一 turn 的 message/thought/status/tool/finish/fail lifecycle。
- 同一个 conversation 的 `agentSessionId` 在 app 重启后可恢复历史 `AgentMessage[]`。
- 网关和工具拆分后原有 public exports 兼容。
- `npm run test:electron` 通过；能构建时 `npm run build` 通过。
