# Super Agents - Agent Guide

本文件用于指导自动化 agent 和 AI coding assistant 在本仓库中工作。人类维护者的明确指令优先于本文件；如果发现本文件与实际代码不一致，先以代码为准，并在相关改动中同步更新本文件。

## Project Overview

`super-agents` 是一个基于 Electron、Vite、React 和 TypeScript 的桌面 agent 工作台外壳。当前重点不是单纯聊天 UI，而是逐步形成一个本地原生 agent runtime：会话、工具、记忆、技能、MCP、权限、知识库、远程控制和可视化运行轨迹都应该作为同一个能力系统来演进。

关键入口：

- `electron/main.ts`：Electron 主进程入口。
- `electron/chat-orchestrator.ts`：聊天回合生命周期编排，把前端输入、workspace context 和 agent runtime 串起来。
- `electron/chat/`：聊天侧 prompt context、runtime trace 映射和 turn event log 等编排辅助模块。
- `electron/agent-core/`：原生 agent 能力层，包括 agent 定义、prompt 组合、工具注册、权限、会话和模型网关。
- `electron/browser-automation-service.ts`：内置浏览器 webview 的 agent 自动化服务，负责页面注册、可访问快照、交互和截图。
- `electron/mail/`：本地邮件账号、授权、凭据存储和 OAuth/API/IMAP/SMTP 辅助模块。
- `electron/agent-core/openai/`：OpenAI-compatible 网关的消息映射、SSE 解析等 provider 辅助模块。
- `electron/cli-shims.ts`：把随应用打包的 `super-agents` CLI 复制到用户数据 runtime-support，并生成 agent shell 可直接调用的命令 shim。
- `electron/tool-catalog.ts`：内置工具与 MCP 工具汇总成工作区工具目录，并维护内置工具分类元数据。
- `electron/memory-service.ts`：本地长期记忆的结构化存储、搜索和 prompt context 构建。
- `electron/builtin-skills/`：随应用打包的内置技能。
- `src/features/chat/`：聊天工作区、预览和消息可视化。
- `src/features/tools/`：工具目录与 MCP 管理界面。
- `src/features/memory/`：记忆条目的管理界面。
- `src/features/skills/`：技能列表、导入和新建界面。
- `src/features/settings/`：模型、MCP、权限、远程控制和外观等设置。
- `tests/electron/`、`tests/frontend/`：Electron 侧与前端纯逻辑测试。

## Development Commands

使用仓库已有 npm scripts，除非任务明确要求切换包管理器。

```bash
npm install
npm run dev
npm run build
npm run test:electron
npm run cli -- --help
npm run admin -- --help
npm run runtime:check
npm run package:runtime
npm run preview
```

- Super Agents self-admin CLI changes should keep `npm run cli -- --help` and `npm run admin -- --help` working and cover behavior in `tests/electron/super-agents-admin-cli.test.ts`.

常用验证：

- 修改 TypeScript 或 Electron 逻辑后，优先运行 `npm run test:electron`。
- 修改前端纯逻辑后，仍使用 `npm run test:electron`，当前测试脚本会先编译 `tsconfig.test.json` 并运行 `.test-dist` 下的 Node tests。
- 修改打包入口、预加载、Electron 主进程或 Vite 配置后，运行 `npm run build`。
- 发布开箱即用安装包前，把 Node/npm 运行时放到 `vendor/runtime/<platform>-<arch>/node`；Windows 版还需要 `vendor/runtime/<platform>-<arch>/python/python.exe` 和 `vendor/runtime/<platform>-<arch>/bin/uv.exe`，macOS 版还需要 `vendor/runtime/<platform>-<arch>/bin/uv`，然后运行 `npm run runtime:check` 和 `npm run package:runtime`。
- UI 交互改动需要人工或浏览器实际检查，尤其是聊天、工具、技能和设置页面。

## Architecture Principles

### Agent 能力层优先

设计 agent 能力层时，重点参考上级目录中的这些项目：

