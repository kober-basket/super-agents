import { useMemo, useState } from "react";
import clsx from "clsx";
import {
  Brain,
  ChevronDown,
  Eye,
  Globe,
  ListMinus,
  ListPlus,
  RefreshCw,
  Search,
  Sparkles,
  Wrench,
  X,
} from "lucide-react";

import { createRuntimeModelId } from "../../lib/model-config";
import { compareModelGroupNames, enrichProviderModel } from "../../lib/model-metadata";
import type { ModelProviderConfig, ProviderModelConfig } from "../../types";

type FilterKey = "all" | "reasoning" | "vision" | "webSearch" | "free" | "embedding" | "rerank" | "tools";

interface ProviderModelPickerModalProps {
  open: boolean;
  provider: ModelProviderConfig | null;
  composerModelId: string;
  refreshing: boolean;
  onClose: () => void;
  onRefresh: (providerId: string) => void | Promise<void>;
  onToggleModel: (providerId: string, modelId: string) => void;
  onSetModelsEnabled: (providerId: string, modelIds: string[], enabled: boolean) => void;
  onSetDefaultModel: (providerId: string, modelId: string) => void;
}

const FILTER_OPTIONS: Array<{ key: FilterKey; label: string }> = [
  { key: "all", label: "全部" },
  { key: "reasoning", label: "推理" },
  { key: "vision", label: "视觉" },
  { key: "webSearch", label: "联网" },
  { key: "free", label: "免费" },
  { key: "embedding", label: "嵌入" },
  { key: "rerank", label: "重排" },
  { key: "tools", label: "工具" },
];

function matchesFilter(model: ProviderModelConfig, filter: FilterKey) {
  if (filter === "all") return true;
  return model.capabilities?.[filter] === true;
}

function tagItems(model: ProviderModelConfig) {
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

export function ProviderModelPickerModal({
  open,
  provider,
  composerModelId,
  refreshing,
  onClose,
  onRefresh,
  onToggleModel,
  onSetModelsEnabled,
  onSetDefaultModel,
}: ProviderModelPickerModalProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>([]);
  const displayModels = useMemo(
    () => (provider ? provider.models.map((model) => enrichProviderModel(model)) : []),
    [provider],
  );

  const filteredModels = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return displayModels.filter((model) => {
      const matchedQuery =
        !normalizedQuery ||
        [model.id, model.label, model.vendor, model.group, model.description]
          .filter(Boolean)
          .some((value) => String(value).toLowerCase().includes(normalizedQuery));

      return matchedQuery && matchesFilter(model, filter);
    });
  }, [displayModels, filter, query]);

  const groupedModels = useMemo(() => {
    const groups = new Map<string, ProviderModelConfig[]>();
    for (const model of filteredModels) {
      const groupName = model.group || model.vendor || "其他";
      const existing = groups.get(groupName) ?? [];
      existing.push(model);
      groups.set(groupName, existing);
    }
    return Array.from(groups.entries()).sort((left, right) => compareModelGroupNames(left[0], right[0]));
  }, [filteredModels]);

  const allVisibleAdded = filteredModels.length > 0 && filteredModels.every((model) => model.enabled !== false);

  if (!open || !provider) return null;

  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="model-picker-modal" onClick={(event) => event.stopPropagation()}>
        <div className="model-picker-head">
          <div>
            <h3>{provider.name} 模型</h3>
            <p>按厂商分组查看模型能力，拉取只做发现，是否加入由你自己决定。</p>
          </div>
          <button className="ghost-icon" onClick={onClose} title="关闭" type="button">
            <X size={16} />
          </button>
        </div>

        <div className="model-picker-toolbar">
          <label className="search-field model-picker-search">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索模型 ID 或名称"
            />
          </label>

          <button
            className="secondary-button"
            title={allVisibleAdded ? "移除当前筛选结果" : "添加当前筛选结果"}
            onClick={() =>
              onSetModelsEnabled(
                provider.id,
                filteredModels.map((model) => model.id),
                !allVisibleAdded,
              )
            }
            disabled={filteredModels.length === 0}
            type="button"
          >
            {allVisibleAdded ? <ListMinus size={14} /> : <ListPlus size={14} />}
          </button>

          <button
            className="secondary-button"
            onClick={() => void onRefresh(provider.id)}
            disabled={refreshing}
            title="重新拉取模型列表"
            type="button"
          >
            <RefreshCw size={14} className={clsx(refreshing && "spin")} />
          </button>
        </div>

        <div className="model-picker-tabs">
          {FILTER_OPTIONS.map((item) => (
            <button
              key={item.key}
              className={clsx("model-picker-tab", filter === item.key && "active")}
              onClick={() => setFilter(item.key)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="model-picker-list">
          {groupedModels.length > 0 ? (
            groupedModels.map(([groupName, models]) => {
              const collapsed = collapsedGroups.includes(groupName);
              const groupAllAdded = models.every((model) => model.enabled !== false);

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
                        <ChevronDown size={16} className={clsx("model-group-arrow", collapsed && "collapsed")} />
                        <strong>{groupName}</strong>
                        <span className="model-group-count">{models.length}</span>
                      </div>
                    </button>
                    <button
                      className="model-group-action"
                      onClick={() =>
                        onSetModelsEnabled(provider.id, models.map((model) => model.id), !groupAllAdded)
                      }
                      title={groupAllAdded ? "移除该分组模型" : "添加该分组模型"}
                      type="button"
                    >
                      {groupAllAdded ? <ListMinus size={18} /> : <ListPlus size={18} />}
                    </button>
                  </div>

                  {!collapsed ? (
                    <div className="model-group-body">
                      {models.map((model) => {
                        const runtimeModelId = createRuntimeModelId(provider.id, model.id);
                        const isAdded = model.enabled !== false;
                        const isDefault = composerModelId === runtimeModelId;
                        const tags = tagItems(model);

                        return (
                          <div
                            key={model.id}
                            className={clsx("model-picker-row", isAdded && "active", isDefault && "default")}
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
                              <button
                                className={clsx("icon-action-button", isAdded && "danger")}
                                onClick={() => onToggleModel(provider.id, model.id)}
                                title={isAdded ? "移除模型" : "添加模型"}
                                type="button"
                              >
                                {isAdded ? <ListMinus size={18} /> : <ListPlus size={18} />}
                              </button>
                              <button
                                className={clsx("server-row-action", isDefault && "installed")}
                                onClick={() => onSetDefaultModel(provider.id, model.id)}
                                disabled={isDefault}
                                type="button"
                              >
                                {isDefault ? "当前默认" : "设为默认"}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </section>
              );
            })
          ) : (
            <div className="empty-panel compact">
              <strong>没有匹配到模型</strong>
              <p>试试切换筛选或刷新模型列表，然后再按需选择要加入的模型。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
