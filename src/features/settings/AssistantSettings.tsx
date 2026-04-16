import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  Brain,
  Eye,
  Globe,
  GripVertical,
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
  providerRefreshError?: string | null;
  providerRefreshingId: string | null;
  selectedModelProviderId: string;
  selectableModels: RuntimeModelOption[];
  onAddModelProvider: () => void;
  onModelChange: (modelId: string) => void;
  onReorderModelProviders: (providerId: string, targetProviderId: string) => void;
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
  providerRefreshError,
  providerRefreshingId,
  selectedModelProviderId,
  selectableModels,
  onAddModelProvider,
  onModelChange,
  onReorderModelProviders,
  onRefreshProviderModels,
  onRemoveModelProvider,
  onSelectProvider,
  onSetProviderModelsEnabled,
  onSetDefaultProviderModel,
  onToggleProviderModel,
  onUpdateModelProvider,
}: AssistantSettingsProps) {
  const [modelPickerOpen, setModelPickerOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const [draggingProviderId, setDraggingProviderId] = useState<string | null>(null);
  const [dropTargetProviderId, setDropTargetProviderId] = useState<string | null>(null);

  const currentProvider =
    modelProviders.find((provider) => provider.id === selectedModelProviderId) ??
    modelProviders[0] ??
    null;
  const currentProviderRefreshing = currentProvider
    ? providerRefreshingId === currentProvider.id
    : false;

  const currentProviderModels = useMemo(() => {
    if (!currentProvider) return [];

    return currentProvider.models
      .filter((model) => model.enabled !== false)
      .map((model) => enrichProviderModel(model, { providerId: currentProvider.id }))
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
    <section className="settings-stage assistant-settings-stage">
      <header className="settings-stage-header">
        <div className="settings-stage-heading">
          <h1>模型</h1>
          <p className="field-note">统一管理提供商、接口配置和可用模型。</p>
        </div>
        <button className="secondary-button" onClick={onAddModelProvider}>
          <Plus size={14} />
          添加提供商
        </button>
      </header>

      <div className="settings-block">
        {modelProviders.length > 0 ? (
          <div className="provider-workbench">
            <aside className="provider-rail">
              <div className="provider-rail-header">
                <span className="section-kicker muted">提供商</span>
                <p>{modelProviders.length} 个来源，左侧切换，右侧编辑。</p>
              </div>

              {modelProviders.map((provider) => {
                const enabledCount = provider.models.filter((model) => model.enabled !== false).length;
                const isSelected = currentProvider?.id === provider.id;
                const isDragging = draggingProviderId === provider.id;
                const isDropTarget =
                  dropTargetProviderId === provider.id && draggingProviderId !== provider.id;

                return (
                  <div
                    key={provider.id}
                    className={clsx(
                      "provider-nav-card",
                      isSelected && "active",
                      isDragging && "dragging",
                      isDropTarget && "drop-target",
                    )}
                    draggable
                    onDragStart={(event) => {
                      setDraggingProviderId(provider.id);
                      setDropTargetProviderId(provider.id);
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", provider.id);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      if (draggingProviderId && draggingProviderId !== provider.id) {
                        event.dataTransfer.dropEffect = "move";
                        setDropTargetProviderId(provider.id);
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceProviderId = event.dataTransfer.getData("text/plain") || draggingProviderId;
                      if (sourceProviderId && sourceProviderId !== provider.id) {
                        onReorderModelProviders(sourceProviderId, provider.id);
                      }
                      setDraggingProviderId(null);
                      setDropTargetProviderId(null);
                    }}
                    onDragEnd={() => {
                      setDraggingProviderId(null);
                      setDropTargetProviderId(null);
                    }}
                  >
                    <div className="provider-nav-top">
                      <span className="provider-drag-handle" title="拖动排序">
                        <GripVertical size={14} />
                      </span>

                      <button
                        className="provider-nav-select"
                        onClick={() => onSelectProvider(provider.id)}
                        type="button"
                      >
                        <div className="provider-nav-copy">
                          <div className="provider-nav-title-row">
                            <strong>{provider.name}</strong>
                          </div>
                          <div className="provider-nav-meta">
                            {provider.system ? <span className="stack-badge">内置</span> : null}
                            {!provider.system ? <span className="stack-badge">自定义</span> : null}
                            {activeModel?.providerId === provider.id ? (
                              <span className="stack-badge active">默认</span>
                            ) : null}
                            <span className="provider-count-pill">
                              {enabledCount}/{provider.models.length}
                            </span>
                          </div>
                        </div>
                      </button>

                      <div className="provider-nav-actions">
                        <label className="provider-switch" title={provider.enabled ? "停用提供商" : "启用提供商"}>
                          <input
                            checked={provider.enabled}
                            onChange={(event) => {
                              event.stopPropagation();
                              onUpdateModelProvider(provider.id, { enabled: !provider.enabled });
                            }}
                            type="checkbox"
                          />
                          <span className="provider-switch-track">
                            <span className="provider-switch-thumb" />
                          </span>
                        </label>
                      </div>
                    </div>
                  </div>
                );
              })}
            </aside>

            {currentProvider ? (
              <article className="panel-card form-card settings-surface provider-detail-card">
                <div className="provider-detail-head">
                  <div className="provider-detail-copy">
                    <h3>{currentProvider.name}</h3>
                    {currentProvider.system ? <small>内置提供商，可配置但不可删除。</small> : null}
                  </div>

                  <div className="mcp-card-actions">
                    <button
                      className="ghost-text-button"
                      onClick={() => void onRefreshProviderModels(currentProvider.id)}
                      disabled={currentProviderRefreshing}
                    >
                      {currentProviderRefreshing ? (
                        <LoaderCircle size={14} className="spin" />
                      ) : (
                        <RefreshCw size={14} />
                      )}
                    </button>
                    <button className="ghost-text-button" onClick={() => setModelPickerOpen(true)} title="管理模型">
                      <Settings2 size={14} />
                    </button>
                    <button
                      className="ghost-text-button danger"
                      onClick={() => onRemoveModelProvider(currentProvider.id)}
                      disabled={currentProvider.system}
                      title="删除提供商"
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>

                {providerRefreshError ? <p className="provider-inline-error">{providerRefreshError}</p> : null}

                <div className="provider-section">
                  <div className="settings-stage-grid two provider-form-grid">
                    <label>
                      <span>提供商名称</span>
                      <input
                        value={currentProvider.name}
                        onChange={(event) =>
                          onUpdateModelProvider(currentProvider.id, { name: event.target.value })
                        }
                        disabled={currentProvider.system}
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
                      <span>接口密钥</span>
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
                </div>

                <div className="provider-section">
                  <div className="provider-models-head minimal">
                    <strong>模型</strong>
                    <button className="secondary-button" onClick={() => setModelPickerOpen(true)}>
                      <Settings2 size={14} />
                    </button>
                  </div>

                  {currentProviderModelGroups.length > 0 ? (
                    <div className="provider-model-list">
                      {currentProviderModelGroups.map(([groupName, models]) => {
                        const collapsed = collapsedGroups.includes(groupName);

                        return (
                          <section key={groupName} className="model-group">
                            <div className={clsx("model-group-head", collapsed && "collapsed")}>
                              <button
                                className="model-group-trigger"
                                onClick={() =>
                                  setCollapsedGroups((current) =>
                                    current.includes(groupName)
                                      ? current.filter((item) => item !== groupName)
                                      : [...current, groupName],
                                  )
                                }
                                type="button"
                              >
                                <div className="model-group-copy">
                                  <strong>{groupName}</strong>
                                  <span className="model-group-count">{models.length}</span>
                                </div>
                              </button>
                            </div>

                            {!collapsed ? (
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
                                      <div className="model-picker-copy" title={model.description || model.label}>
                                        <div className="model-picker-title-line">
                                          <strong>{model.label}</strong>
                                          <div className="model-picker-tags">
                                            {tags.map((tag) => {
                                              const Icon = tag.icon;
                                              return (
                                                <span
                                                  key={tag.key}
                                                  className={clsx("model-capability-tag", tag.key)}
                                                >
                                                  <Icon size={12} />
                                                  {tag.label}
                                                </span>
                                              );
                                            })}
                                          </div>
                                        </div>
                                        <span>{model.id}</span>
                                      </div>

                                      <div className="model-picker-actions">
                                        {isDefault ? <span className="stack-badge active">默认</span> : null}
                                        <button
                                          className="icon-action-button danger"
                                          onClick={() => onToggleProviderModel(currentProvider.id, model.id)}
                                          title="移除模型"
                                          aria-label={`移除模型 ${model.label}`}
                                          type="button"
                                        >
                                          <X size={18} />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            ) : null}
                          </section>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="empty-panel compact provider-empty">
                      <strong>还没有模型</strong>
                    </div>
                  )}
                </div>
              </article>
            ) : null}
          </div>
        ) : (
          <div className="empty-panel spacious">
            <strong>还没有模型提供商</strong>
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
        error={providerRefreshError}
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
