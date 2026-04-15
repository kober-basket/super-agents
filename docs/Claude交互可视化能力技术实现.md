# Claude 交互可视化能力技术分析报告

> 目标：复盘 Claude “interactive visuals” 能力的可见行为，推断其底层架构与实现模式，并给出一套可直接复用到你自己智能体中的技术方案。[page:1][web:9][web:20]

---

## 1. 产品行为与能力边界

### 1.1 功能特征概览

根据官方博客与帮助文档，Claude 当前的视觉能力主要包括：[page:1][web:9][web:20][web:16]

- 在对话内联生成交互视觉：折线图、柱状图、流程图、结构图等。
- 支持基于真实数据（如 CSV、天气）构建图表，也支持纯概念示意图。
- 视觉内容可随后续问答动态更新，而不是一次性静态图片。
- 能使用交互控件：例如参数滑条、下拉选项、可展开的细节等。
- 视觉只在 Web / Desktop 有效，移动端可能降级为文本描述。

同时，Claude 还提供 Artifacts 功能，用于在对话侧边栏生成“持久文档/应用”，支持 Markdown、HTML/CSS/JS、React、Mermaid、SVG 等多种内容类型。[web:14][web:17][web:22][web:23][web:25]

### 1.2 交互视觉 vs Artifacts

从官方和第三方评测可见，两者定位略有不同：[page:1][web:14][web:17][web:22][web:23]

- 交互视觉（inline visuals）：
  - 内联显示在对话消息中。
  - 更轻量、临时，伴随对话演化。
  - 主要目标是**理解**（图表、示意、分解）。

- Artifacts：
  - 显示在对话旁边的单独面板。
  - 内容更持久，可反复打开、编辑和导出。
  - 更偏向**创作和原型**（文档、代码、仪表盘、React 应用等）。[web:22][web:23][web:25]

你在自研时可以参考这种分层：把“解释型视觉”和“作品型 Artifact”用不同通路实现。

---

## 2. 顶层架构推断

### 2.1 分层视角

综合文档描述和同类实践（VegaChat、Civo 架构图生成器等），Claude 的整体实现非常符合以下四层架构：[web:9][web:15][web:18][web:20]

1. **对话编排层（Orchestration）**
   - 负责处理用户输入、维护会话状态、串联 LLM、工具和视觉模块。
   - 决定何时触发视觉生成，以及传什么上下文给视觉子任务。

2. **LLM 推理层**
   - 主回答：自然语言解释问题。
   - 视觉描述：输出结构化的“视觉规格”（spec），例如 JSON/DSL，描述图表或图示。

3. **视觉中间件层**
   - 对 LLM 输出的 spec 进行解析、校验、修正（必要时再次调用 LLM 自我修正）。
   - 做安全隔离：只允许在白名单 DSL/schema 内表达，不执行任意脚本。

4. **前端渲染与交互层**
   - 在对话 UI 中内联渲染视觉组件。
   - 把用户交互（滑条调整、节点点击等）转化为事件，再回传给后端或在前端局部更新。[web:11][web:18][web:23]

这与 Anthropic 在 Artifacts 中的模式相同：由 LLM 生成结构化内容/代码，由宿主环境渲染与运行。[web:14][web:17][web:22][web:23][web:25]

### 2.2 触发逻辑

官方文档和教程指出，Claude 生成视觉的典型触发方式包括：[page:1][web:9][web:10][web:11][web:20]

- 语义触发：当图表/图示比纯文字更利于理解时自动触发。
- 显式请求：用户使用“画图、diagram、visualize、chart、timeline、flowchart”等指令。
- 特定模版场景：
  - 天气小组件：通过 Web 搜索获取实时天气数据，以固定模版展示。[web:9]
  - 菜谱：用结构化格式展示配料和步骤，可选用视觉增强。[page:1][web:9]

在你自己的系统中，可以通过**轻量分类器或规则引擎**来实现类似触发逻辑。

---

## 3. 视觉内容表示：中间 DSL 设计

### 3.1 Claude 可能的表示方式

尽管 Anthropic 没公开具体 DSL，但从能力范围与 Artifacts 支持内容来看，大概率采用如下思路：[web:9][web:14][web:17][web:22][web:23][web:25]

- 图表部分使用类似 Vega-Lite / ECharts / Plotly 的 JSON 规范。
- 流程图/架构图部分可用 Mermaid 或节点-边 JSON。
- 交互控件与输入使用自定义 JSON schema 描述，再由前端解释为实际 UI 控件。
- Artifacts 中支持完整 HTML/CSS/JS/React，说明内部也有安全沙箱执行/渲染机制。[web:22][web:23][web:25]

你可以不依赖其内部实现，直接选用成熟规范来构建“自己的 Claude 视觉 DSL”。

### 3.2 推荐的 DSL 设计

#### 3.2.1 图表 DSL

选择 Vega-Lite 作为图表规范（研究界已有大量 LLM + Vega-Lite 的框架，如 Chart-LLM 与 VL2NL）。[web:15][web:24][web:26]

