import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { buildEmbeddingModelOptions, KnowledgeView } from "../../src/features/knowledge/KnowledgeView";
import type { KnowledgeBaseSummary, ModelProviderConfig } from "../../src/types";

function readSource(relativePath: string) {
  const localPath = path.resolve(process.cwd(), relativePath);
  return readFileSync(existsSync(localPath) ? localPath : path.resolve(process.cwd(), "..", relativePath), "utf8");
}

const provider: ModelProviderConfig = {
  id: "openai",
  name: "OpenAI",
  kind: "openai-compatible",
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  temperature: 0.7,
  maxTokens: 4096,
  enabled: true,
  models: [
    {
      id: "text-embedding-3-small",
      label: "Text Embedding 3 Small",
      enabled: true,
      capabilities: { embedding: true },
    },
    {
      id: "gpt-5-mini",
      label: "GPT-5 Mini",
      enabled: true,
    },
  ],
};

const customProvider: ModelProviderConfig = {
  id: "custom",
  name: "Custom",
  kind: "openai-compatible",
  baseUrl: "https://example.com/v1",
  apiKey: "",
  temperature: 0.7,
  maxTokens: 4096,
  enabled: true,
  models: [
    {
      id: "bge-m3",
      label: "BGE M3",
      enabled: true,
    },
    {
      id: "chat-only",
      label: "Chat Only",
      enabled: true,
    },
  ],
};

const knowledgeBase: KnowledgeBaseSummary = {
  id: "kb-1",
  name: "产品知识库",
  description: "",
  itemCount: 0,
  chunkCount: 0,
  createdAt: Date.UTC(2026, 4, 23, 8, 0, 0),
  updatedAt: Date.UTC(2026, 4, 23, 8, 0, 0),
  items: [],
};

const secondKnowledgeBase: KnowledgeBaseSummary = {
  ...knowledgeBase,
  id: "kb-2",
  name: "发生",
};

function renderKnowledgeView(knowledgeBases: KnowledgeBaseSummary[] = [knowledgeBase]) {
  return renderToStaticMarkup(
    <KnowledgeView
      config={{
        enabled: true,
        embeddingProviderId: provider.id,
        embeddingModel: "text-embedding-3-small",
        selectedBaseIds: [],
        documentCount: 0,
        chunkSize: 1000,
        chunkOverlap: 120,
      }}
      knowledgeBases={knowledgeBases}
      knowledgeRefreshing={false}
      modelProviders={[provider, customProvider]}
      onAddKnowledgeDirectory={async () => undefined}
      onAddKnowledgeFiles={async () => undefined}
      onAddKnowledgeNote={async () => undefined}
      onAddKnowledgeUrl={async () => undefined}
      onAddKnowledgeWebsite={async () => undefined}
      onChangeEmbeddingSelection={() => undefined}
      onCreateKnowledgeBase={async () => "kb-2"}
      onUpdateKnowledgeBase={async () => true}
      onDeleteKnowledgeBase={async () => undefined}
      onDeleteKnowledgeItem={async () => undefined}
      onRefresh={async () => undefined}
      onToast={() => undefined}
    />,
  );
}

test("knowledge view builds one combined embedding model picker from provider models", () => {
  const options = buildEmbeddingModelOptions([provider, customProvider]);

  assert.deepEqual(
    options.map((option) => ({
      modelId: option.modelId,
      providerId: option.providerId,
      providerName: option.providerName,
    })),
    [
      { modelId: "text-embedding-3-small", providerId: "openai", providerName: "OpenAI" },
      { modelId: "bge-m3", providerId: "custom", providerName: "Custom" },
    ],
  );
});

