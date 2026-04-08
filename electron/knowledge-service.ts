import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { readJsonFile, writeJsonFile } from "./store";
import type {
  AppConfig,
  FileDropEntry,
  KnowledgeAddFilesInput,
  KnowledgeAddNoteInput,
  KnowledgeBaseCreateInput,
  KnowledgeBaseSummary,
  KnowledgeCatalogPayload,
  KnowledgeItemSummary,
  KnowledgeSearchPayload,
  KnowledgeSearchResultItem,
  ModelProviderConfig,
} from "../src/types";

type StoredKnowledgeIndex = {
  bases: StoredKnowledgeBase[];
};

type StoredKnowledgeBase = {
  id: string;
  name: string;
  description?: string;
  createdAt: number;
  updatedAt: number;
  items: StoredKnowledgeItem[];
};

type StoredKnowledgeItem = {
  id: string;
  type: "file" | "note" | "url";
  title: string;
  source: string;
  createdAt: number;
  updatedAt: number;
};

type StoredKnowledgeChunk = {
  id: string;
  baseId: string;
  itemId: string;
  text: string;
  source: string;
  title: string;
  vector: number[];
  createdAt: number;
};

function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || right.length === 0 || left.length !== right.length) return 0;

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

function normalizeBaseUrl(value: string) {
  return value.trim().replace(/\/+$/, "");
}

function createEmbeddingsUrl(baseUrl: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  if (!normalized) {
    throw new Error("请先配置嵌入模型对应的 Provider 地址。");
  }
  return normalized.endsWith("/embeddings") ? normalized : `${normalized}/embeddings`;
}

