import type {
  KnowledgeBaseConnectionConfig,
  KnowledgeBaseSummary,
  KnowledgeCatalogPayload,
  KnowledgeInjectionMeta,
  KnowledgeSearchPayload,
  KnowledgeSearchResultItem,
} from "../src/types";

const DEFAULT_CHERRY_KNOWLEDGE_BASE_URL = "http://127.0.0.1:23333/v1";

type CherryKnowledgeListResponse = {
  knowledge_bases?: Array<Record<string, unknown>>;
};

type CherryKnowledgeSearchResponse = {
  query?: string;
  total?: number;
  results?: Array<Record<string, unknown>>;
  searched_bases?: Array<Record<string, unknown>>;
  warnings?: string[];
};

function normalizeBaseUrl(value: string) {
  const trimmed = value.trim() || DEFAULT_CHERRY_KNOWLEDGE_BASE_URL;
  const normalized = trimmed.replace(/\/+$/, "");
  return /\/v1$/i.test(normalized) ? normalized : `${normalized}/v1`;
}

function makeHeaders(config: KnowledgeBaseConnectionConfig) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    "x-api-key": config.apiKey.trim(),
  };
}

function isConfigured(config: KnowledgeBaseConnectionConfig) {
  return config.enabled && Boolean(config.apiKey.trim()) && Boolean(normalizeBaseUrl(config.baseUrl));
}

async function readErrorMessage(response: Response) {
  const text = await response.text();
  if (!text) {
    return `Cherry Studio knowledge request failed: ${response.status}`;
  }

  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") return parsed.error;
    if (parsed.error?.message) return parsed.error.message;
  } catch {
    // Fall back to raw text.
  }

  return text;
}

function mapKnowledgeBase(record: Record<string, unknown>): KnowledgeBaseSummary {
  return {
    id: String(record.id ?? ""),
    name: String(record.name ?? record.id ?? ""),
    description: typeof record.description === "string" ? record.description : undefined,
    documentCount: typeof record.documentCount === "number" ? record.documentCount : undefined,
    itemCount: Array.isArray(record.items) ? record.items.length : undefined,
    updatedAt: typeof record.updated_at === "number" ? record.updated_at : undefined,
  };
}

function mapSearchResult(record: Record<string, unknown>): KnowledgeSearchResultItem {
  return {
    pageContent: typeof record.pageContent === "string" ? record.pageContent : "",
    score: typeof record.score === "number" ? record.score : 0,
    metadata: (record.metadata as Record<string, unknown>) ?? {},
    knowledgeBaseId: String(record.knowledge_base_id ?? ""),
    knowledgeBaseName: String(record.knowledge_base_name ?? record.knowledge_base_id ?? ""),
  };
}

export class CherryKnowledgeClient {
  async listKnowledgeBases(config: KnowledgeBaseConnectionConfig): Promise<KnowledgeCatalogPayload> {
    if (!config.enabled) {
      return { fetchedAt: Date.now(), connectionOk: false, knowledgeBases: [] };
    }

    if (!config.apiKey.trim()) {
      throw new Error("请先填写 Cherry Studio API Key。");
    }

    const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/knowledge-bases`, {
      method: "GET",
      headers: makeHeaders(config),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const payload = (await response.json()) as CherryKnowledgeListResponse;
    const knowledgeBases = Array.isArray(payload.knowledge_bases)
      ? payload.knowledge_bases.map(mapKnowledgeBase).filter((item) => item.id)
      : [];

    return {
      fetchedAt: Date.now(),
      connectionOk: true,
      knowledgeBases: knowledgeBases.sort((left, right) => left.name.localeCompare(right.name, "zh-CN")),
    };
  }

  async searchKnowledgeBases(
    config: KnowledgeBaseConnectionConfig,
    input: { query: string; knowledgeBaseIds?: string[]; documentCount?: number },
  ): Promise<KnowledgeSearchPayload> {
    if (!isConfigured(config)) {
      throw new Error("Cherry Studio 知识库未配置完成。");
    }

    const query = input.query.trim();
    if (!query) {
      return {
        query,
        total: 0,
        results: [],
        searchedBases: [],
        warnings: [],
      };
    }

    const response = await fetch(`${normalizeBaseUrl(config.baseUrl)}/knowledge-bases/search`, {
      method: "POST",
      headers: makeHeaders(config),
      body: JSON.stringify({
        query,
        knowledge_base_ids: input.knowledgeBaseIds?.filter(Boolean),
        document_count: input.documentCount ?? config.documentCount,
      }),
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
    }

    const payload = (await response.json()) as CherryKnowledgeSearchResponse;
    const results = Array.isArray(payload.results) ? payload.results.map(mapSearchResult) : [];

    return {
      query: typeof payload.query === "string" ? payload.query : query,
      total: typeof payload.total === "number" ? payload.total : results.length,
      results,
      searchedBases: Array.isArray(payload.searched_bases)
        ? payload.searched_bases.map((item) => ({
            id: String(item.id ?? ""),
            name: String(item.name ?? item.id ?? ""),
          }))
        : [],
      warnings: Array.isArray(payload.warnings)
        ? payload.warnings.map((item) => String(item))
        : [],
    };
  }

  buildInjectedPrompt(message: string, searchPayload: KnowledgeSearchPayload): { prompt: string; meta: KnowledgeInjectionMeta } {
    const trimmedMessage = message.trim();
    const selectedBaseIds = Array.from(
      new Set(searchPayload.searchedBases.map((item) => item.id).filter(Boolean)),
    );

    if (searchPayload.results.length === 0) {
      return {
        prompt: trimmedMessage,
        meta: {
          injected: false,
          query: searchPayload.query,
          resultCount: 0,
          searchedBaseIds: selectedBaseIds,
          warnings: searchPayload.warnings,
        },
      };
    }

    const contextBlock = searchPayload.results
      .map((item, index) => {
        const source = item.knowledgeBaseName || item.knowledgeBaseId || `KB-${index + 1}`;
        const score = Number.isFinite(item.score) ? item.score.toFixed(3) : "0.000";
        return [
          `[知识片段 ${index + 1}]`,
          `来源: ${source}`,
          `相关度: ${score}`,
          item.pageContent.trim(),
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n\n");

    return {
      prompt: [
        "请优先参考下面的知识库检索结果回答，只有当检索结果不足时再结合你自己的通用能力补充。",
        "如果引用了知识库内容，请明确说明依据来自知识库检索结果。",
        "",
        "知识库检索结果:",
        contextBlock,
        "",
        "用户问题:",
        trimmedMessage,
      ].join("\n"),
      meta: {
        injected: true,
        query: searchPayload.query,
        resultCount: searchPayload.results.length,
        searchedBaseIds: selectedBaseIds,
        warnings: searchPayload.warnings,
      },
    };
  }
}

export { DEFAULT_CHERRY_KNOWLEDGE_BASE_URL };
