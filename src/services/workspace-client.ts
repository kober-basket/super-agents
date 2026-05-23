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
  exportConversation: (payload: Parameters<typeof desktopAgent.exportConversation>[0]) =>
    desktopAgent.exportConversation(payload),
  listKnowledgeBases: () => desktopAgent.listKnowledgeBases(),
  createKnowledgeBase: (payload: Parameters<typeof desktopAgent.createKnowledgeBase>[0]) =>
    desktopAgent.createKnowledgeBase(payload),
  updateKnowledgeBase: (payload: Parameters<typeof desktopAgent.updateKnowledgeBase>[0]) =>
    desktopAgent.updateKnowledgeBase(payload),
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
  listMemories: () => desktopAgent.listMemories(),
  createMemory: (payload: Parameters<typeof desktopAgent.createMemory>[0]) =>
    desktopAgent.createMemory(payload),
  updateMemory: (payload: Parameters<typeof desktopAgent.updateMemory>[0]) =>
    desktopAgent.updateMemory(payload),
  deleteMemory: (memoryId: string) => desktopAgent.deleteMemory(memoryId),
  searchMemories: (payload: Parameters<typeof desktopAgent.searchMemories>[0]) =>
    desktopAgent.searchMemories(payload),
  inferMailSetup: (email: string) => desktopAgent.inferMailSetup(email),
  listMailAccounts: () => desktopAgent.listMailAccounts(),
  createMailAccount: (payload: Parameters<typeof desktopAgent.createMailAccount>[0]) =>
    desktopAgent.createMailAccount(payload),
  saveMailPasswordCredentials: (payload: Parameters<typeof desktopAgent.saveMailPasswordCredentials>[0]) =>
    desktopAgent.saveMailPasswordCredentials(payload),
  saveMailOAuthCredentials: (payload: Parameters<typeof desktopAgent.saveMailOAuthCredentials>[0]) =>
    desktopAgent.saveMailOAuthCredentials(payload),
  createMailOAuthAuthorization: (payload: Parameters<typeof desktopAgent.createMailOAuthAuthorization>[0]) =>
    desktopAgent.createMailOAuthAuthorization(payload),
  exchangeMailOAuthCode: (payload: Parameters<typeof desktopAgent.exchangeMailOAuthCode>[0]) =>
    desktopAgent.exchangeMailOAuthCode(payload),
  disconnectMailAccount: (accountId: string) => desktopAgent.disconnectMailAccount(accountId),
  removeMailAccount: (accountId: string) => desktopAgent.removeMailAccount(accountId),
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
  markBrowserPageActive: (webContentsId: number) => desktopAgent.markBrowserPageActive(webContentsId),
  listTools: () => desktopAgent.listTools(),
  selectFiles: () => desktopAgent.selectFiles(),
  prepareAttachments: (filePaths: string[]) => desktopAgent.prepareAttachments(filePaths),
  selectWorkspaceFolder: () => desktopAgent.selectWorkspaceFolder(),
  listWorkspaceDirectory: (payload?: Parameters<typeof desktopAgent.listWorkspaceDirectory>[0]) =>
    desktopAgent.listWorkspaceDirectory(payload),
  readPreview: (payload: Parameters<typeof desktopAgent.readPreview>[0]) =>
    desktopAgent.readPreview(payload),
  runTerminalCommand: (payload: Parameters<typeof desktopAgent.runTerminalCommand>[0]) =>
    desktopAgent.runTerminalCommand(payload),
  createTerminalSession: (payload: Parameters<typeof desktopAgent.createTerminalSession>[0]) =>
    desktopAgent.createTerminalSession(payload),
  writeTerminalInput: (payload: Parameters<typeof desktopAgent.writeTerminalInput>[0]) =>
    desktopAgent.writeTerminalInput(payload),
  resizeTerminalSession: (payload: Parameters<typeof desktopAgent.resizeTerminalSession>[0]) =>
    desktopAgent.resizeTerminalSession(payload),
  clearTerminalSession: (terminalId: string) => desktopAgent.clearTerminalSession(terminalId),
  stopTerminalSession: (terminalId: string) => desktopAgent.stopTerminalSession(terminalId),
  restartTerminalSession: (terminalId: string) => desktopAgent.restartTerminalSession(terminalId),
  releaseTerminalSession: (terminalId: string) => desktopAgent.releaseTerminalSession(terminalId),
  openPreviewTarget: (payload: Parameters<typeof desktopAgent.openPreviewTarget>[0]) =>
    desktopAgent.openPreviewTarget(payload),
  writeClipboardText: (text: string) => desktopAgent.writeClipboardText(text),
  openWorkspaceFolder: () => desktopAgent.openWorkspaceFolder(),
  openFolder: (targetPath: string) => desktopAgent.openFolder(targetPath),
  getWindowState: () => desktopAgent.getWindowState(),
  minimizeWindow: () => desktopAgent.minimizeWindow(),
  toggleMaximizeWindow: () => desktopAgent.toggleMaximizeWindow(),
  closeWindow: () => desktopAgent.closeWindow(),
  respondToApproval: (payload: Parameters<typeof desktopAgent.respondToApproval>[0]) =>
    desktopAgent.respondToApproval(payload),
  onWorkspaceChanged: (listener: Parameters<typeof desktopAgent.onWorkspaceChanged>[0]) =>
    desktopAgent.onWorkspaceChanged(listener),
  onWindowStateChanged: (listener: Parameters<typeof desktopAgent.onWindowStateChanged>[0]) =>
    desktopAgent.onWindowStateChanged(listener),
  onChatEvent: (listener: Parameters<typeof desktopAgent.onChatEvent>[0]) =>
    desktopAgent.onChatEvent(listener),
  onApprovalRequest: (listener: Parameters<typeof desktopAgent.onApprovalRequest>[0]) =>
    desktopAgent.onApprovalRequest(listener),
  onBrowserWindowOpen: (listener: Parameters<typeof desktopAgent.onBrowserWindowOpen>[0]) =>
    desktopAgent.onBrowserWindowOpen(listener),
  onTerminalEvent: (listener: Parameters<typeof desktopAgent.onTerminalEvent>[0]) =>
    desktopAgent.onTerminalEvent(listener),
};