test("knowledge view keeps the knowledge page free of duplicate stat chrome", () => {
  const html = renderKnowledgeView();

  assert.doesNotMatch(html, /集中管理文件、笔记、目录和网页资料。/);
  assert.doesNotMatch(html, /class="knowledge-empty-upload/);
  assert.doesNotMatch(html, />还没有文件</);
  assert.doesNotMatch(html, /class="knowledge-sidebar-overview"/);
  assert.doesNotMatch(html, /class="knowledge-hero-metrics"/);
  assert.doesNotMatch(html, /class="knowledge-hero-head"/);
  assert.doesNotMatch(html, /title="刷新知识库"/);
  assert.doesNotMatch(html, /class="knowledge-stat-card"/);
  assert.doesNotMatch(html, /class="knowledge-kicker"/);
  assert.doesNotMatch(html, /knowledge-settings-strip/);
  assert.match(html, /class="chat-model-picker knowledge-embedding-picker"/);
  assert.match(html, /当前嵌入模型 Text Embedding 3 Small/);
  assert.match(html, /class="[^"]*primary-button[^"]*knowledge-upload-button[^"]*"/);
});

test("knowledge sidebar exposes create and per-base actions without inline create form", () => {
  const html = renderKnowledgeView([knowledgeBase, secondKnowledgeBase]);
  const source = readSource("src/features/knowledge/KnowledgeView.tsx");
  const css = readSource("src/styles.css");

  assert.match(html, /aria-label="新建知识库"/);
  assert.match(html, /knowledge-sidebar-create-trigger/);
  assert.match(html, /knowledge-base-menu-trigger/);
  assert.match(html, /knowledge-base-count/);
  assert.doesNotMatch(html, /knowledge-sidebar-title-icon/);
  assert.match(html, /knowledge-base-icon tone-\d/);
  assert.equal((html.match(/knowledge-base-icon tone-/g) ?? []).length, 2);
  assert.doesNotMatch(html, /<span>0 条资料<\/span>/);
  assert.doesNotMatch(html, /<em>[^<]*(时|天|分)<\/em>/);
  assert.doesNotMatch(html, /class="knowledge-sidebar-create"/);
  assert.match(css, /\.knowledge-base-row\.menu-open\s*{[^}]*z-index:\s*[1-9]\d*;/s);
  assert.match(css, /\.knowledge-base-row\.active\s*{[^}]*var\(--kb-tone\)/s);
  assert.match(css, /\.knowledge-base-row:hover\s+\.knowledge-base-count,\s*\.knowledge-base-row:focus-within\s+\.knowledge-base-count,\s*\.knowledge-base-row\.menu-open\s+\.knowledge-base-count\s*{[^}]*opacity:\s*0;/s);
  assert.match(css, /\.knowledge-base-row:hover\s+\.knowledge-base-menu-trigger,\s*\.knowledge-base-row:focus-within\s+\.knowledge-base-menu-trigger,\s*\.knowledge-base-row\.menu-open\s+\.knowledge-base-menu-trigger\s*{[^}]*opacity:\s*1;/s);
  assert.doesNotMatch(css, /\.knowledge-base-row\.active\s*{[^}]*inset\s+3px\s+0\s+0/s);
  assert.match(
    css,
    /\.skills-toolbar-copy h2,\s*\.memory-sidebar-head h2,\s*\.knowledge-sidebar-head h2\s*{[^}]*font-size:\s*var\(--module-title-size\);/s,
  );
  assert.doesNotMatch(css, /\.knowledge-sidebar-head h2\s*{[^}]*font-size:\s*24px;/s);
  assert.match(source, /编辑知识库/);
});

test("module titles use one compact shared size and aligned title rows", () => {
  const css = readSource("src/styles.css");

  assert.match(css, /--module-title-size:\s*28px;/);
  assert.match(
    css,
    /\.skills-toolbar\s*{[^}]*align-items:\s*center;[^}]*min-height:\s*var\(--module-toolbar-title-row-height\);/s,
  );
  assert.match(
    css,
    /\.skills-toolbar-actions\s*{[^}]*--skill-toolbar-control-size:\s*var\(--module-toolbar-title-row-height\);/s,
  );
  assert.match(
    css,
    /\.memory-sidebar,\s*\.knowledge-sidebar\s*{[^}]*padding:\s*var\(--module-sidebar-padding\);/s,
  );
  assert.match(
    css,
    /\.memory-sidebar-head,\s*\.knowledge-sidebar-title-row\s*{[^}]*min-height:\s*var\(--module-sidebar-title-row-height\);/s,
  );
  assert.match(css, /\.memory-sidebar-head\s*{[^}]*align-content:\s*center;/s);
});

test("knowledge view localizes embedding and keeps add surface compact", () => {
  const html = renderKnowledgeView();
  const css = readSource("src/styles.css");

  assert.match(html, />嵌入模型</);
  assert.match(html, /aria-label="嵌入模型说明"/);
  assert.match(html, /knowledge-help-tooltip/);
  assert.doesNotMatch(html, />Embedding</);
  assert.match(html, /class="knowledge-ingest-panel/);
  assert.match(html, /class="[^"]*knowledge-ingest-action[^"]*"/);
  assert.match(css, /\.knowledge-hero\.simple\s*{[^}]*position:\s*relative;[^}]*z-index:\s*3;/s);
  assert.match(css, /\.knowledge-help-tooltip\s*{[^}]*top:\s*calc\(100%\s*\+\s*8px\);/s);
  assert.doesNotMatch(css, /\.knowledge-help-tooltip\s*{[^}]*bottom:\s*calc\(100%\s*\+\s*9px\);/s);
  assert.match(css, /\.knowledge-base-modal\s*{/);
  assert.match(css, /\.knowledge-base-modal-fields\s*{/);
});

test("primary actions use the updated accent treatment instead of black buttons", () => {
  const css = readSource("src/styles.css");

  assert.doesNotMatch(css, /\.primary-button\s*{[^}]*background:\s*#171717;/s);
  assert.doesNotMatch(css, /\.primary-button:hover\s*{[^}]*background:\s*#0f0f0f;/s);
  assert.doesNotMatch(css, /\.composer-attachment-remove\s*{[^}]*background:\s*#111827;/s);
  assert.doesNotMatch(css, /\.composer-attachment-remove:hover\s*{[^}]*background:\s*#111827;/s);
  assert.doesNotMatch(css, /#2f6bff|#7a55f6|#245dff|#6847e8|#315df6/);
  assert.match(css, /--primary-action-bg:/);
  assert.match(css, /--primary-action-bg:\s*linear-gradient\(135deg,\s*var\(--send-gradient-start\)/);
  assert.match(css, /\.primary-button\s*{[^}]*background:\s*var\(--primary-action-bg\)/s);
});
