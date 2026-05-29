import { Eye } from "lucide-react";

import type { RuntimeModelOption } from "../../types";

interface ImageRecognitionSettingsProps {
  fallbackModelId: string;
  selectableModels: RuntimeModelOption[];
  onFallbackModelChange: (modelId: string) => void;
}

export function ImageRecognitionSettings({
  fallbackModelId,
  selectableModels,
  onFallbackModelChange,
}: ImageRecognitionSettingsProps) {
  const selectedAvailable = selectableModels.some((model) => model.id === fallbackModelId);

  return (
    <section className="settings-stage image-recognition-settings-stage">
      <header className="settings-stage-header">
        <div className="settings-stage-heading">
          <h1>智能识图</h1>
        </div>
      </header>

      <div className="settings-block">
        <article className="panel-card form-card settings-surface image-recognition-card">
          <div className="settings-block-head">
            <div>
              <strong>兜底识图模型</strong>
              <p>当前会话模型明确拒绝图片输入时，用这个模型先生成图片描述，再交回原模型完成任务。</p>
            </div>
            <Eye size={18} />
          </div>

          <label className="image-recognition-model-select">
            <span>模型</span>
            <select
              value={selectedAvailable ? fallbackModelId : ""}
              onChange={(event) => onFallbackModelChange(event.target.value)}
            >
              <option value="">未配置</option>
              {selectableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.providerName} / {model.modelLabel}
                </option>
              ))}
            </select>
          </label>

          {fallbackModelId && !selectedAvailable ? (
            <p className="provider-inline-error">当前配置的识图模型不可用，请重新选择一个已启用模型。</p>
          ) : null}
        </article>
      </div>
    </section>
  );
}
