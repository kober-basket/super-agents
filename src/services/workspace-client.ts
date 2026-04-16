import { createBrowserDesktopAgent } from "./browser-desktop-agent";

const desktopAgent = window.desktopAgent ?? createBrowserDesktopAgent();

export const workspaceClient = {
  bootstrap: () => desktopAgent.bootstrap(),
  listConversations: () => desktopAgent.listConversations(),
  getConversation: (conversationId: string) => desktopAgent.getConversation(conversationId),
  startChatTurn: (payload: Parameters<typeof desktopAgent.startChatTurn>[0]) =>
    desktopAgent.startChatTurn(payload),
  cancelChatTurn: (conversationId: string) => desktopAgent.cancelChatTurn(conversationId),
  sendChatMessage: (payload: Parameters<typeof desktopAgent.sendChatMessage>[0]) =>
    desktopAgent.sendChatMessage(payload),
  deleteConversation: (conversationId: string) => desktopAgent.deleteConversation(conversationId),
  listKnowledgeBases: () => desktopAgent.listKnowledgeBases(),
  createKnowledgeBase: (payload: Parameters<typeof desktopAgent.createKnowledgeBase>[0]) =>
    desktopAgent.createKnowledgeBase(payload),
  deleteKnowledgeBase: (baseId: string) => desktopAgent.deleteKnowledgeBase(baseId),
  addKnowledgeFiles: (payload: Parameters<typeof desktopAgent.addKnowledgeFiles>[0]) =>
    desktopAgent.addKnowledgeFiles(payload),
  addKnowledgeDirectory: (payload: Parameters<typeof desktopAgent.addKnowledgeDirectory>[0]) =>
    desktopAgent.addKnowledgeDirectory(payload),
  addKnowledgeNote: (payload: Parameters<typeof desktopAgent.addKnowledgeNote>[0]) =>
    desktopAgent.addKnowledgeNote(payload),
  addKnowledgeUrl: (payload: Parameters<typeof desktopAgent.addKnowledgeUrl>[0]) =>
    desktopAgent.addKnowledgeUrl(payload),
  addKnowledgeWebsite: (payload: Parameters<typeof desktopAgent.addKnowledgeWebsite>[0]) =>
    desktopAgent.addKnowledgeWebsite(payload),
  deleteKnowledgeItem: (payload: Parameters<typeof desktopAgent.deleteKnowledgeItem>[0]) =>
    desktopAgent.deleteKnowledgeItem(payload),
  searchKnowledgeBases: (payload: Parameters<typeof desktopAgent.searchKnowledgeBases>[0]) =>
    desktopAgent.searchKnowledgeBases(payload),
  generateProjectReport: (payload: Parameters<typeof desktopAgent.generateProjectReport>[0]) =>
    desktopAgent.generateProjectReport(payload),
  generateEmergencyPlan: (payload: Parameters<typeof desktopAgent.generateEmergencyPlan>[0]) =>
    desktopAgent.generateEmergencyPlan(payload),
  selectSkillFolder: () => desktopAgent.selectSkillFolder(),
  importLocalSkill: (sourcePath: string) => desktopAgent.importLocalSkill(sourcePath),
  uninstallSkill: (skillId: string) => desktopAgent.uninstallSkill(skillId),
  updateConfig: (patch: Parameters<typeof desktopAgent.updateConfig>[0]) =>
    desktopAgent.updateConfig(patch),
  getRemoteControlStatus: () => desktopAgent.getRemoteControlStatus(),
  startWechatLogin: () => desktopAgent.startWechatLogin(),
  waitWechatLogin: (payload: Parameters<typeof desktopAgent.waitWechatLogin>[0]) =>
    desktopAgent.waitWechatLogin(payload),
  disconnectWechat: () => desktopAgent.disconnectWechat(),
  fetchProviderModels: (payload: Parameters<typeof desktopAgent.fetchProviderModels>[0]) =>
    desktopAgent.fetchProviderModels(payload),
  transcribeAudio: (payload: Parameters<typeof desktopAgent.transcribeAudio>[0]) =>
    desktopAgent.transcribeAudio(payload),
  inspectMcpServer: (payload: Parameters<typeof desktopAgent.inspectMcpServer>[0]) =>
    desktopAgent.inspectMcpServer(payload),
  debugMcpTool: (payload: Parameters<typeof desktopAgent.debugMcpTool>[0]) =>
    desktopAgent.debugMcpTool(payload),
  listTools: () => desktopAgent.listTools(),
  selectFiles: () => desktopAgent.selectFiles(),
  prepareAttachments: (filePaths: string[]) => desktopAgent.prepareAttachments(filePaths),
  selectWorkspaceFolder: () => desktopAgent.selectWorkspaceFolder(),
  readPreview: (payload: Parameters<typeof desktopAgent.readPreview>[0]) =>
    desktopAgent.readPreview(payload),
  openPreviewTarget: (payload: Parameters<typeof desktopAgent.openPreviewTarget>[0]) =>
    desktopAgent.openPreviewTarget(payload),
  openWorkspaceFolder: () => desktopAgent.openWorkspaceFolder(),
  openFolder: (targetPath: string) => desktopAgent.openFolder(targetPath),
  getWindowState: () => desktopAgent.getWindowState(),
  minimizeWindow: () => desktopAgent.minimizeWindow(),
  toggleMaximizeWindow: () => desktopAgent.toggleMaximizeWindow(),
  closeWindow: () => desktopAgent.closeWindow(),
  onWorkspaceChanged: (listener: Parameters<typeof desktopAgent.onWorkspaceChanged>[0]) =>
    desktopAgent.onWorkspaceChanged(listener),
  onWindowStateChanged: (listener: Parameters<typeof desktopAgent.onWindowStateChanged>[0]) =>
    desktopAgent.onWindowStateChanged(listener),
  onChatEvent: (listener: Parameters<typeof desktopAgent.onChatEvent>[0]) =>
    desktopAgent.onChatEvent(listener),
};
