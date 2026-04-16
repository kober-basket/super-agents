import { useEffect, useMemo, useRef, useState } from "react";

import { getActiveModelOption, getSelectableModels } from "../../lib/model-config";
import { workspaceClient } from "../../services/workspace-client";
import type { AppConfig, BootstrapPayload, FileDropEntry, McpServerStatus, RuntimeSkill, SkillConfig } from "../../types";
import { sanitizeMcpName } from "../shared/utils";
import { NO_WORKSPACE_SELECTED_LABEL, workspaceLabel } from "./labels";

interface UseWorkspaceControllerOptions {
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

function cloneConfig(config: AppConfig) {
  return JSON.parse(JSON.stringify(config)) as AppConfig;
}

function isAbsoluteAttachmentPath(value: string) {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value);
}

export function useWorkspaceController({ onToast }: UseWorkspaceControllerOptions) {
  const [config, setConfig] = useState<AppConfig>(EMPTY_CONFIG);
  const [availableSkills, setAvailableSkills] = useState<RuntimeSkill[]>([]);
  const [mcpStatuses, setMcpStatuses] = useState<McpServerStatus[]>([]);
  const [attachments, setAttachments] = useState<FileDropEntry[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const [bootstrapped, setBootstrapped] = useState(false);
  const [skillImporting, setSkillImporting] = useState(false);
  const pendingConfigSaveRef = useRef<number | null>(null);

  const selectableModels = useMemo(() => getSelectableModels(config.modelProviders), [config.modelProviders]);
  const activeModel = useMemo(
    () => getActiveModelOption(config.modelProviders, config.activeModelId),
    [config.activeModelId, config.modelProviders],
  );
  const composerModelId = activeModel?.id ?? config.activeModelId;
  const currentWorkspacePath = config.workspaceRoot.trim() || NO_WORKSPACE_SELECTED_LABEL;
  const currentWorkspaceLabel = workspaceLabel(currentWorkspacePath);
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
    const skillName = name?.trim() || "新技能";
    const detail = description?.trim() || "明确用途、输入输出、目录结构，以及第一版实现。";
    onToast(`已为 ${skillName} 准备技能草稿：${detail}`);
  }

  function useReferenceSkill(skill: RuntimeSkill) {
    onToast(`已载入技能：${skill.name}`);
  }

  async function importLocalSkill() {
    try {
      const folderPath = await workspaceClient.selectSkillFolder();
      if (!folderPath) {
        return;
      }

      setSkillImporting(true);
      const result = await workspaceClient.importLocalSkill(folderPath);
      await applyBootstrapPayload(result.bootstrap);
      onToast(`已导入技能：${result.importedSkillName}`);
    } catch (error) {
      onToast(error instanceof Error ? error.message : "导入本地技能失败");
    } finally {
      setSkillImporting(false);
    }
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

  return {
    activeModel,
    appendAttachments,
    attachments,
    availableSkills,
    bootstrapped,
    commitConfig,
    composerModelId,
    config,
    currentWorkspaceLabel,
    currentWorkspacePath,
    dragActive,
    skillImporting,
    mcpStatusMap,
    mcpStatuses,
    openWorkspaceFolder,
    pickFiles,
    prepareSkillDraft,
    refreshWorkspaceSnapshot,
    removeAttachment,
    scheduleConfigPersist,
    selectableModels,
    setAttachments,
    setDragActive,
    importLocalSkill,
    uninstallSkill,
    updateConfigField,
    useReferenceSkill,
  };
}