- `../hermes-agent`：参考它的 agent loop、toolset、skill/plugin、gateway 和多平台编排思路。
- `../opencode`：参考它机器友好的 agent 约定、工具执行边界、包级命令和自动化安全规则。
- `../claude-code`：参考它的工具系统、权限提示、计划/任务 agent、ACP/remote control、系统 prompt 与上下文装载方式。

参考这些项目时只吸收架构和行为边界，不要直接照搬大型实现。`super-agents` 当前更适合先把能力层做薄、清晰、可替换，再逐步扩展。

### 当前能力分层

- Agent profile：`AgentDefinition` 描述 agent 的身份、角色、prompt、模型、工具、技能、权限模式和最大轮次。
- Prompt composition：`PromptComposer` 负责组合 runtime prompt、active agent instructions、skills、memory、workspace 和 additional instructions。
- Tool system：`ToolDefinition` 定义工具 schema、risk 和 `execute`；内置工具由 `electron/agent-core/builtin-tools.ts` 聚合，独立工具族放在 `electron/agent-core/builtin-tools/`，MCP 工具通过 adapter 进入工作区工具目录，工具目录负责给内置工具补充展示分类。
- Memory：`MemoryService` 管理 app userData 下的结构化长期记忆，`prepareChatPrompt()` 在每轮按当前请求和 workspace scope 构建 `memoryPrompt`，内置 `memory` 工具通过同一 service 读写并在写入前走审批。
- Permission system：`PermissionManager` 根据 agent policy、工具风险、审批要求和 full filesystem access 做 allow/ask/deny。
- Execution loop：`AgentCore.sendTurn()` 负责流式模型事件、工具调用、重复工具调用去重、工具结果截断、错误净化和最终回答合成；执行阶段的可见文本先作为 provisional assistant text 流式输出，如果随后出现工具调用，`chat-orchestrator` 会把这段临时正文折回 runtime trace 过程状态。工具结果之后 runtime 会暴露内部 `finish_task` 完成信号，并以 `tool_choice: required` 要求模型继续调用工具或调用 `finish_task`，模型调用后进入关闭工具的最终回答阶段，最终阶段的文本直接作为用户正文流式输出；未调用完成信号的无工具文本仍作为兼容性的最终回答候选。
- Agent session：`AgentSessionManager` 抽象会话存储；默认可用内存实现，桌面聊天通过 `PersistentAgentSessionManager` 写入 `ConversationService` 的 SQLite `agent_sessions` 表。
- Conversation title：新建聊天先使用占位标题，首轮 user/assistant exchange 完成后由 `electron/chat-title-generator.ts` 通过当前模型后台生成短标题，再由 `chat-orchestrator` 写回会话并通知前端刷新。
- Skills：`SkillDefinition` 是可注入 prompt 的程序化知识；内置 skill 放在 `electron/builtin-skills/`，用户技能通过界面导入或创建。
- Runtime trace：`electron/chat/runtime-trace-recorder.ts` 把 thought、status、tool calls、timeline 和 visual blocks 映射到前端展示；`TurnEventLog` 记录可持久化的底层 turn event journal。

新增能力时先判断它属于哪一层。不要把 agent runtime 规则硬塞进 React 组件，也不要把 UI 状态混进 `electron/agent-core/`。

## Coding Guidelines

- 优先沿用现有 TypeScript 风格：明确类型、小函数、早返回、只在必要处添加注释。
- 前端组件保持领域化目录结构，聊天、工具、技能、设置等功能分别放在对应 `src/features/*` 下。
- Electron 主进程代码避免直接依赖 React 层类型；共享类型放在 `src/types.ts` 或 agent-core 自己的 `types.ts`。
- 内置工具必须有明确 `inputSchema`、`risk` 和错误处理；不要允许空对象调用必填参数工具。
- 文件/目录工具要尊重 workspace root；当用户明确给出绝对路径或桌面/下载/文档等本地目录时，才使用绝对目标。
- 权限相关改动要保持保守：写入、shell、网络和 destructive 风险要能被 policy 或审批流程约束。
- Skill 内容应短而可执行。复杂参考资料放到 skill 目录的 `references/`，不要把长篇说明全部塞进 `SKILL.md`。
- UI 文案以中文为主，技术标识、工具名、命令和路径保留英文。

