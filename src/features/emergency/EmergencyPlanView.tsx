import { FileText, LoaderCircle, ShieldAlert, Sparkles, Upload } from "lucide-react";

import type { EmergencyPlanInput, EmergencyPlanResult, FileDropEntry } from "../../types";

interface EmergencyPlanViewProps {
  form: EmergencyPlanInput;
  generating: boolean;
  result: EmergencyPlanResult | null;
  onChange: (patch: Partial<EmergencyPlanInput>) => void;
  onPickTemplates: () => void | Promise<void>;
  onRemoveTemplate: (fileId: string) => void;
  onChooseOutputDirectory: () => void | Promise<void>;
  onGenerate: () => void | Promise<void>;
}

function acceptedTemplateHint(file: FileDropEntry) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "file";
  return extension.toUpperCase();
}

export function EmergencyPlanView({
  form,
  generating,
  result,
  onChange,
  onPickTemplates,
  onRemoveTemplate,
  onChooseOutputDirectory,
  onGenerate,
}: EmergencyPlanViewProps) {
  return (
    <section className="report-shell emergency-shell">
      <aside className="report-sidebar emergency-sidebar">
        <div className="report-sidebar-head">
          <span className="report-kicker">应急预案</span>
          <h2>全本预案生成</h2>
          <p>导入 PDF/Word 模板，补充项目要求后，自动生成整本应急预案并导出为 Word。</p>
        </div>

        <div className="report-sidebar-card">
          <div className="report-inline-head">
            <strong>模板文件</strong>
            <span>支持 PDF、DOC、DOCX</span>
          </div>

          <button type="button" className="secondary-button emergency-upload-button" onClick={() => void onPickTemplates()}>
            <Upload size={14} />
            选择模板文件
          </button>

          {form.templateFiles.length > 0 ? (
            <div className="emergency-template-list">
              {form.templateFiles.map((file) => (
                <div key={file.id} className="emergency-template-row">
                  <div className="emergency-template-copy">
                    <strong>{file.name}</strong>
                    <span>{acceptedTemplateHint(file)}</span>
                  </div>
                  <button
                    type="button"
                    className="ghost-button emergency-template-remove"
                    onClick={() => onRemoveTemplate(file.id)}
                  >
                    移除
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="thread-section-empty">先导入 1 份或多份历史应急预案模板，系统会自动识别其中的正文结构。</div>
          )}
        </div>

        <div className="report-sidebar-card">
          <label className="report-field">
            <span>项目名称</span>
            <input value={form.projectName || ""} onChange={(event) => onChange({ projectName: event.target.value })} />
          </label>

          <label className="report-field">
            <span>企业名称</span>
            <input value={form.companyName || ""} onChange={(event) => onChange({ companyName: event.target.value })} />
          </label>

          <label className="report-field">
            <span>项目类型</span>
            <input value={form.projectType || ""} onChange={(event) => onChange({ projectType: event.target.value })} />
          </label>

          <label className="report-field">
            <span>行业类别</span>
            <input
              value={form.industryCategory || ""}
              onChange={(event) => onChange({ industryCategory: event.target.value })}
            />
          </label>

          <label className="report-field">
            <span>项目位置</span>
            <input
              value={form.projectLocation || ""}
              onChange={(event) => onChange({ projectLocation: event.target.value })}
            />
          </label>

          <label className="report-field">
            <span>项目概况</span>
            <textarea
              value={form.projectOverview || ""}
              onChange={(event) => onChange({ projectOverview: event.target.value })}
              placeholder="填写建设内容、工艺、规模、周边环境等"
            />
          </label>

          <label className="report-field">
            <span>风险源信息</span>
            <textarea
              value={form.riskSources || ""}
              onChange={(event) => onChange({ riskSources: event.target.value })}
              placeholder="填写危化品、污染物、装置、事故情景等"
            />
          </label>

          <label className="report-field">
            <span>应急资源</span>
            <textarea
              value={form.emergencyResources || ""}
              onChange={(event) => onChange({ emergencyResources: event.target.value })}
              placeholder="填写应急队伍、装备、物资、联动资源等"
            />
          </label>

          <label className="report-field">
            <span>特殊要求</span>
            <textarea
              value={form.specialRequirements || ""}
              onChange={(event) => onChange({ specialRequirements: event.target.value })}
              placeholder="填写章节侧重点、地方要求、格式要求等"
            />
          </label>
        </div>

        <div className="report-sidebar-card">
          <label className="report-field">
            <span>输出文件名</span>
            <input
              value={form.outputFileName || ""}
              onChange={(event) => onChange({ outputFileName: event.target.value })}
              placeholder="留空则自动生成 .docx"
            />
          </label>

          <div className="report-output-row">
            <div className="report-output-copy">
              <span>输出目录</span>
              <strong>{form.outputDirectory || form.workspaceRoot || "将保存到当前工作目录的 emergency-plans 文件夹"}</strong>
            </div>
            <button type="button" className="ghost-button" onClick={() => void onChooseOutputDirectory()}>
              选择目录
            </button>
          </div>

          <button
            type="button"
            className="primary-button report-generate-button"
            disabled={generating || !form.projectName || form.templateFiles.length === 0}
            onClick={() => void onGenerate()}
          >
            {generating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
            <span>{generating ? "生成中..." : "生成 Word 预案"}</span>
          </button>
        </div>
      </aside>

      <div className="report-main">
        <div className="report-hero">
          <div className="report-hero-card">
            <div className="report-hero-icon">
              <ShieldAlert size={18} />
            </div>
            <div className="report-hero-copy">
              <strong>{form.templateFiles.length > 0 ? `已导入 ${form.templateFiles.length} 份模板` : "待导入模板"}</strong>
              <span>模板越贴近你的行业和地区场景，生成出的预案越稳定。</span>
            </div>
          </div>
          <div className="report-hero-card">
            <div className="report-hero-icon">
              <FileText size={18} />
            </div>
            <div className="report-hero-copy">
              <strong>{result ? "已生成整本预案" : "待生成预案"}</strong>
              <span>会自动输出总则、风险分析、应急处置、保障与附则等完整章节。</span>
            </div>
          </div>
        </div>

        <div className="report-panel">
          {result ? (
            <>
              <div className="report-result-meta">
                <div className="report-result-card">
                  <span>输出文件</span>
                  <strong>{result.fileName}</strong>
                  <p>{result.outputPath}</p>
                </div>
                <div className="report-result-card">
                  <span>模板识别</span>
                  <strong>{result.templateCount} 份模板</strong>
                  <p>已识别 PDF/Word 模板正文并参与生成。</p>
                </div>
              </div>

              <div className="emergency-template-preview">
                {result.recognizedTemplates.map((template) => (
                  <div key={template.path} className="report-result-card">
                    <span>{template.kind.toUpperCase()}</span>
                    <strong>{template.name}</strong>
                    <p>{template.excerpt}</p>
                  </div>
                ))}
              </div>

              <div className="report-preview">
                <div className="report-preview-head">
                  <strong>预案预览</strong>
                  <span>以下正文已同步写入 Word 文档。</span>
                </div>
                <pre>{result.content}</pre>
              </div>
            </>
          ) : (
            <div className="report-empty">
              <strong>先导入模板，再提交新项目要求</strong>
              <span>系统会先识别模板正文，再结合你的新项目参数生成一份完整的应急预案全本。</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
