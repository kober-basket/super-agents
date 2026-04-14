import { useEffect, useMemo, useRef, useState } from "react";

import { getActiveModelOption, getSelectableModels } from "../../lib/model-config";
import { workspaceClient } from "../../services/workspace-client";
import type {
  AppConfig,
  BootstrapPayload,
  ChatSessionSummary,
  CurrentChatState,
  FileDropEntry,
  McpServerStatus,
  RuntimeSkill,
  SkillConfig,
} from "../../types";
import { sanitizeMcpName } from "../shared/utils";
import { DEFAULT_CHAT_TITLE, NO_WORKSPACE_SELECTED_LABEL, workspaceLabel } from "./labels";

interface UseWorkspaceControllerOptions {
  onOpenChat: () => void;
  onToast: (message: string) => void;
}

const EMPTY_CONFIG: AppConfig = {
  workspaceRoot: "",
  bridgeUrl: "",
  environment: "local",
  defaultAgentMode: "general",
  activeModelId: "",
  contextTier: "high",
  appearance: {
    theme: "linen",
  },
  proxy: {
    http: "",
    https: "",
    bypass: "localhost,127.0.0.1",
  },
  modelProviders: [],
  mcpServers: [],
  skills: [],
  hiddenCodexSkillIds: [],
  knowledgeBase: {
    enabled: false,
    embeddingProviderId: "",
    embeddingModel: "",
    selectedBaseIds: [],
    documentCount: 5,
    chunkSize: 1200,
    chunkOverlap: 160,
  },
  remoteControl: {
    dingtalk: {
      enabled: false,
      clientId: "",
      clientSecret: "",
    },
    feishu: {
      enabled: false,
      appId: "",
      appSecret: "",
      domain: "feishu",
    },
    wechat: {
      enabled: false,
      baseUrl: "",
      cdnBaseUrl: "",
      botToken: "",
      accountId: "",
      userId: "",
      connectedAt: null,
    },
    wecom: {
      enabled: false,
      botId: "",
      secret: "",
      websocketUrl: "",
    },
  },
};

const EMPTY_CURRENT_CHAT: CurrentChatState = {
  sessionId: null,
  title: DEFAULT_CHAT_TITLE,
  messages: [],
  busy: false,
  blockedOnQuestion: false,
  workspaceRoot: undefined,
};

