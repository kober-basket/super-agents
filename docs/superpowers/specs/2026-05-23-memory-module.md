# Memory Module Design

## Goal

在桌面工作台中新增“记忆”一级模块，放在“工具”和“知识库”之间；它既能由用户管理长期记忆，也能被 native agent runtime 读取和通过工具维护。

## Scope

一期做结构化本地记忆，不做向量索引。记忆条目存放在 app userData 下的 `memory/index.json`，由 Electron 主进程统一读写。前端提供新建、编辑、删除、搜索、类型筛选和启用/停用。聊天回合启动时，runtime 从启用的记忆中按关键词和作用域召回少量条目，注入 `PromptComposer` 的 `# Memory` 段。

## Memory Shape

每条记忆包含：

- `id`
- `type`: `user_preference`、`feedback_rule`、`project_context`、`external_reference`
- `scope`: `global` 或 `workspace`
- `title`
- `content`
- `tags`
- `enabled`
- `createdAt`
- `updatedAt`

## Runtime Behavior

`MemoryService` 负责结构化读写、搜索和 prompt context 构建。Prompt 注入只包含启用记忆，并带稳定边界说明：记忆是长期上下文，不得覆盖 runtime/system/developer 指令。

新增 `memory` 内置工具，支持：

- `list`
- `add`
- `replace`
- `remove`

工具使用 JSON schema 校验输入。写入类动作会通过工具上下文申请审批，并在 service 层做长度限制、标签归一化和密钥形态拒绝。

## UI Behavior

侧栏顺序变为：新对话、技能、工具、记忆、知识库。记忆页面采用左侧类型和统计、右侧条目管理的工作台布局，整体与知识库页面视觉保持一致但更轻量。所有 UI 文案使用中文，工具名和类型标识保留英文枚举。

## Validation

覆盖以下路径：

- `MemoryService` 增删改查、搜索、prompt 格式、密钥拒绝。
- `memory` 工具 list/add/replace/remove。
- `ChatOrchestrator` 把 memory prompt 传入 native core。
- `PrimarySidebar` 渲染“记忆”且位于工具和知识库之间。
- `MemoryView` 基础渲染、搜索和类型切换。
- `npm run test:electron`。
