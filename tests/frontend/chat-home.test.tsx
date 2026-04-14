import assert from "node:assert/strict";
import test from "node:test";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ChatView } from "../../src/features/chat/ChatView";
import { CHAT_HOME_QUICK_PROMPTS } from "../../src/features/chat/home-state";

test("ChatView renders home prompts with composer selectors and without new chat entry", () => {
  const markup = renderToStaticMarkup(
    <ChatView
      attachments={[]}
      canSend={false}
      chatBusy={false}
      composer=""
      composerKnowledgeBaseIds={["kb-product"]}
      composerModelId="openai::gpt-5"
      currentWorkspaceLabel="super-agents"
      currentWorkspacePath="F:/work/github/super-agents"
      dragActive={false}
      knowledgeBaseOptions={[
        { id: "kb-product", name: "产品知识库" },
        { id: "kb-rag", name: "RAG 手册" },
      ]}
      messageListRef={createRef<HTMLDivElement>()}
      messages={[]}
      modelOptions={[
        { id: "openai::gpt-5", label: "OpenAI / GPT-5" },
        { id: "openai::gpt-5-mini", label: "OpenAI / GPT-5 Mini" },
      ]}
      previewAvailable={false}
      previewOpen={false}
      quickPrompts={CHAT_HOME_QUICK_PROMPTS}
      showHome={true}
      title="Current Chat"
      onChooseWorkspace={() => undefined}
      onComposerChange={() => undefined}
      onComposerKnowledgeBaseIdsChange={() => undefined}
      onComposerModelChange={() => undefined}
      onDragActiveChange={() => undefined}
      onFilesDropped={() => undefined}
      onOpenFile={() => undefined}
      onOpenLink={() => undefined}
      onPickFiles={() => undefined}
      onQuickPrompt={() => undefined}
      onRemoveAttachment={() => undefined}
      onSend={() => undefined}
      onStop={() => undefined}
      onTogglePreviewPane={() => undefined}
    />,
  );

  assert.match(markup, new RegExp(CHAT_HOME_QUICK_PROMPTS[0]!.title));
  assert.match(markup, new RegExp(CHAT_HOME_QUICK_PROMPTS[1]!.title));
  assert.match(markup, /OpenAI \/ GPT-5/);
  assert.match(markup, /产品知识库/);
  assert.match(markup, /选择模型/);
  assert.match(markup, /选择知识库/);
});
