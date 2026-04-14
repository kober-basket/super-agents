import { mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { readJsonFile, writeJsonFile } from "./store";
import type {
  AppConfig,
  FileDropEntry,
  KnowledgeAddDirectoryInput,
  KnowledgeAddFilesInput,
  KnowledgeAddNoteInput,
  KnowledgeAddUrlInput,
  KnowledgeBaseCreateInput,
  KnowledgeDeleteItemInput,
  KnowledgeBaseSummary,
  KnowledgeCatalogPayload,
  KnowledgeItemSummary,
  KnowledgeSearchPayload,
  KnowledgeSearchResultItem,
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
  type: "file" | "note" | "directory" | "url" | "website";
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

const TEXT_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".json",
  ".yaml",
  ".yml",
  ".xml",
  ".csv",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".java",
  ".go",
  ".rs",
  ".css",
  ".scss",
  ".less",
]);

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
    throw new Error("Configure an embedding provider URL first.");
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

function isHtmlPath(filePath: string) {
  return /\.html?$/i.test(filePath);
}

function isSupportedTextFile(filePath: string) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function resolveTitleFromUrl(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    return url;
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function extractWebsiteLinks(html: string, sourceUrl: string, limit = 8) {
  const matches = Array.from(html.matchAll(/href=["']([^"'#]+)["']/gi));
  const links: string[] = [];
  let origin = "";

  try {
    origin = new URL(sourceUrl).origin;
  } catch {
    return [];
  }

  for (const match of matches) {
    const href = match[1]?.trim();
    if (!href) continue;

    try {
      const resolved = new URL(href, sourceUrl);
      if (resolved.origin !== origin) continue;
      if (!/^https?:$/i.test(resolved.protocol)) continue;
      links.push(resolved.toString());
      if (links.length >= limit) break;
    } catch {
      continue;
    }
  }

  return uniqueStrings(links);
}

function extractSitemapLinks(xml: string, limit = 20) {
  const matches = Array.from(xml.matchAll(/<loc>(.*?)<\/loc>/gi));
  return uniqueStrings(matches.map((match) => match[1]?.trim() ?? "")).slice(0, limit);
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
      throw new Error("Knowledge base not found.");
    }
    return base;
  }

  private resolveEmbeddingProvider(config: AppConfig) {
    const providerId = config.knowledgeBase.embeddingProviderId.trim();
    const provider = config.modelProviders.find((item) => item.id === providerId && item.enabled !== false);
    if (!provider) {
      throw new Error("Select an enabled embedding provider first.");
    }
    const model = config.knowledgeBase.embeddingModel.trim();
    if (!model) {
      throw new Error("Enter an embedding model first.");
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
      const apiKey = provider.apiKey.trim();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
        headers["api-key"] = apiKey;
        headers["x-api-key"] = apiKey;
      }

      const response = await fetch(createEmbeddingsUrl(provider.baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          input: batch,
        }),
      });

      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(rawText || `Embedding request failed: ${response.status}`);
      }

      const payload = rawText ? (JSON.parse(rawText) as { data?: Array<{ embedding?: number[] }> }) : {};
      const batchVectors = Array.isArray(payload.data)
        ? payload.data.map((item) => item.embedding ?? []).filter((item) => item.length > 0)
        : [];

      if (batchVectors.length !== batch.length) {
        throw new Error("Embedding provider returned an unexpected result.");
      }

      vectors.push(...batchVectors);
    }

    return vectors;
  }

  private async readKnowledgeFile(file: FileDropEntry) {
    if (!file.path) {
      throw new Error(`Missing file path for ${file.name}`);
    }

    const text = file.content ?? (await readFile(file.path, "utf8"));
    const normalized = isHtmlPath(file.path) ? stripHtmlTags(text) : compactWhitespace(text);
    if (!normalized) {
      throw new Error(`File ${file.name} does not contain readable text.`);
    }

    return {
      title: file.name,
      source: file.path,
      text: normalized,
      type: "file" as const,
    };
  }

  private async readDirectoryFiles(directoryPath: string) {
    const results: Array<{ title: string; source: string; text: string; type: "directory" }> = [];
    const queue = [directoryPath];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const entries = await readdir(current, { withFileTypes: true }).catch(() => []);

      for (const entry of entries) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          queue.push(fullPath);
          continue;
        }
        if (!entry.isFile() || !isSupportedTextFile(fullPath)) {
          continue;
        }

        try {
          const raw = await readFile(fullPath, "utf8");
          const text = isHtmlPath(fullPath) ? stripHtmlTags(raw) : compactWhitespace(raw);
          if (!text) continue;
          results.push({
            title: path.relative(directoryPath, fullPath) || entry.name,
            source: fullPath,
            text,
            type: "directory",
          });
        } catch {
          continue;
        }
      }
    }

    return results;
  }

  private async fetchUrlDocument(url: string, type: "url" | "website") {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });
    const raw = await response.text();
    if (!response.ok) {
      throw new Error(raw || `Request failed: ${response.status}`);
    }

    const contentType = response.headers.get("content-type") || "";
    const isHtml = contentType.includes("html");
    const text = isHtml ? stripHtmlTags(raw) : compactWhitespace(raw);
    if (!text) {
      throw new Error(`No readable content found at ${url}`);
    }

    return {
      title: resolveTitleFromUrl(url),
      source: url,
      text,
      raw,
      type,
      contentType,
    };
  }

  private async appendDocuments(
    config: AppConfig,
    base: StoredKnowledgeBase,
    chunks: StoredKnowledgeChunk[],
    documents: Array<{ title: string; source: string; text: string; type: StoredKnowledgeItem["type"] }>,
  ) {
    const now = Date.now();

    for (const document of documents) {
      const chunkTexts = chunkText(document.text, config.knowledgeBase.chunkSize, config.knowledgeBase.chunkOverlap);
      if (chunkTexts.length === 0) continue;

      const vectors = await this.embedTexts(config, chunkTexts);
      const itemId = randomUUID();

      base.items.unshift({
        id: itemId,
        type: document.type,
        title: document.title,
        source: document.source,
        createdAt: now,
        updatedAt: now,
      });

      chunks.push(
        ...chunkTexts.map((text, index) => ({
          id: randomUUID(),
          baseId: base.id,
          itemId,
          text,
          source: document.source,
          title: document.title,
          vector: vectors[index],
          createdAt: now,
        })),
      );
    }

    base.updatedAt = now;
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
      throw new Error("Enter a knowledge base name first.");
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

  async deleteItem(input: KnowledgeDeleteItemInput) {
    const index = await this.loadIndex();
    const base = this.requireBase(index, input.baseId);
    const existing = base.items.find((item) => item.id === input.itemId);
    if (!existing) {
      throw new Error("Knowledge item not found.");
    }

    base.items = base.items.filter((item) => item.id !== input.itemId);
    base.updatedAt = Date.now();

    const chunks = await this.loadChunks(base.id);
    const remainingChunks = chunks.filter((chunk) => chunk.itemId !== input.itemId);

    await this.saveIndex(index);
    await this.saveChunks(base.id, remainingChunks);
    return await this.listBases();
  }

  async addNote(config: AppConfig, input: KnowledgeAddNoteInput) {
    const title = input.title.trim();
    const content = compactWhitespace(input.content);
    if (!title || !content) {
      throw new Error("Enter both a note title and note content.");
    }

    const index = await this.loadIndex();
    const base = this.requireBase(index, input.baseId);
    const chunks = await this.loadChunks(base.id);

    await this.appendDocuments(config, base, chunks, [
      {
        title,
        source: "note",
        text: content,
        type: "note",
      },
    ]);

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
    const documents = await Promise.all(input.files.map((file) => this.readKnowledgeFile(file)));

    await this.appendDocuments(config, base, chunks, documents);
    await this.saveIndex(index);
    await this.saveChunks(base.id, chunks);
    return await this.listBases();
  }

  async addDirectory(config: AppConfig, input: KnowledgeAddDirectoryInput) {
    const directoryPath = input.directoryPath.trim();
    if (!directoryPath) {
      throw new Error("Select a folder first.");
    }

    const index = await this.loadIndex();
    const base = this.requireBase(index, input.baseId);
    const chunks = await this.loadChunks(base.id);
    const documents = await this.readDirectoryFiles(directoryPath);

    if (documents.length === 0) {
      throw new Error("No supported text files were found in this folder.");
    }

    await this.appendDocuments(config, base, chunks, documents);
    await this.saveIndex(index);
    await this.saveChunks(base.id, chunks);
    return await this.listBases();
  }

  async addUrl(config: AppConfig, input: KnowledgeAddUrlInput) {
    const url = input.url.trim();
    if (!url) {
      throw new Error("Enter a URL first.");
    }

    const index = await this.loadIndex();
    const base = this.requireBase(index, input.baseId);
    const chunks = await this.loadChunks(base.id);
    const document = await this.fetchUrlDocument(url, "url");

    await this.appendDocuments(config, base, chunks, [document]);
    await this.saveIndex(index);
    await this.saveChunks(base.id, chunks);
    return await this.listBases();
  }

  async addWebsite(config: AppConfig, input: KnowledgeAddUrlInput) {
    const url = input.url.trim();
    if (!url) {
      throw new Error("Enter a website URL first.");
    }

    const index = await this.loadIndex();
    const base = this.requireBase(index, input.baseId);
    const chunks = await this.loadChunks(base.id);
    const rootDocument = await this.fetchUrlDocument(url, "website");
    const documents: Array<{ title: string; source: string; text: string; type: "website" }> = [
      { ...rootDocument, type: "website" },
    ];

    const links = rootDocument.contentType.includes("xml")
      ? extractSitemapLinks(rootDocument.raw)
      : extractWebsiteLinks(rootDocument.raw, url);

    for (const link of links.slice(0, 8)) {
      try {
        const document = await this.fetchUrlDocument(link, "website");
        documents.push({ ...document, type: "website" });
      } catch {
        continue;
      }
    }

    await this.appendDocuments(config, base, chunks, documents);
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
        warnings: ["No knowledge base is selected."],
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
