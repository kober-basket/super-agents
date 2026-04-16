import { Database, FileText, LoaderCircle, MapPinned, Sparkles } from "lucide-react";

import type {
  KnowledgeBaseSummary,
  ProjectReportInput,
  ProjectReportResult,
  WorkspaceTool,
} from "../../types";

interface ReportsViewProps {
  knowledgeBases: KnowledgeBaseSummary[];
  mapTools: WorkspaceTool[];
  generating: boolean;
  form: ProjectReportInput;
  result: ProjectReportResult | null;
  onAddMapTool: () => void | Promise<void>;
  onChange: (patch: Partial<ProjectReportInput>) => void;
  onChooseOutputDirectory: () => void | Promise<void>;
  onGenerate: () => void | Promise<void>;
}

export function ReportsView({
  knowledgeBases,
  mapTools,
  generating,
  form,
  result,
  onAddMapTool,
  onChange,
  onChooseOutputDirectory,
  onGenerate,
}: ReportsViewProps) {
  return (
    <section className="report-shell">
      <aside className="report-sidebar">
        <div className="report-sidebar-head">
          <span className="report-kicker">报告生成</span>
          <h2>项目环评分析</h2>
          <p>结合知识库、项目位置和地图定位结果，快速生成可导出的 Word 报告草稿。</p>
        </div>

        <div className="report-sidebar-card">
          <label className="report-field">
            <span>知识库</span>
            <select
              value={form.knowledgeBaseId || ""}
              onChange={(event) => onChange({ knowledgeBaseId: event.target.value })}
            >
              <option value="">请选择知识库</option>
              {knowledgeBases.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="report-field">
            <span>项目名称</span>
            <input
              value={form.projectName || ""}
              onChange={(event) => onChange({ projectName: event.target.value })}
              placeholder="例如：XX产业园污水处理站项目"
            />
          </label>

          <label className="report-field">
            <span>项目类型</span>
            <input
              value={form.projectType || ""}
              onChange={(event) => onChange({ projectType: event.target.value })}
              placeholder="例如：污水处理、道路、仓储物流"
            />
          </label>

          <label className="report-field">
            <span>项目位置</span>
            <input
              value={form.projectLocation || ""}
              onChange={(event) => onChange({ projectLocation: event.target.value })}
              placeholder="例如：合肥市高新区某路某号"
            />
          </label>

          <div className="report-field-row">
            <label className="report-field">
              <span>经度</span>
              <input
                value={form.longitude || ""}
                onChange={(event) => onChange({ longitude: event.target.value })}
                placeholder="117.123456"
              />
            </label>
            <label className="report-field">
              <span>纬度</span>
              <input
                value={form.latitude || ""}
                onChange={(event) => onChange({ latitude: event.target.value })}
                placeholder="31.123456"
              />
            </label>
          </div>

          <label className="report-field">
            <span>政策关注点</span>
            <input
              value={form.policyFocus || ""}
              onChange={(event) => onChange({ policyFocus: event.target.value })}
              placeholder="例如：园区规划、三线一单、产业准入"
            />
          </label>

          <label className="report-field">
            <span>项目概况</span>
            <textarea
              value={form.projectOverview || ""}
              onChange={(event) => onChange({ projectOverview: event.target.value })}
              placeholder="补充建设内容、规模、工艺、占地等基础信息"
            />
          </label>
        </div>

        <div className="report-sidebar-card">
          <div className="report-inline-head">
            <strong>地图定位</strong>
            <span>{mapTools.length > 0 ? `已检测到 ${mapTools.length} 个地图工具` : "暂未检测到地图工具"}</span>
          </div>

          {mapTools.length === 0 ? (
            <button type="button" className="secondary-button report-connect-button" onClick={() => void onAddMapTool()}>
              <MapPinned size={14} />
              快捷接入高德地图 MCP
            </button>
          ) : null}

          <label className="report-field">
            <span>优先地图工具</span>
            <select
              value={`${form.preferredMapServerId || ""}::${form.preferredMapToolName || ""}`}
              onChange={(event) => {
                const [preferredMapServerId, preferredMapToolName] = event.target.value.split("::");
                onChange({
                  preferredMapServerId: preferredMapServerId || undefined,
                  preferredMapToolName: preferredMapToolName || undefined,
                });
              }}
            >
              <option value="::">自动选择</option>
              {mapTools.map((tool) => (
                <option key={tool.id} value={`${tool.serverId || ""}::${tool.name}`}>
                  {(tool.serverName ? `${tool.serverName} / ` : "") + tool.name}
                </option>
              ))}
            </select>
          </label>

          <label className="report-field">
            <span>输出文件名</span>
            <input
              value={form.outputFileName || ""}
              onChange={(event) => onChange({ outputFileName: event.target.value })}
              placeholder="留空则自动命名为 .docx"
            />
          </label>

          <div className="report-output-row">
            <div className="report-output-copy">
              <span>输出目录</span>
              <strong>{form.outputDirectory || form.workspaceRoot || "将保存到当前工作目录的 reports 文件夹"}</strong>
            </div>
            <button type="button" className="ghost-button" onClick={() => void onChooseOutputDirectory()}>
              选择目录
            </button>
          </div>

          <button
            type="button"
            className="primary-button report-generate-button"
            disabled={generating || !form.knowledgeBaseId || !form.projectName}
            onClick={() => void onGenerate()}
          >
            {generating ? <LoaderCircle size={16} className="spin" /> : <Sparkles size={16} />}
            <span>{generating ? "生成中..." : "生成 Word 报告"}</span>
          </button>
        </div>
      </aside>

      <div className="report-main">
        <div className="report-hero">
          <div className="report-hero-card">
            <div className="report-hero-icon">
              <Database size={18} />
            </div>
            <div className="report-hero-copy">
              <strong>{form.knowledgeBaseId ? "已绑定知识库" : "待选择知识库"}</strong>
              <span>报告会优先使用所选知识库中的法规、规划和项目资料。</span>
            </div>
          </div>
          <div className="report-hero-card">
            <div className="report-hero-icon">
              <MapPinned size={18} />
            </div>
            <div className="report-hero-copy">
              <strong>{form.longitude && form.latitude ? "坐标已就绪" : "可补充坐标"}</strong>
              <span>有地图工具时会自动定位，没有时也会基于位置和坐标继续分析。</span>
            </div>
          </div>
          <div className="report-hero-card">
            <div className="report-hero-icon">
              <FileText size={18} />
            </div>
            <div className="report-hero-copy">
              <strong>{result ? "已输出 Word 文档" : "待生成报告"}</strong>
              <span>固定覆盖编制依据、评价等级、选址符合性和政策符合性分析。</span>
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
                  <span>地图定位</span>
                  <strong>{result.mapToolUsed || "未调用地图工具"}</strong>
                  <p>{result.locationSummary || "未返回定位摘要"}</p>
                </div>
                <div className="report-result-card">
                  <span>知识引用</span>
                  <strong>{result.references.length} 条参考材料</strong>
                  <p>已自动融合知识库检索结果并写入报告生成上下文。</p>
                </div>
              </div>

              <div className="report-preview">
                <div className="report-preview-head">
                  <strong>报告预览</strong>
                  <span>以下内容已同步写入 Word 文档。</span>
                </div>
                <pre>{result.content}</pre>
              </div>
            </>
          ) : (
            <div className="report-empty">
              <strong>先补全项目信息，再一键生成</strong>
              <span>这里会把知识库检索、地图定位和项目参数组织成一份适合环评写作的中文报告草稿。</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
