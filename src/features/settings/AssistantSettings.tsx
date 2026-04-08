import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  Brain,
  ChevronDown,
  Eye,
  Globe,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";

import { compareModelGroupNames, enrichProviderModel } from "../../lib/model-metadata";
import type { ModelProviderConfig, RuntimeModelOption } from "../../types";
import { ProviderModelPickerModal } from "./ProviderModelPickerModal";

interface AssistantSettingsProps {
  activeModel: RuntimeModelOption | null;
  composerModelId: string;
  modelProviders: ModelProviderConfig[];
  providerRefreshingId: string | null;
  selectedModelProviderId: string;
  selectableModels: RuntimeModelOption[];
  onAddModelProvider: () => void;
  onModelChange: (modelId: string) => void;
  onRefreshProviderModels: (providerId: string) => void | Promise<void>;
  onRemoveModelProvider: (providerId: string) => void;
  onSelectProvider: (providerId: string) => void;
  onSetProviderModelsEnabled: (providerId: string, modelIds: string[], enabled: boolean) => void;
  onSetDefaultProviderModel: (providerId: string, modelId: string) => void;
  onToggleProviderModel: (providerId: string, modelId: string) => void;
  onUpdateModelProvider: (providerId: string, patch: Partial<ModelProviderConfig>) => void;
}

type EnrichedProviderModel = ReturnType<typeof enrichProviderModel>;

function tagItems(model: EnrichedProviderModel) {
  return [
    model.capabilities?.vision ? { key: "vision", label: "视觉", icon: Eye } : null,
    model.capabilities?.webSearch ? { key: "webSearch", label: "联网", icon: Globe } : null,
    model.capabilities?.reasoning ? { key: "reasoning", label: "推理", icon: Brain } : null,
    model.capabilities?.tools ? { key: "tools", label: "工具", icon: Wrench } : null,
    model.capabilities?.embedding ? { key: "embedding", label: "嵌入", icon: Sparkles } : null,
    model.capabilities?.rerank ? { key: "rerank", label: "重排", icon: Sparkles } : null,
    model.capabilities?.free ? { key: "free", label: "免费", icon: Sparkles } : null,
  ].filter(Boolean) as Array<{ key: string; label: string; icon: typeof Eye }>;
}

