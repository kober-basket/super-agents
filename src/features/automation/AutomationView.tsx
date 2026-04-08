import { QUICK_AUTOMATIONS } from "./constants";

interface AutomationViewProps {
  onUseAutomation: (prompt: string) => void;
}

export function AutomationView({ onUseAutomation }: AutomationViewProps) {
  return (
    <section className="panel-page">
      <div className="panel-inner">
        <div className="panel-head">
          <div>
            <h2>自动化</h2>
            <p>把常见的办公、整理和轻松陪伴场景做成快捷入口。</p>
          </div>
        </div>

        <div className="panel-grid three">
          {QUICK_AUTOMATIONS.map((item) => (
            <button
              key={item.title}
              className="panel-card action-card"
              onClick={() => onUseAutomation(item.prompt)}
            >
              <strong>{item.title}</strong>
              <p>{item.description}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
