import clsx from "clsx";
import { ChevronDown, LoaderCircle, Plus, RefreshCw, X } from "lucide-react";

import { createRuntimeModelId } from "../../lib/model-config";
import type { ModelProviderConfig, RuntimeModelOption } from "../../types";

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
  onSetDefaultProviderModel: (providerId: string, modelId: string) => void;
  onToggleProviderModel: (providerId: string, modelId: string) => void;
  onUpdateModelProvider: (providerId: string, patch: Partial<ModelProviderConfig>) => void;
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
  onSetDefaultProviderModel,
  onToggleProviderModel,
  onUpdateModelProvider,
}: AssistantSettingsProps) {
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

  return (
    <section className="settings-stage">
      <header className="settings-stage-header">
        <div>
          <h1>模型配置</h1>
          <p>把流程收口成 3 步：接入供应商、拉取模型、选一个默认模型。</p>
        </div>
        <button className="secondary-button" onClick={onAddModelProvider}>
          <Plus size={14} />
          添加供应商
        </button>
      </header>

      <div className="settings-stage-grid two">
        <article className="panel-card form-card settings-surface">
          <h3>默认模型</h3>
          <label>
            <span>用于日常办公对话的模型</span>
            <div className="select-shell field-select full-width">
              <select value={composerModelId} onChange={(event) => onModelChange(event.target.value)}>
                {selectableModels.length > 0 ? (
                  selectableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))
                ) : (
                  <option value="">暂无模型</option>
                )}
              </select>
              <ChevronDown size={13} />
            </div>
          </label>
          <p className="field-note">
            当前默认：
            {activeModel ? `${activeModel.providerName} / ${activeModel.modelLabel}` : "请先给供应商拉取模型列表"}
          </p>
          <p className="field-note">如果你只接一个供应商，通常直接在它的模型列表里点“设为默认”就够了。</p>
        </article>

        <article className="panel-card form-card settings-surface">
          <h3>当前状态</h3>
          <div className="settings-stats-grid">
            <div className="settings-stat-card">
              <strong>{modelProviders.length}</strong>
              <span>供应商</span>
            </div>
            <div className="settings-stat-card">
              <strong>{totalModelCount}</strong>
              <span>已拉取模型</span>
            </div>
            <div className="settings-stat-card">
              <strong>{enabledModelCount}</strong>
              <span>可选模型</span>
            </div>
          </div>
          <p className="field-note">这里只保留名称、接口地址、API Key 这 3 个必要项，避免把页面做成开发者面板。</p>
        </article>
      </div>

      <div className="settings-block">
        <div className="settings-block-head with-action">
          <h3>供应商</h3>
          {currentProvider ? (
            <button
              className="ghost-text-button"
              onClick={() => void onRefreshProviderModels(currentProvider.id)}
              disabled={currentProviderRefreshing}
            >
              {currentProviderRefreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
              拉取当前供应商模型
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
                    <span>OpenAI 兼容 · {enabledCount}/{provider.models.length} 个模型可用</span>
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
                      OpenAI 兼容 · 已启用 {currentProviderEnabledCount}/{currentProvider.models.length} 个模型
                    </p>
                  </div>
                  <div className="mcp-card-actions">
                    <button
                      className={clsx("toggle-button", currentProvider.enabled && "active")}
                      onClick={() =>
                        onUpdateModelProvider(currentProvider.id, { enabled: !currentProvider.enabled })
                      }
                    >
                      {currentProvider.enabled ? "启用中" : "未启用"}
                    </button>
                    <button className="ghost-text-button danger" onClick={() => onRemoveModelProvider(currentProvider.id)}>
                      <X size={14} />
                      删除
                    </button>
                  </div>
                </div>

                <div className="settings-stage-grid two provider-form-grid">
                  <label>
                    <span>供应商名称</span>
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

                <p className="field-note">填好地址和密钥后，点一次“拉取当前供应商模型”即可，不需要手动一条条录入模型。</p>

                <div className="provider-models-head">
                  <div>
                    <strong>模型列表</strong>
                    <span>
                      {currentProvider.models.length > 0
                        ? "勾选表示可在默认模型里使用；点“设为默认”可以直接切换。"
                        : "还没有模型时，先检查接口地址和 API Key，再拉取一次。"}
                    </span>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => void onRefreshProviderModels(currentProvider.id)}
                    disabled={currentProviderRefreshing}
                  >
                    {currentProviderRefreshing ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />}
                    拉取模型
                  </button>
                </div>

                {currentProvider.models.length > 0 ? (
                  <div className="provider-model-list">
                    {currentProvider.models.map((model) => {
                      const runtimeModelId = createRuntimeModelId(currentProvider.id, model.id);
                      const isDefault = composerModelId === runtimeModelId;

                      return (
                        <div
                          key={model.id}
                          className={clsx(
                            "provider-model-row",
                            model.enabled !== false && "active",
                            isDefault && "default",
                          )}
                        >
                          <label className="provider-model-toggle">
                            <input
                              type="checkbox"
                              checked={model.enabled !== false}
                              onChange={() => onToggleProviderModel(currentProvider.id, model.id)}
                            />
                            <div className="provider-model-copy">
                              <strong>{model.label}</strong>
                              <span>{model.id}</span>
                            </div>
                          </label>

                          <div className="provider-model-actions">
                            {isDefault ? <span className="stack-badge active">默认</span> : null}
                            <button
                              className={clsx("server-row-action", isDefault && "installed")}
                              onClick={() => onSetDefaultProviderModel(currentProvider.id, model.id)}
                              disabled={isDefault}
                            >
                              {isDefault ? "当前默认" : "设为默认"}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="empty-panel compact provider-empty">
                    <strong>还没有模型</strong>
                    <p>先把供应商信息填完整，再拉取一次模型列表。</p>
                  </div>
                )}
              </article>
            ) : null}
          </div>
        ) : (
          <div className="empty-panel spacious">
            <strong>还没有模型供应商</strong>
            <p>先添加一个供应商，填好名称、接口地址和密钥，再自动拉取模型列表。</p>
            <button className="secondary-button" onClick={onAddModelProvider}>
              <Plus size={14} />
              添加供应商
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