export function AssistantSettings({
  activeModel,
  composerModelId,
  modelProviders,
  providerRefreshingId,
  selectedModelProviderId,
  selectableModels,
  onAddModelProvider,
  onModelChange,
  onRefreshProviderModels,
  onRemoveModelProvider,
  onSelectProvider,
  onSetProviderModelsEnabled,
  onSetDefaultProviderModel,
  onToggleProviderModel,
  onUpdateModelProvider,
}: AssistantSettingsProps) {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);

  const totalModelCount = modelProviders.reduce((sum, provider) => sum + provider.models.length, 0);
  const enabledModelCount = modelProviders.reduce(
    (sum, provider) => sum + provider.models.filter((model) => model.enabled !== false).length,
    0,
  );
  const currentProvider =
    modelProviders.find((provider) => provider.id === selectedModelProviderId) ??
    modelProviders[0] ??
    null;
  const currentProviderEnabledCount =
    currentProvider?.models.filter((model) => model.enabled !== false).length ?? 0;
  const currentProviderRefreshing = currentProvider
    ? providerRefreshingId === currentProvider.id
    : false;

  const currentProviderModels = useMemo(() => {
    if (!currentProvider) return [];

    return currentProvider.models
      .filter((model) => model.enabled !== false)
      .map((model) => enrichProviderModel(model))
      .sort((left, right) => {
        const leftDefault =
          activeModel?.providerId === currentProvider.id && activeModel.modelId === left.id;
        const rightDefault =
          activeModel?.providerId === currentProvider.id && activeModel.modelId === right.id;

        if (leftDefault !== rightDefault) {
          return Number(rightDefault) - Number(leftDefault);
        }

        return left.label.localeCompare(right.label, "zh-CN");
      });
  }, [activeModel?.modelId, activeModel?.providerId, currentProvider]);

  const currentProviderModelGroups = useMemo(() => {
    const groups = new Map<string, EnrichedProviderModel[]>();

    for (const model of currentProviderModels) {
      const groupName = model.group || model.vendor || "其他";
      const existing = groups.get(groupName) ?? [];
      existing.push(model);
      groups.set(groupName, existing);
    }

    return Array.from(groups.entries())
      .sort((left, right) => compareModelGroupNames(left[0], right[0]))
      .map(([groupName, models]) => [
        groupName,
        models.sort((left, right) => {
          const leftDefault =
            activeModel?.providerId === currentProvider?.id && activeModel.modelId === left.id;
          const rightDefault =
            activeModel?.providerId === currentProvider?.id && activeModel.modelId === right.id;

          if (leftDefault !== rightDefault) {
            return Number(rightDefault) - Number(leftDefault);
          }

          return left.label.localeCompare(right.label, "zh-CN");
        }),
      ] as const);
  }, [activeModel?.modelId, activeModel?.providerId, currentProvider?.id, currentProviderModels]);

  return (
    <section className="settings-stage">
      <header className="settings-stage-header">
        <div>
          <h1>模型配置</h1>
          <p>先添加提供商，再拉取模型列表，最后从弹窗里搜索、加入并设置默认模型。</p>
        </div>
        <button className="secondary-button" onClick={onAddModelProvider}>
          <Plus size={14} />
          添加提供商
        </button>
      </header>

      <div className="settings-stage-grid two">
        <article className="panel-card form-card settings-surface">
          <h3>默认模型</h3>
          <label>
            <span>用于日常对话的模型</span>
            <div className="select-shell field-select full-width">
              <select value={composerModelId} onChange={(event) => onModelChange(event.target.value)}>
                {selectableModels.length > 0 ? (
                  selectableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))
                ) : (
                  <option value="">暂无可选模型</option>
                )}
              </select>
              <ChevronDown size={13} />
            </div>
          </label>
          <p className="field-note">
            当前默认：
            {activeModel ? `${activeModel.providerName} / ${activeModel.modelLabel}` : "请先添加并启用模型"}
          </p>
          <p className="field-note">如果你已经知道要用哪个模型，也可以在弹窗里直接点“设为默认”。</p>
        </article>

        <article className="panel-card form-card settings-surface">
          <h3>当前状态</h3>
          <div className="settings-stats-grid">
            <div className="settings-stat-card">
              <strong>{modelProviders.length}</strong>
              <span>提供商</span>
            </div>
            <div className="settings-stat-card">
              <strong>{totalModelCount}</strong>
              <span>已发现模型</span>
            </div>
            <div className="settings-stat-card">
              <strong>{enabledModelCount}</strong>
              <span>可用模型</span>
            </div>
          </div>
          <p className="field-note">这里尽量做成简单模式，你只需要填名称、接口地址和 API Key。</p>
        </article>
      </div>

      <div className="settings-block">
        <div className="settings-block-head with-action">
          <h3>提供商</h3>
          {currentProvider ? (
            <button
              className="ghost-text-button"
              onClick={() => void onRefreshProviderModels(currentProvider.id)}
              disabled={currentProviderRefreshing}
            >
              {currentProviderRefreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              拉取当前提供商模型
            </button>
          ) : null}
        </div>

        {modelProviders.length > 0 ? (
          <div className="provider-workbench">
            <aside className="provider-rail">
              {modelProviders.map((provider) => {
                const enabledCount = provider.models.filter((model) => model.enabled !== false).length;
                const isSelected = currentProvider?.id === provider.id;

                return (
                  <button
                    key={provider.id}
                    className={clsx("provider-nav-card", isSelected && "active")}
                    onClick={() => onSelectProvider(provider.id)}
                  >
                    <div className="split-row">
                      <strong>{provider.name}</strong>
                      <span className={clsx("stack-badge", provider.enabled && "active")}>
                        {provider.enabled ? "启用" : "停用"}
                      </span>
                    </div>
                    <span>OpenAI 兼容 · {enabledCount}/{provider.models.length} 个模型</span>
                    <small>
                      {activeModel?.providerId === provider.id
                        ? "当前默认来源"
                        : provider.baseUrl || "待填写接口地址"}
                    </small>
                  </button>
                );
              })}
            </aside>

            {currentProvider ? (
              <article className="panel-card form-card settings-surface provider-detail-card">
                <div className="provider-detail-head">
                  <div>
                    <h3>{currentProvider.name}</h3>
                    <p className="field-note">
                      OpenAI 兼容 · {currentProviderEnabledCount}/{currentProvider.models.length} 个模型
                    </p>
                  </div>
                  <div className="mcp-card-actions">
                    <button
                      className={clsx("toggle-button", currentProvider.enabled && "active")}
                      onClick={() =>
                        onUpdateModelProvider(currentProvider.id, { enabled: !currentProvider.enabled })
                      }
                    >
                      {currentProvider.enabled ? "已启用" : "未启用"}
                    </button>
                    <button className="ghost-text-button" onClick={() => setModelPickerOpen(true)}>
                      <Settings2 size={14} />
                      管理模型
                    </button>
                    <button
                      className="ghost-text-button danger"
                      onClick={() => onRemoveModelProvider(currentProvider.id)}
                    >
                      <X size={14} />
                      删除
                    </button>
                  </div>
                </div>

                <div className="settings-stage-grid two provider-form-grid">
                  <label>
                    <span>提供商名称</span>
                    <input
                      value={currentProvider.name}
                      onChange={(event) =>
                        onUpdateModelProvider(currentProvider.id, { name: event.target.value })
                      }
                    />
                  </label>

                  <label>
                    <span>接口地址</span>
                    <input
                      value={currentProvider.baseUrl}
                      onChange={(event) =>
                        onUpdateModelProvider(currentProvider.id, { baseUrl: event.target.value })
                      }
                      placeholder="https://api.example.com/v1"
                    />
                  </label>

                  <label className="span-two">
                    <span>API Key</span>
                    <input
                      type="text"
                      value={currentProvider.apiKey}
                      onChange={(event) =>
                        onUpdateModelProvider(currentProvider.id, { apiKey: event.target.value })
                      }
                      placeholder="sk-..."
                    />
                  </label>
                </div>

                <p className="field-note">
                  填好地址和密钥后，先拉取模型列表，再从“管理模型”里按需保留你真正想用的模型。
                </p>

                <div className="provider-models-head">
                  <div>
                    <strong>模型</strong>
                    <span>
                      {currentProviderModelGroups.length > 0
                        ? `当前显示 ${currentProviderModels.length} 个模型，按系列自动分组。`
                        : "还没有模型时，先从弹窗里选择你要显示的模型。"}
                    </span>
                  </div>
                  <button className="secondary-button" onClick={() => setModelPickerOpen(true)}>
                    <Settings2 size={14} />
                    打开模型弹窗
                  </button>
                </div>

                {currentProviderModelGroups.length > 0 ? (
                  <div className="provider-model-list">
                    {currentProviderModelGroups.map(([groupName, models]) => (
                      <section key={groupName} className="model-group">
                        <div className="model-group-head">
                          <div className="model-group-trigger">
                            <div className="model-group-copy">
                              <ChevronDown size={16} className="model-group-arrow" />
                              <strong>{groupName}</strong>
                              <span className="model-group-count">{models.length}</span>
                            </div>
                          </div>
                        </div>

                        <div className="model-group-body">
                          {models.map((model) => {
                            const isDefault =
                              activeModel?.providerId === currentProvider.id &&
                              activeModel.modelId === model.id;
                            const tags = tagItems(model);

                            return (
                              <div
                                key={model.id}
                                className={clsx("model-picker-row", "active", isDefault && "default")}
                              >
                                <div className="model-picker-copy">
                                  <div className="model-picker-title-line">
                                    <strong>{model.label}</strong>
                                    <div className="model-picker-tags">
                                      {tags.map((tag) => {
                                        const Icon = tag.icon;
                                        return (
                                          <span key={tag.key} className={clsx("model-capability-tag", tag.key)}>
                                            <Icon size={12} />
                                            {tag.label}
                                          </span>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  <span>{model.id}</span>
                                  {model.description ? <p>{model.description}</p> : null}
                                </div>

                                <div className="model-picker-actions">
                                  {isDefault ? (
                                    <span className="stack-badge active">默认</span>
                                  ) : (
                                    <button
                                      className="server-row-action"
                                      onClick={() => onSetDefaultProviderModel(currentProvider.id, model.id)}
                                      type="button"
                                    >
                                      设为默认
                                    </button>
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="empty-panel compact provider-empty">
                    <strong>还没有模型</strong>
                    <p>先在“管理模型”里选择要显示的模型。</p>
                  </div>
                )}
              </article>
            ) : null}
          </div>
        ) : (
          <div className="empty-panel spacious">
            <strong>还没有模型提供商</strong>
            <p>先添加一个提供商，填好名称、接口地址和密钥，然后就可以拉取模型列表了。</p>
            <button className="secondary-button" onClick={onAddModelProvider}>
              <Plus size={14} />
              添加提供商
            </button>
          </div>
        )}
      </div>

      <ProviderModelPickerModal
        open={modelPickerOpen}
        provider={currentProvider}
        composerModelId={composerModelId}
        refreshing={currentProviderRefreshing}
        onClose={() => setModelPickerOpen(false)}
        onRefresh={onRefreshProviderModels}
        onToggleModel={onToggleProviderModel}
        onSetModelsEnabled={onSetProviderModelsEnabled}
        onSetDefaultModel={onSetDefaultProviderModel}
      />
    </section>
  );
}