一个建议的通用结构：

```json
{
  "type": "chart",
  "library": "vega-lite",
  "data": {
    "values": [
      {"date": "2025-01-01", "value": 10},
      {"date": "2025-02-01", "value": 15}
    ]
  },
  "spec": {
    "$schema": "https://vega.github.io/schema/vega-lite/v5.json",
    "mark": "line",
    "encoding": {
      "x": {"field": "date", "type": "temporal"},
      "y": {"field": "value", "type": "quantitative"}
    }
  }
}
```

- `type` 与 `library` 由你定义，方便前端选择渲染器。
- `data` 可内嵌或引用外部数据源。
- `spec` 为完整 Vega-Lite 规范（可直接交给 vega-embed 渲染）。[web:15][web:24]

#### 3.2.2 流程图 / 结构图 DSL

两种路线：

1. 使用现成的 Mermaid：
   - 如 `graph TD; A-->B; B-->C;`。
   - 由前端的 Mermaid 渲染器负责显示。[web:22][web:25]

2. 使用节点-边 JSON（类似 Civo 架构图生成器思想）：[web:18]

```json
{
  "type": "diagram",
  "style": "graph",
  "nodes": [
    {"id": "user", "label": "User", "group": "actor"},
    {"id": "api", "label": "API Gateway", "group": "service"}
  ],
  "edges": [
    {"source": "user", "target": "api", "label": "HTTP"}
  ]
}
```

#### 3.2.3 交互控件与参数

参考 Vega 参数化、dashboard 工具以及 Claude 能“问你结构化问题”的描述，可以扩展 DSL 支持参数：[web:9][web:18][web:23][web:25]

```json
{
  "type": "interactive_chart",
  "params": [
    {
      "name": "interest_rate",
      "input": "slider",
      "min": 0.0,
      "max": 0.2,
      "step": 0.005,
      "default": 0.05,
      "label": "Interest rate"
    }
  ],
  "bindings": {
    "spec_field": "spec.encoding.y.field",
    "compute": "recalculate_series(interest_rate)"
  },
  "spec": { ... Vega-Lite spec ... }
}
```

- `params` 描述前端 UI 控件。
- `bindings` 指示控件如何影响图表（可以用前端逻辑或再次调用 LLM/后端函数计算）。  

这样就能实现动态“explorable breakdowns”。[web:11][web:16][web:23]

---

## 4. 对话与视觉的编排流程

### 4.1 消息结构设计

你可以把每条 Assistant 消息设计成如下结构：

```json
{
  "id": "msg-123",
  "role": "assistant",
  "text": "这里是对用户问题的文字解释……",
  "visuals": [
    {
      "id": "vis-1",
      "type": "chart",
      "library": "vega-lite",
      "data": { "values": [...] },
      "spec": { ... }
    },
    {
      "id": "vis-2",
      "type": "diagram",
      "style": "mermaid",
      "code": "graph TD; A-->B;"
    }
  ]
}
```

前端渲染时：  

- 先渲染 `text`（普通聊天气泡）。
- 再对 `visuals` 数组逐个用对应组件渲染（ChartView、DiagramView 等）。

这基本复制了 Claude “文字 + 内联视觉”的体验形态。[page:1][web:9][web:11][web:16][web:20]

### 4.2 生成与校验流程

可借鉴 VegaChat 和 VL2NL 这类“LLM + 规范”的 pipeline：[web:15][web:24][web:26]

1. **判断是否需要视觉**
   - 简单规则或分类模型：
     - 是否包含“画图 / 图表 / 可视化”等关键词。
     - 是否出现典型数据模式（时间序列、类别+数值、层级结构等）。

2. **主回答生成**
   - 调用 LLM 输出自然语言解释（你已有对话系统）。

3. **视觉规格生成**
   - 为 LLM 准备一个专门的 System Prompt，说明：
     - 只允许输出合法 JSON/DSL。
     - 必须符合给定 schema（字段名、类型、必选项）。
     - 不要输出 Markdown / 解释文本。
   - 把“用户需求 + 数据摘要 + 你的 schema 说明”一起喂给 LLM，让它只输出视觉 spec。[web:15][web:18][web:24]

4. **校验与修复**
   - 在后端用 JSON schema / 自定义代码验证：
     - JSON 是否 parse 成功。
     - 字段是否合法、类型正确、值域合理。
   - 若出错：
     - 把具体错误信息作为新的 System/User 消息发给 LLM，让它“修复上次输出”。
     - 若多次失败，回退为“纯文字 + 语义描述图表”。[web:15][web:24]

5. **返回前端**
   - 将 `text + visuals` 作为统一回复返回。
   - 前端渲染视觉，如有错误可展示友好 fallback（例如“图表生成失败，请重试”）。

---

## 5. 前端渲染与交互机制

### 5.1 渲染技术栈

结合 Artifacts 的能力和常见实践，你可以选用以下技术：[web:18][web:22][web:23][web:25]

