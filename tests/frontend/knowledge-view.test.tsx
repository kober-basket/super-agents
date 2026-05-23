import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { KnowledgeView } from "../../src/features/knowledge/KnowledgeView";
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

function renderKnowledgeView() {
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
      knowledgeBases={[knowledgeBase]}
      knowledgeRefreshing={false}
      modelProviders={[provider]}
      onAddKnowledgeDirectory={async () => undefined}
      onAddKnowledgeFiles={async () => undefined}
      onAddKnowledgeNote={async () => undefined}
      onAddKnowledgeUrl={async () => undefined}
      onAddKnowledgeWebsite={async () => undefined}
      onChangeEmbeddingModel={() => undefined}
      onChangeEmbeddingProvider={() => undefined}
      onCreateKnowledgeBase={async () => "kb-2"}
      onDeleteKnowledgeBase={async () => undefined}
      onDeleteKnowledgeItem={async () => undefined}
      onRefresh={async () => undefined}
      onToast={() => undefined}
    />,
  );
}

test("knowledge view keeps sidebar copy compact and centers the empty file action", () => {
  const html = renderKnowledgeView();

  assert.doesNotMatch(html, /集中管理文件、笔记、目录和网页资料。/);
  assert.match(html, /class="knowledge-empty-upload/);
  assert.match(html, />还没有文件</);
  assert.match(html, /class="knowledge-sidebar-overview"/);
  assert.match(html, /class="primary-button knowledge-upload-button"/);
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
