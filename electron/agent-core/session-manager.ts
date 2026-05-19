import type { AgentSession } from "./types";
import type { ConversationService } from "../conversation-service";

export interface AgentSessionManager {
  getOrCreate(sessionId: string, agentId: string): AgentSession;
  get(sessionId: string): AgentSession | undefined;
  save(session: AgentSession): void;
}

export class InMemoryAgentSessionManager implements AgentSessionManager {
  private readonly sessions = new Map<string, AgentSession>();

  getOrCreate(sessionId: string, agentId: string) {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const session: AgentSession = {
      id: sessionId,
      agentId,
      messages: [],
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  get(sessionId: string) {
    return this.sessions.get(sessionId);
  }

  save(session: AgentSession) {
    this.sessions.set(session.id, session);
  }
}

export class PersistentAgentSessionManager implements AgentSessionManager {
  private readonly cache = new Map<string, AgentSession>();

  constructor(private readonly conversationService: ConversationService) {}

  getOrCreate(sessionId: string, agentId: string) {
    const existing = this.get(sessionId);
    if (existing) {
      return existing;
    }

    const session: AgentSession = {
      id: sessionId,
      agentId,
      messages: [],
    };
    this.save(session);
    return session;
  }

  get(sessionId: string) {
    const cached = this.cache.get(sessionId);
    if (cached) {
      return cached;
    }

    const stored = this.conversationService.getAgentSession(sessionId);
    if (!stored) {
      return undefined;
    }

    this.cache.set(sessionId, stored);
    return stored;
  }

  save(session: AgentSession) {
    this.cache.set(session.id, session);
    this.conversationService.saveAgentSession(session);
  }
}