- 框架：React / Vue / Svelte 皆可，建议 React（生态丰富）。
- 图表库：
  - Vega/Vega-Lite（推荐，学术和工程都有成熟 LLM 集成实践）。[web:15][web:24]
  - 或 ECharts、Plotly（JSON 配置式）。
- 流程/结构图：
  - Mermaid：易于 LLM 生成，适合简单流程图。[web:22][web:25]
  - Cytoscape.js / React Flow：适合复杂图结构。[web:18]

每种 `type` 由对应组件负责渲染，如：

- `type === "chart"` → `<VegaChart spec={visual.spec} />`
- `type === "diagram" && style === "mermaid"` → `<MermaidDiagram code={visual.code} />`

### 5.2 交互事件与后端联动

Claude 的视觉可以根据后续提问“适配和更新”，你可以用事件驱动来实现：[web:11][web:16][web:20][web:23]

- 前端交互 → 事件对象：
  ```json
  {
    "visual_id": "vis-1",
    "event": "param_change",
    "param": "interest_rate",
    "value": 0.08
  }
  ```
- 后端处理策略：
  - 纯前端重算：如果变化只是简单数学变换，可以在前端直接重绘。
  - LLM 辅助：需要复杂解释/重构图表时，将当前 spec + 事件摘要 + 用户请求作为新一轮对话输入，让 LLM 输出新 spec。

---

## 6. LLM 提示工程与安全策略

### 6.1 Prompt 设计原则

参考 Chart-LLM / VegaChat 等工作，总结对 LLM 的通用要求：[web:15][web:24][web:26]

- 明确 schema 和例子：
  - 逐字段说明：`type`、`library`、`data`、`spec` 的含义和约束。
  - 提供多种示例图表与对应输入。
- 要求“只输出机器可读结构”：
  - 禁止 Markdown、自然语言解释混入。
  - 若要返回多种图表，则输出数组。
- 鼓励数据合理性：
  - 时间轴用 ISO 日期。
  - 类别名保持简洁。
  - 数值范围控制在合理区间。

### 6.2 安全与隔离

Artifacts 支持 HTML/JS/React，说明 Claude 内部使用了沙箱来防止危险代码直接在主环境执行。[web:22][web:23][web:25]

你在自研交互视觉时建议：

- 前端只解析受控 DSL/JSON，不允许 LLM 直接输出 JS 代码执行。
- 若要支持代码级交互（Dashboard / React App），必须在沙箱 iframe 或 Worker 中运行，并做：
  - `Content-Security-Policy` 限制。
  - 禁止访问高权限 API（Storage、Cookie、跨域请求等）。
- 所有外部资源（图片/脚本）都由后端代理或白名单控制。

---

## 7. 面向你团队的落地实施蓝图

### 7.1 推荐技术选型

- 后端：
  - 语言：TypeScript (Node.js) 或 Python（FastAPI）。
  - 职责：对话编排、工具调用、visual spec 生成与校验。

- LLM：
  - 你的基础模型（如自研/托管大模型），额外设计一个“visual spec 生成”专用系统提示。

- 前端：
  - React + TypeScript。
  - 图表：Vega-Lite + `vega-embed`。[web:15][web:24]
  - 流程图：Mermaid + Cytoscape.js（视复杂度决定）。[web:18][web:22][web:25]

### 7.2 核心模块拆分

1. `ConversationOrchestrator`
   - 入口：用户消息。
   - 功能：  
     - 拼接上下文 → 调用主 LLM。
     - 判断是否需要视觉 → 是则调用 `VisualSpecGenerator`。

2. `VisualSpecGenerator`
   - 输入：用户需求、数据摘要、上下文。
   - 过程：用视觉专用 Prompt 调用 LLM → 校验 JSON → 若失败则修复或降级。
   - 输出：视觉 spec 对象列表。

3. `VisualSchemaValidator`
   - 使用 JSON Schema 或手写校验器。
   - 检查字段、类型、取值范围。

4. 前端组件库
   - `<ChatMessage>`：渲染文字 + `<VisualBlock>`。
   - `<VisualBlock>`：根据 `visual.type` 分发到 `<ChartView>`、`<DiagramView>` 等。
   - 交互事件上报到后端，或在前端局部计算。

---

## 8. 你下一步可以做什么

在现有分析基础上，你可以直接推进的下一步包括：

- 确定一版 **Visual DSL JSON Schema**（图表 + 流程图 + 参数）。
- 为你的 LLM 写一套“visual spec generator” System Prompt，并准备 5–10 个高质量示例。
- 在后端加入一个“生成 → 校验 → 修复” pipeline。
- 在前端实现消息结构 + 内联渲染 + 交互事件通路。

如果你告诉我你的技术栈（比如“后端 Go + 前端 Vue3”或“Python + React”等），我可以在这个报告基础上再给你一份更细的“工程级设计文档”，包括接口设计和 JSON Schema 草稿，可直接给团队落地。  