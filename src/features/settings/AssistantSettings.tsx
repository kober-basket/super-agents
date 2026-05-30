import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  Brain,
  Eye,
  EyeOff,
  Globe,
  GripVertical,
  Image as ImageIcon,
  Plus,
  Settings2,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";

import { compareModelGroupNames, enrichProviderModel } from "../../lib/model-metadata";
import type { ModelProviderConfig, RuntimeModelOption } from "../../types";
import { SurfaceSelect, type SurfaceSelectOption } from "../shared/SurfaceSelect";
import { ProviderModelPickerModal } from "./ProviderModelPickerModal";

interface AssistantSettingsProps {
  activeModel: RuntimeModelOption | null;
  composerModelId: string;
  fallbackModelId: string;
  modelProviders: ModelProviderConfig[];
  providerRefreshError?: string | null;
  providerRefreshingId: string | null;
  selectedModelProviderId: string;
  selectableModels: RuntimeModelOption[];
  onAddModelProvider: () => void;
  onFallbackModelChange: (modelId: string) => void;
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
  fallbackModelId,
  modelProviders,
  providerRefreshError,
  providerRefreshingId,
  selectedModelProviderId,
  selectableModels,
  onAddModelProvider,
  onFallbackModelChange,
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
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
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
  const fallbackModelAvailable =
    !fallbackModelId || selectableModels.some((model) => model.id === fallbackModelId);
  const providerSourceById = useMemo(
    () =>
      new Map(
        modelProviders.map((provider) => [
          provider.id,
          provider.system ? ("builtin" as const) : ("custom" as const),
        ]),
      ),
    [modelProviders],
  );
  const fallbackModelOptions = useMemo<SurfaceSelectOption[]>(
    () => [
      { value: "", label: "未启用" },
      ...selectableModels.map((model) => {
        const source = providerSourceById.get(model.providerId) ?? "custom";
        return {
          value: model.id,
          label: model.modelLabel.trim() || model.label,
          badgeLabel: model.providerName.trim(),
          badgeTone: source,
        };
      }),
    ],
    [providerSourceById, selectableModels],
  );

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
        <div className="settings-stage-heading assistant-settings-heading">
          <div className="assistant-title-row">
            <h1>模型</h1>
            <div className="assistant-title-model-select assistant-image-model-control">
              <span className="assistant-image-model-copy">
                <span className="assistant-title-model-label">
                  <ImageIcon size={14} />
                  图片解析模型
                </span>
                <span className="assistant-title-model-hint">
                  用于非视觉模型处理图片前的内容识别
                </span>
              </span>
              <SurfaceSelect
                value={fallbackModelAvailable ? fallbackModelId : ""}
                options={fallbackModelOptions}
                onChange={onFallbackModelChange}
                disabled={selectableModels.length === 0}
                ariaLabel="图片解析模型"
                className="assistant-image-model-select"
                panelClassName="assistant-image-model-select-panel"
                panelTitle="选择图片解析模型"
                align="left"
                showCheck={false}
              />
            </div>
          </div>
        </div>
        <div className="assistant-settings-actions">
          <button className="secondary-button" onClick={onAddModelProvider}>
            <Plus size={14} />
            添加提供商
          </button>
        </div>
      </header>

      {fallbackModelId && !fallbackModelAvailable ? (
        <p className="provider-inline-error assistant-model-setting-error">当前配置不可用，请重新选择。</p>
      ) : null}

      <div className="settings-block">
        {modelProviders.length > 0 ? (
          <div className="provider-workbench">
            <aside className="provider-rail">

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
                            <span
                              className={clsx(
                                "provider-source-badge",
                                provider.system ? "builtin" : "custom",
                              )}
                            >
                              {provider.system ? "内置" : "自定义"}
                            </span>
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
                    {currentProvider.system ? <small>内置提供商，可配置密钥和模型，名称与接口地址不可修改。</small> : null}
                  </div>

                  {!currentProvider.system ? (
                    <div className="provider-detail-actions">
                      <button
                        className="secondary-button danger provider-delete-button"
                        onClick={() => onRemoveModelProvider(currentProvider.id)}
                        title="删除"
                        type="button"
                      >
                        删除
                      </button>
                    </div>
                  ) : null}
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
                        disabled={currentProvider.system}
                        placeholder="https://api.example.com/v1"
                      />
                    </label>

                    <label className="span-two provider-secret-label">
                      <span>接口密钥</span>
                      <input
                        type={apiKeyVisible ? "text" : "password"}
                        value={currentProvider.apiKey}
                        onChange={(event) =>
                          onUpdateModelProvider(currentProvider.id, { apiKey: event.target.value })
                        }
                        placeholder="sk-..."
                        autoComplete="off"
                        spellCheck={false}
                      />
                      <button
                        aria-label={apiKeyVisible ? "隐藏接口密钥" : "显示接口密钥"}
                        className="secret-visibility-button"
                        onClick={() => setApiKeyVisible((visible) => !visible)}
                        title={apiKeyVisible ? "隐藏接口密钥" : "显示接口密钥"}
                        type="button"
                      >
                        {apiKeyVisible ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
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
