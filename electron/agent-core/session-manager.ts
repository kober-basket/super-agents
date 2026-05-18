import type { AgentSession } from "./types";

export class InMemoryAgentSessionManager {
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
}
