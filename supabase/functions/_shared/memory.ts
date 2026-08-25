export type MemoryMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type Memory = {
  id: string;
  content: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

export type SearchMemoryInput = {
  userId: string;
  query: string;
  limit?: number;
};

export type SaveMemoryInput = {
  userId: string;
  messages: MemoryMessage[];
  metadata?: Record<string, unknown>;
  observedAt?: string;
};

/**
 * Provider-neutral boundary used by the coach. A future memory or RAG backend
 * only needs to implement this small lifecycle surface.
 */
export interface MemoryProvider {
  readonly name: string;
  search(input: SearchMemoryInput): Promise<Memory[]>;
  save(input: SaveMemoryInput): Promise<void>;
  deleteUser(userId: string): Promise<void>;
}

export class NoopMemoryProvider implements MemoryProvider {
  readonly name = "disabled";

  search(_input: SearchMemoryInput): Promise<Memory[]> {
    return Promise.resolve([]);
  }

  save(_input: SaveMemoryInput): Promise<void> {
    return Promise.resolve();
  }

  deleteUser(_userId: string): Promise<void> {
    return Promise.resolve();
  }
}

type Fetcher = typeof fetch;

type Mem0Memory = {
  id?: unknown;
  memory?: unknown;
  score?: unknown;
  metadata?: unknown;
};

type Mem0SearchResponse = {
  results?: unknown;
};

const DEFAULT_MEM0_URL = "https://api.mem0.ai";
const MEMORY_EXTRACTION_INSTRUCTIONS = [
  "Save only durable or temporally useful facts for personalized sleep coaching.",
  "Prioritize sleep goals and preferences, recurring sleep patterns, relevant life context,",
  "behaviors or experiments the user tried, adherence, observed outcomes, and coaching actions.",
  "Keep dates and changes over time when provided.",
  "Do not store generic coaching advice as a fact about the user.",
  "Do not infer diagnoses, medications, or facts that were not stated or supported by the data.",
].join(" ");

export class Mem0MemoryProvider implements MemoryProvider {
  readonly name = "mem0";

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = DEFAULT_MEM0_URL,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async search(input: SearchMemoryInput): Promise<Memory[]> {
    const response = await this.request("/v3/memories/search/", {
      query: input.query,
      filters: { user_id: input.userId },
      top_k: input.limit ?? 8,
      rerank: true,
    }, 3_500);

    const payload = await response.json() as Mem0SearchResponse;
    if (!Array.isArray(payload.results)) return [];

    return payload.results.flatMap((candidate): Memory[] => {
      if (!candidate || typeof candidate !== "object") return [];
      const item = candidate as Mem0Memory;
      if (typeof item.memory !== "string" || item.memory.trim().length === 0) {
        return [];
      }

      return [{
        id: typeof item.id === "string" ? item.id : "",
        content: item.memory.trim(),
        score: typeof item.score === "number" ? item.score : undefined,
        metadata: item.metadata && typeof item.metadata === "object"
          ? item.metadata as Record<string, unknown>
          : undefined,
      }];
    });
  }

  async save(input: SaveMemoryInput): Promise<void> {
    if (input.messages.length === 0) return;

    await this.request("/v3/memories/add/", {
      user_id: input.userId,
      messages: input.messages,
      metadata: input.metadata,
      custom_instructions: MEMORY_EXTRACTION_INSTRUCTIONS,
      observation_datetime: input.observedAt,
      temporal_reasoning: true,
    }, 5_000);
  }

  async deleteUser(userId: string): Promise<void> {
    await this.request(
      `/v1/memories/?user_id=${encodeURIComponent(userId)}`,
      undefined,
      5_000,
      "DELETE",
    );
  }

  private async request(
    path: string,
    body: Record<string, unknown> | undefined,
    timeoutMs: number,
    method = "POST",
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await this.fetcher(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Accept": "application/json",
          "Authorization": `Token ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(
          `Mem0 ${path} failed (${response.status})${
            detail ? `: ${detail.slice(0, 300)}` : ""
          }`,
        );
      }

      return response;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export function createMemoryProvider(
  apiKey: string | undefined,
): MemoryProvider {
  return apiKey ? new Mem0MemoryProvider(apiKey) : new NoopMemoryProvider();
}
