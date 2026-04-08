export const workspaceClient = {
  bootstrap: () => window.desktopAgent.bootstrap(),
  listThreads: () => window.desktopAgent.listThreads(),
  getThread: (threadId: string) => window.desktopAgent.getThread(threadId),
  createThread: (title?: string) => window.desktopAgent.createThread(title),
  setActiveThread: (threadId: string) => window.desktopAgent.setActiveThread(threadId),
  resetThread: (threadId: string) => window.desktopAgent.resetThread(threadId),
  archiveThread: (threadId: string, archived: boolean) =>
    window.desktopAgent.archiveThread(threadId, archived),
  deleteThread: (threadId: string) => window.desktopAgent.deleteThread(threadId),
  sendMessage: (payload: Parameters<typeof window.desktopAgent.sendMessage>[0]) =>
    window.desktopAgent.sendMessage(payload),
  listKnowledgeBases: () => window.desktopAgent.listKnowledgeBases(),
  createKnowledgeBase: (payload: Parameters<typeof window.desktopAgent.createKnowledgeBase>[0]) =>
    window.desktopAgent.createKnowledgeBase(payload),
  deleteKnowledgeBase: (baseId: string) => window.desktopAgent.deleteKnowledgeBase(baseId),
  addKnowledgeFiles: (payload: Parameters<typeof window.desktopAgent.addKnowledgeFiles>[0]) =>
    window.desktopAgent.addKnowledgeFiles(payload),
  addKnowledgeNote: (payload: Parameters<typeof window.desktopAgent.addKnowledgeNote>[0]) =>
    window.desktopAgent.addKnowledgeNote(payload),
  searchKnowledgeBases: (payload: Parameters<typeof window.desktopAgent.searchKnowledgeBases>[0]) =>
    window.desktopAgent.searchKnowledgeBases(payload),
  runSkill: (payload: Parameters<typeof window.desktopAgent.runSkill>[0]) =>
    window.desktopAgent.runSkill(payload),
  uninstallSkill: (skillId: string) => window.desktopAgent.uninstallSkill(skillId),
  updateConfig: (patch: Parameters<typeof window.desktopAgent.updateConfig>[0]) =>
    window.desktopAgent.updateConfig(patch),
  fetchProviderModels: (payload: Parameters<typeof window.desktopAgent.fetchProviderModels>[0]) =>
    window.desktopAgent.fetchProviderModels(payload),
  inspectMcpServer: (payload: Parameters<typeof window.desktopAgent.inspectMcpServer>[0]) =>
    window.desktopAgent.inspectMcpServer(payload),
  debugMcpTool: (payload: Parameters<typeof window.desktopAgent.debugMcpTool>[0]) =>
    window.desktopAgent.debugMcpTool(payload),
  listTools: () => window.desktopAgent.listTools(),
  selectFiles: () => window.desktopAgent.selectFiles(),
  selectWorkspaceFolder: () => window.desktopAgent.selectWorkspaceFolder(),
  setThreadWorkspace: (threadId: string, workspaceRoot: string) =>
    window.desktopAgent.setThreadWorkspace(threadId, workspaceRoot),
  readPreview: (payload: Parameters<typeof window.desktopAgent.readPreview>[0]) =>
    window.desktopAgent.readPreview(payload),
  openWorkspaceFolder: (threadId?: string) => window.desktopAgent.openWorkspaceFolder(threadId),
  onWorkspaceChanged: (listener: Parameters<typeof window.desktopAgent.onWorkspaceChanged>[0]) =>
    window.desktopAgent.onWorkspaceChanged(listener),
};
