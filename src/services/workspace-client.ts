export const workspaceClient = {
  bootstrap: () => window.desktopAgent.bootstrap(),
  listConversations: () => window.desktopAgent.listConversations(),
  getConversation: (conversationId: string) => window.desktopAgent.getConversation(conversationId),
  startChatTurn: (payload: Parameters<typeof window.desktopAgent.startChatTurn>[0]) =>
    window.desktopAgent.startChatTurn(payload),
  cancelChatTurn: (conversationId: string) => window.desktopAgent.cancelChatTurn(conversationId),
  sendChatMessage: (payload: Parameters<typeof window.desktopAgent.sendChatMessage>[0]) =>
    window.desktopAgent.sendChatMessage(payload),
  deleteConversation: (conversationId: string) => window.desktopAgent.deleteConversation(conversationId),
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
  generateProjectReport: (payload: Parameters<typeof window.desktopAgent.generateProjectReport>[0]) =>
    window.desktopAgent.generateProjectReport(payload),
  generateEmergencyPlan: (payload: Parameters<typeof window.desktopAgent.generateEmergencyPlan>[0]) =>
    window.desktopAgent.generateEmergencyPlan(payload),
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
  transcribeAudio: (payload: Parameters<typeof window.desktopAgent.transcribeAudio>[0]) =>
    window.desktopAgent.transcribeAudio(payload),
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
  onChatEvent: (listener: Parameters<typeof window.desktopAgent.onChatEvent>[0]) =>
    window.desktopAgent.onChatEvent(listener),
};
