import { randomUUID } from "node:crypto";

import type { TaskGraph, TaskGraphNode, TaskGraphNodeStatus } from "./types";

export class InMemoryTaskGraphStore {
  private readonly graphs = new Map<string, TaskGraph>();

  create(title: string, nodes: Omit<TaskGraphNode, "id" | "status">[]) {
    const graph: TaskGraph = {
      id: randomUUID(),
      title,
      nodes: nodes.map((node) => ({
        ...node,
        id: randomUUID(),
        status: "pending",
      })),
    };
    this.graphs.set(graph.id, graph);
    return graph;
  }

  get(graphId: string) {
    return this.graphs.get(graphId) ?? null;
  }

  updateNode(graphId: string, nodeId: string, status: TaskGraphNodeStatus) {
    const graph = this.graphs.get(graphId);
    if (!graph) return null;
    const next = {
      ...graph,
      nodes: graph.nodes.map((node) => (node.id === nodeId ? { ...node, status } : node)),
    };
    this.graphs.set(graphId, next);
    return next;
  }
}