function compactWhitespace(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function stripHtmlTags(value: string) {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkText(text: string, chunkSize: number, chunkOverlap: number) {
  const content = compactWhitespace(text);
  if (!content) return [];

  const result: string[] = [];
  let cursor = 0;
  while (cursor < content.length) {
    const end = Math.min(cursor + chunkSize, content.length);
    const slice = content.slice(cursor, end).trim();
    if (slice) {
      result.push(slice);
    }
    if (end >= content.length) break;
    cursor = Math.max(end - chunkOverlap, cursor + 1);
  }
  return result;
}

function mapItemSummary(item: StoredKnowledgeItem, chunkCount: number): KnowledgeItemSummary {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    source: item.source,
    chunkCount,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  };
}

function mapBaseSummary(base: StoredKnowledgeBase, chunks: StoredKnowledgeChunk[]): KnowledgeBaseSummary {
  const chunkCountByItem = new Map<string, number>();
  for (const chunk of chunks) {
    chunkCountByItem.set(chunk.itemId, (chunkCountByItem.get(chunk.itemId) ?? 0) + 1);
  }

  return {
    id: base.id,
    name: base.name,
    description: base.description,
    itemCount: base.items.length,
    chunkCount: chunks.length,
    createdAt: base.createdAt,
    updatedAt: base.updatedAt,
    items: base.items.map((item) => mapItemSummary(item, chunkCountByItem.get(item.id) ?? 0)),
  };
}

export class KnowledgeService {
  private readonly indexPath: string;
  private readonly basesDir: string;

  constructor(private readonly storageDir: string) {
    this.indexPath = path.join(storageDir, "index.json");
    this.basesDir = path.join(storageDir, "bases");
  }

  private async ensureStorage() {
    await mkdir(this.basesDir, { recursive: true });
  }

  private async loadIndex() {
    await this.ensureStorage();
    return await readJsonFile<StoredKnowledgeIndex>(this.indexPath, { bases: [] });
  }

  private async saveIndex(index: StoredKnowledgeIndex) {
    await this.ensureStorage();
    await writeJsonFile(this.indexPath, index);
  }

  private getChunksPath(baseId: string) {
    return path.join(this.basesDir, baseId, "chunks.json");
  }

  private async loadChunks(baseId: string) {
    return await readJsonFile<StoredKnowledgeChunk[]>(this.getChunksPath(baseId), []);
  }

  private async saveChunks(baseId: string, chunks: StoredKnowledgeChunk[]) {
    await writeJsonFile(this.getChunksPath(baseId), chunks);
  }

  private requireBase(index: StoredKnowledgeIndex, baseId: string) {
    const base = index.bases.find((item) => item.id === baseId);
    if (!base) {
      throw new Error("知识库不存在。");
    }
    return base;
  }

  private resolveEmbeddingProvider(config: AppConfig) {
    const providerId = config.knowledgeBase.embeddingProviderId.trim();
    const provider = config.modelProviders.find((item) => item.id === providerId && item.enabled !== false);
    if (!provider) {
      throw new Error("请先在知识库页面选择一个可用的嵌入 Provider。");
    }
    const model = config.knowledgeBase.embeddingModel.trim();
    if (!model) {
      throw new Error("请先填写嵌入模型名称。");
    }
    return { provider, model };
  }

  private async embedTexts(config: AppConfig, texts: string[]) {
    const batches: string[][] = [];
    for (let index = 0; index < texts.length; index += 16) {
      batches.push(texts.slice(index, index + 16));
    }

    const { provider, model } = this.resolveEmbeddingProvider(config);
    const vectors: number[][] = [];

    for (const batch of batches) {
      const response = await fetch(createEmbeddingsUrl(provider.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: provider.apiKey.trim() ? `Bearer ${provider.apiKey.trim()}` : "",
          "api-key": provider.apiKey.trim(),
          "x-api-key": provider.apiKey.trim(),
        },
        body: JSON.stringify({
          model,
          input: batch,
        }),
      });

      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(rawText || `嵌入请求失败: ${response.status}`);
      }

      const payload = rawText ? (JSON.parse(rawText) as { data?: Array<{ embedding?: number[] }> }) : {};
      const batchVectors = Array.isArray(payload.data)
        ? payload.data.map((item) => item.embedding ?? []).filter((item) => item.length > 0)
        : [];

      if (batchVectors.length !== batch.length) {
        throw new Error("嵌入接口返回结果数量不匹配。");
      }

      vectors.push(...batchVectors);
    }

    return vectors;
  }

  private async readKnowledgeFile(file: FileDropEntry) {
    if (!file.path) {
      throw new Error(`无法读取文件 ${file.name}`);
    }

    const text = file.content ?? (await readFile(file.path, "utf8"));
    const normalized = /\.html?$/i.test(file.path) ? stripHtmlTags(text) : compactWhitespace(text);
    if (!normalized) {
      throw new Error(`文件 ${file.name} 没有可检索的文本内容。`);
    }

    return {
      title: file.name,
      source: file.path,
      text: normalized,
    };
  }

  async listBases(): Promise<KnowledgeCatalogPayload> {
    const index = await this.loadIndex();
    const knowledgeBases = await Promise.all(
      index.bases.map(async (base) => mapBaseSummary(base, await this.loadChunks(base.id))),
    );

    return {
      fetchedAt: Date.now(),
      knowledgeBases: knowledgeBases.sort((left, right) => right.updatedAt - left.updatedAt),
    };
  }

  async createBase(input: KnowledgeBaseCreateInput) {
    const name = input.name.trim();
    if (!name) {
      throw new Error("知识库名称不能为空。");
    }

    const index = await this.loadIndex();
    const now = Date.now();
    index.bases.unshift({
      id: randomUUID(),
      name,
      description: input.description?.trim() || "",
      createdAt: now,
      updatedAt: now,
      items: [],
    });
    await this.saveIndex(index);
    return await this.listBases();
  }

  async deleteBase(baseId: string) {
    const index = await this.loadIndex();
    index.bases = index.bases.filter((item) => item.id !== baseId);
    await this.saveIndex(index);
    await rm(path.join(this.basesDir, baseId), { recursive: true, force: true }).catch(() => undefined);
    return await this.listBases();
  }

  async addNote(config: AppConfig, input: KnowledgeAddNoteInput) {
    const title = input.title.trim();
    const content = compactWhitespace(input.content);
    if (!title || !content) {
      throw new Error("笔记标题和内容都不能为空。");
    }

    const index = await this.loadIndex();
    const base = this.requireBase(index, input.baseId);
    const chunks = await this.loadChunks(base.id);
    const chunkTexts = chunkText(content, config.knowledgeBase.chunkSize, config.knowledgeBase.chunkOverlap);
    const vectors = await this.embedTexts(config, chunkTexts);
    const now = Date.now();
    const itemId = randomUUID();

    base.items.unshift({
      id: itemId,
      type: "note",
      title,
      source: "note",
      createdAt: now,
      updatedAt: now,
    });
    base.updatedAt = now;

    chunks.push(
      ...chunkTexts.map((text, index) => ({
        id: randomUUID(),
        baseId: base.id,
        itemId,
        text,
        source: "note",
        title,
        vector: vectors[index],
        createdAt: now,
      })),
    );

    await this.saveIndex(index);
    await this.saveChunks(base.id, chunks);
    return await this.listBases();
  }

  async addFiles(config: AppConfig, input: KnowledgeAddFilesInput) {
    if (input.files.length === 0) {
      return await this.listBases();
    }

    const index = await this.loadIndex();
    const base = this.requireBase(index, input.baseId);
    const chunks = await this.loadChunks(base.id);
    const now = Date.now();

    for (const file of input.files) {
      const source = await this.readKnowledgeFile(file);
      const chunkTexts = chunkText(source.text, config.knowledgeBase.chunkSize, config.knowledgeBase.chunkOverlap);
      const vectors = await this.embedTexts(config, chunkTexts);
      const itemId = randomUUID();

      base.items.unshift({
        id: itemId,
        type: "file",
        title: source.title,
        source: source.source,
        createdAt: now,
        updatedAt: now,
      });

      chunks.push(
        ...chunkTexts.map((text, index) => ({
          id: randomUUID(),
          baseId: base.id,
          itemId,
          text,
          source: source.source,
          title: source.title,
          vector: vectors[index],
          createdAt: now,
        })),
      );
    }

    base.updatedAt = now;
    await this.saveIndex(index);
    await this.saveChunks(base.id, chunks);
    return await this.listBases();
  }

  async search(config: AppConfig, input: { query: string; knowledgeBaseIds?: string[]; documentCount?: number }): Promise<KnowledgeSearchPayload> {
    const query = input.query.trim();
    if (!query) {
      return { query: "", total: 0, results: [], searchedBases: [], warnings: [] };
    }

    const index = await this.loadIndex();
    const targetBaseIds =
      input.knowledgeBaseIds && input.knowledgeBaseIds.length > 0
        ? input.knowledgeBaseIds
        : config.knowledgeBase.selectedBaseIds.length > 0
          ? config.knowledgeBase.selectedBaseIds
          : index.bases.map((item) => item.id);

    const targetBases = index.bases.filter((base) => targetBaseIds.includes(base.id));
    if (targetBases.length === 0) {
      return {
        query,
        total: 0,
        results: [],
        searchedBases: [],
        warnings: ["没有可检索的知识库。"],
      };
    }

    const [queryVector] = await this.embedTexts(config, [query]);
    const scoredResults: KnowledgeSearchResultItem[] = [];

    for (const base of targetBases) {
      const chunks = await this.loadChunks(base.id);
      for (const chunk of chunks) {
        const score = cosineSimilarity(queryVector, chunk.vector);
        scoredResults.push({
          pageContent: chunk.text,
          score,
          metadata: {
            title: chunk.title,
            source: chunk.source,
            itemId: chunk.itemId,
          },
          knowledgeBaseId: base.id,
          knowledgeBaseName: base.name,
        });
      }
    }

    const limit = input.documentCount ?? config.knowledgeBase.documentCount;
    const results = scoredResults
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.max(limit, 1));

    return {
      query,
      total: results.length,
      results,
      searchedBases: targetBases.map((item) => ({ id: item.id, name: item.name })),
      warnings: [],
    };
  }
}

export type { StoredKnowledgeBase };
