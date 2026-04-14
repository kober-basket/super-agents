export const workspaceClient = {
  bootstrap: () => window.desktopAgent.bootstrap(),
  sendMessage: (payload: Parameters<typeof window.desktopAgent.sendMessage>[0]) =>
    window.desktopAgent.sendMessage(payload),
  selectCurrentChatSession: (sessionId: string) => window.desktopAgent.selectCurrentChatSession(sessionId),
  resetCurrentChat: () => window.desktopAgent.resetCurrentChat(),
  archiveChatSession: (sessionId: string) => window.desktopAgent.archiveChatSession(sessionId),
  unarchiveChatSession: (sessionId: string) => window.desktopAgent.unarchiveChatSession(sessionId),
  deleteChatSession: (sessionId: string) => window.desktopAgent.deleteChatSession(sessionId),
  abortCurrentChat: () => window.desktopAgent.abortCurrentChat(),
  listKnowledgeBases: () => window.desktopAgent.listKnowledgeBases(),
  createKnowledgeBase: (payload: Parameters<typeof window.desktopAgent.createKnowledgeBase>[0]) =>
    window.desktopAgent.createKnowledgeBase(payload),
  deleteKnowledgeBase: (baseId: string) => window.desktopAgent.deleteKnowledgeBase(baseId),
  addKnowledgeFiles: (payload: Parameters<typeof window.desktopAgent.addKnowledgeFiles>[0]) =>
    window.desktopAgent.addKnowledgeFiles(payload),
  addKnowledgeDirectory: (payload: Parameters<typeof window.desktopAgent.addKnowledgeDirectory>[0]) =>
    window.desktopAgent.addKnowledgeDirectory(payload),
  addKnowledgeNote: (payload: Parameters<typeof window.desktopAgent.addKnowledgeNote>[0]) =>
    window.desktopAgent.addKnowledgeNote(payload),
  addKnowledgeUrl: (payload: Parameters<typeof window.desktopAgent.addKnowledgeUrl>[0]) =>
    window.desktopAgent.addKnowledgeUrl(payload),
  addKnowledgeWebsite: (payload: Parameters<typeof window.desktopAgent.addKnowledgeWebsite>[0]) =>
    window.desktopAgent.addKnowledgeWebsite(payload),
  deleteKnowledgeItem: (payload: Parameters<typeof window.desktopAgent.deleteKnowledgeItem>[0]) =>
    window.desktopAgent.deleteKnowledgeItem(payload),
  searchKnowledgeBases: (payload: Parameters<typeof window.desktopAgent.searchKnowledgeBases>[0]) =>
    window.desktopAgent.searchKnowledgeBases(payload),
  uninstallSkill: (skillId: string) => window.desktopAgent.uninstallSkill(skillId),
  updateConfig: (patch: Parameters<typeof window.desktopAgent.updateConfig>[0]) =>
    window.desktopAgent.updateConfig(patch),
  getRemoteControlStatus: () => window.desktopAgent.getRemoteControlStatus(),
  startWechatLogin: () => window.desktopAgent.startWechatLogin(),
  waitWechatLogin: (payload: Parameters<typeof window.desktopAgent.waitWechatLogin>[0]) =>
    window.desktopAgent.waitWechatLogin(payload),
  disconnectWechat: () => window.desktopAgent.disconnectWechat(),
  fetchProviderModels: (payload: Parameters<typeof window.desktopAgent.fetchProviderModels>[0]) =>
    window.desktopAgent.fetchProviderModels(payload),
  inspectMcpServer: (payload: Parameters<typeof window.desktopAgent.inspectMcpServer>[0]) =>
    window.desktopAgent.inspectMcpServer(payload),
  debugMcpTool: (payload: Parameters<typeof window.desktopAgent.debugMcpTool>[0]) =>
    window.desktopAgent.debugMcpTool(payload),
  listTools: () => window.desktopAgent.listTools(),
  selectFiles: () => window.desktopAgent.selectFiles(),
  prepareAttachments: (filePaths: string[]) => window.desktopAgent.prepareAttachments(filePaths),
  selectWorkspaceFolder: () => window.desktopAgent.selectWorkspaceFolder(),
  readPreview: (payload: Parameters<typeof window.desktopAgent.readPreview>[0]) =>
    window.desktopAgent.readPreview(payload),
  openPreviewTarget: (payload: Parameters<typeof window.desktopAgent.openPreviewTarget>[0]) =>
    window.desktopAgent.openPreviewTarget(payload),
  openWorkspaceFolder: () => window.desktopAgent.openWorkspaceFolder(),
  openFolder: (targetPath: string) => window.desktopAgent.openFolder(targetPath),
  getWindowState: () => window.desktopAgent.getWindowState(),
  minimizeWindow: () => window.desktopAgent.minimizeWindow(),
  toggleMaximizeWindow: () => window.desktopAgent.toggleMaximizeWindow(),
  closeWindow: () => window.desktopAgent.closeWindow(),
  onWorkspaceChanged: (listener: Parameters<typeof window.desktopAgent.onWorkspaceChanged>[0]) =>
    window.desktopAgent.onWorkspaceChanged(listener),
  onWindowStateChanged: (listener: Parameters<typeof window.desktopAgent.onWindowStateChanged>[0]) =>
    window.desktopAgent.onWindowStateChanged(listener),
};