## Agent Capability Work

开发 agent 能力时优先维护这些不变量：

- Agent、tool、skill、permission、model gateway 是独立边界，可以单测。
- Runtime prompt 只描述稳定约束；具体 persona 和任务规则放到 agent profile 或 skill。
- 工具调用输入必须被 schema 校验；错误结果要可读、可截断、不能污染后续 prompt。
- 长期记忆要保持短、结构化、可删除；写入前拒绝疑似密钥内容，prompt 注入时不能让记忆覆盖 runtime/system/developer/直接用户指令。
- 工具结果过长时截断并写入 metadata，而不是让模型上下文失控。
- 工具调用前或工具间的模型可见文本可以先流式显示为 provisional assistant text；一旦确认后续发生工具/权限事件，orchestrator 必须把这段文本清空并折回 runtime trace。工具完成后的正式回答优先通过内部 `finish_task` 进入 final-only 阶段并流式输出，避免完整总结同时出现在过程和最终回答中。
- turn 事实事件进入 `runtimeTrace.events`，UI timeline/activity 是派生展示，不能反过来作为 agent runtime 的事实来源。
- 同一个 conversation 的 `agentSessionId` 应能恢复对应 agent messages；改 session 行为时要覆盖持久化恢复测试。
- 同一 turn 内重复的同签名工具调用应复用已有结果或给出明确提示。
- Coordinator/worker/specialist agent 应该通过清晰的任务边界协作，简单任务由当前 agent 直接完成。
- MCP 是外部能力入口，内置工具是本地基础能力；两者在 UI 中统一展示，但实现边界不要混淆。
- 内置浏览器自动化要操控用户可见的右侧 Browser webview；`main` 进程通过 `did-attach-webview` 注册页面，agent 交互前应优先使用 `browser_snapshot` 获取 fresh uid，console/network 诊断通过同一服务采集并保持工具结果可截断。
- 邮件能力通过 Settings > Mail 或会话内 `mail_auth` 私密授权表单配置账号；凭据存放在应用 userData 下的邮件凭据存储中，不进入 `AppConfig`、前端 bootstrap 快照或模型上下文。读邮件使用 `mail`（OAuth 账号走 Gmail/Microsoft API，授权码账号走 IMAP），写草稿和发送分别使用 `mail_draft`、`mail_send` 并保持审批边界。
- Agent shell、终端命令和本地 MCP 启动都通过 `electron/runtime-support.ts` 注入应用私有 runtime PATH。不要直接在各调用点拼 PATH；新增子进程入口时复用 `createRuntimeProcessEnv()`。应用启动时会把内置 `super-agents` / `super-agents-admin` CLI 复制到用户数据 `runtime-support` 并生成 PATH shim，agent 管理应用自身时应优先调用这些内置命令，不要依赖源码仓库绝对路径。

新增或调整 agent 能力时，优先补齐对应测试：

- `tests/electron/agent-core.test.ts`
- `tests/electron/browser-automation-service.test.ts`
- `tests/electron/builtin-tools.test.ts`
- `tests/electron/memory-service.test.ts`
- `tests/electron/tool-catalog.test.ts`
- `tests/electron/chat-orchestrator.test.ts`
- `tests/frontend/memory-view.test.tsx`
- `tests/frontend/runtime-activity.test.ts`
- `tests/frontend/runtime-timeline.test.ts`
- `tests/frontend/runtime-tool-visibility.test.ts`

## Git And Safety

- 工作区可能已有用户改动。不要还原、覆盖或整理与当前任务无关的文件。
- 不要运行 `git reset --hard`、`git checkout -- <file>`、强推、改写历史等破坏性命令，除非人类明确要求。
- 不要替用户创建 commit，除非任务明确要求。
- 涉及密钥、模型配置、远程控制、消息平台 webhook、CI/release 的改动要格外保守，并在结果中说明验证情况。

## Documentation Maintenance

当新增 agent 能力层、内置工具、权限策略、技能系统、MCP 行为或开发命令变化时，同步更新本文件。保持它短、可执行、贴近代码；不要把它变成完整设计文档。