function cloneConfig(config: AppConfig) {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

function buildSkillPrompt(name: string, description: string | undefined, prompt: string) {
  return [
    `请使用 "${name}" 技能继续处理下面的请求。`,
    prompt.trim() || description || "请根据该技能的说明继续。",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function isAbsoluteAttachmentPath(value: string) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value);
}

export function useWorkspaceController({ onOpenChat, onToast }: UseWorkspaceControllerOptions) {
  const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG);
  const [currentChat, setCurrentChat] = useState<CurrentChatState>(EMPTY_CURRENT_CHAT);
  const [chatSessions, setChatSessions] = useState<ChatSessionSummary[]>([]);
  const [availableSkills, setAvailableSkills] = useState<RuntimeSkill[]>([]);
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [composer, setComposer] = useState("");
  const [composerComposing, setComposerComposing] = useState(false);
  const [attachments, setAttachments] = useState<FileDropEntry[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const pendingConfigSaveRef = useRef<number | null>(null);

  const selectableModels = useMemo(() => getSelectableModels(config.modelProviders), [config.modelProviders]);
  const activeModel = useMemo(
    () => getActiveModelOption(config.modelProviders, config.activeModelId),
    [config.activeModelId, config.modelProviders],
  );
  const composerModelId = activeModel?.id ?? config.activeModelId;
  const currentWorkspacePath = config.workspaceRoot.trim() || NO_WORKSPACE_SELECTED_LABEL;
  const currentWorkspaceLabel = workspaceLabel(currentWorkspacePath);
  const chatBusy = currentChat.busy || currentChat.blockedOnQuestion;
  const mcpStatusMap = useMemo(
    () =>
      mcpStatuses.reduce<Record<string, McpServerStatus>>((result, status) => {
        result[sanitizeMcpName(status.name)] = status;
        return result;
      }, {}),
    [mcpStatuses],
  );

  async function applyBootstrapPayload(payload: BootstrapPayload) {
    setConfig(payload.config);
    setCurrentChat(payload.currentChat ?? EMPTY_CURRENT_CHAT);
    setChatSessions(payload.chatSessions ?? []);
    setAvailableSkills(payload.availableSkills ?? []);
    setMcpStatuses(payload.mcpStatuses ?? []);
    setBootstrapped(true);
  }

  async function refreshWorkspaceSnapshot(message?: string, options?: { silent?: boolean }) {
    try {
      const payload = await workspaceClient.bootstrap();
      await applyBootstrapPayload(payload);
      if (message && !options?.silent) {
        onToast(message);
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : "刷新工作区失败");
    }
  }

  async function commitConfig(nextConfig: AppConfig, message?: string) {
    try {
      const payload = await workspaceClient.updateConfig(nextConfig);
      await applyBootstrapPayload(payload);
      if (message) {
        onToast(message);
      }
    } catch (error) {
      onToast(error instanceof Error ? error.message : "保存设置失败");
    }
  }

  function scheduleConfigPersist(nextConfig: AppConfig) {
    if (pendingConfigSaveRef.current) {
      window.clearTimeout(pendingConfigSaveRef.current);
    }

    pendingConfigSaveRef.current = window.setTimeout(() => {
      pendingConfigSaveRef.current = null;
      void commitConfig(nextConfig);
    }, 240);
  }

  function updateConfigField<K extends keyof AppConfig>(field: K, value: AppConfig[K]) {
    void commitConfig(
      {
        ...cloneConfig(config),
        [field]: value,
      },
      "设置已保存",
    );
  }

  async function appendAttachments(files: FileDropEntry[]) {
    try {
      const passthrough = files.filter(
        (file) => file.content || file.dataUrl || file.url || !isAbsoluteAttachmentPath(file.path),
      );
      const pendingPaths = files
        .filter((file) => !file.content && !file.dataUrl && !file.url && isAbsoluteAttachmentPath(file.path))
        .map((file) => file.path);
      const prepared = pendingPaths.length > 0 ? await workspaceClient.prepareAttachments(pendingPaths) : [];
      setAttachments((current) => [...current, ...passthrough, ...prepared]);
    } catch {
      onToast("读取文件失败");
    }
  }

  async function pickFiles() {
    try {
      const files = await workspaceClient.selectFiles();
      if (files.length > 0) {
        await appendAttachments(files);
      }
    } catch {
      onToast("读取文件失败");
    }
  }

  function removeAttachment(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }

  function prepareSkillDraft(name?: string, description?: string) {
    const nextPrompt = [
      name ? `帮我创建一个名为 "${name}" 的新技能。` : "帮我创建一个新技能。",
      description ? `目标：${description}` : "目标：明确用途、输入输出、目录结构，以及第一版实现。",
      "请给我一份可以直接实施的计划。",
    ]
      .filter(Boolean)
      .join("\n");
    setComposer(nextPrompt);
    onOpenChat();
    onToast("已生成技能草稿");
  }

  function useReferenceSkill(skill: RuntimeSkill) {
    setComposer(buildSkillPrompt(skill.name, skill.description, composer.trim()));
    onOpenChat();
    onToast(`已载入技能：${skill.name}`);
  }

  async function uninstallSkill(skill: SkillConfig) {
    try {
      const payload = await workspaceClient.uninstallSkill(skill.id);
      await applyBootstrapPayload(payload);
      onToast(`已移除技能：${skill.name}`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "移除技能失败");
    }
  }

  async function openWorkspaceFolder() {
    try {
      await workspaceClient.openWorkspaceFolder();
    } catch {
      onToast("打开工作区失败");
    }
  }

  async function sendCurrentMessage() {
    const message = composer.trim();
    if (!message && attachments.length === 0) {
      return;
    }

    try {
      const result = await workspaceClient.sendMessage({
        message,
        attachments,
      });
      setCurrentChat(result.currentChat);
      setComposer("");
      setAttachments([]);
      setDragActive(false);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "发送消息失败");
    }
  }

  async function resetCurrentChat() {
    setCurrentChat(EMPTY_CURRENT_CHAT);
    setComposer("");
    setAttachments([]);
    setDragActive(false);

    try {
      const payload = await workspaceClient.resetCurrentChat();
      await applyBootstrapPayload(payload);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "开始新会话失败");
      await refreshWorkspaceSnapshot(undefined, { silent: true });
    }
  }

  async function selectCurrentChatSession(sessionId: string) {
    try {
      const payload = await workspaceClient.selectCurrentChatSession(sessionId);
      await applyBootstrapPayload(payload);
      onOpenChat();
    } catch (error) {
      onToast(error instanceof Error ? error.message : "切换会话失败");
    }
  }

  async function abortCurrentChat() {
    try {
      const payload = await workspaceClient.abortCurrentChat();
      await applyBootstrapPayload(payload);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "停止当前会话失败");
    }
  }

  async function archiveChatSession(sessionId: string) {
    try {
      const payload = await workspaceClient.archiveChatSession(sessionId);
      await applyBootstrapPayload(payload);
      onToast("会话已归档");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "归档会话失败");
    }
  }

  async function unarchiveChatSession(sessionId: string) {
    try {
      const payload = await workspaceClient.unarchiveChatSession(sessionId);
      await applyBootstrapPayload(payload);
      onToast("会话已恢复");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "恢复会话失败");
    }
  }

  async function deleteChatSession(sessionId: string) {
    try {
      const payload = await workspaceClient.deleteChatSession(sessionId);
      await applyBootstrapPayload(payload);
      onToast("会话已删除");
    } catch (error) {
      onToast(error instanceof Error ? error.message : "删除会话失败");
    }
  }

  useEffect(() => {
    let mounted = true;
    const unsubscribe = workspaceClient.onWorkspaceChanged((payload) => {
      if (!mounted) return;
      void applyBootstrapPayload(payload);
    });

    void refreshWorkspaceSnapshot(undefined, { silent: true });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const target = messageListRef.current;
    if (!target) return;
    target.scrollTop = target.scrollHeight;
  }, [currentChat.messages, currentChat.busy, currentChat.blockedOnQuestion]);

  return {
    activeModel,
    appendAttachments,
    attachments,
    availableSkills,
    bootstrapped,
    chatBusy,
    chatSessions,
    commitConfig,
    composer,
    composerComposing,
    composerModelId,
    config,
    currentChat,
    currentWorkspaceLabel,
    currentWorkspacePath,
    dragActive,
    mcpStatusMap,
    mcpStatuses,
    messageListRef,
    abortCurrentChat,
    archiveChatSession,
    deleteChatSession,
    openWorkspaceFolder,
    pickFiles,
    prepareSkillDraft,
    refreshWorkspaceSnapshot,
    removeAttachment,
    resetCurrentChat,
    scheduleConfigPersist,
    selectCurrentChatSession,
    selectableModels,
    sendCurrentMessage,
    setAttachments,
    setComposer,
    setComposerComposing,
    setDragActive,
    uninstallSkill,
    unarchiveChatSession,
    updateConfigField,
    useReferenceSkill,
  };
}
