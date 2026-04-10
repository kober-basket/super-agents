interface SettingsOverviewStatsProps {
  mcpCount: number;
  providerCount: number;
  threadCount: number;
}

export function SettingsOverviewStats({
  mcpCount,
  providerCount,
  threadCount,
}: SettingsOverviewStatsProps) {
  return (
    <div className="settings-stats-grid">
      <div className="settings-stat-card">
        <strong>{threadCount}</strong>
        <span>线程</span>
      </div>
      <div className="settings-stat-card">
        <strong>{providerCount}</strong>
        <span>模型源</span>
      </div>
      <div className="settings-stat-card">
        <strong>{mcpCount}</strong>
        <span>MCP</span>
      </div>
    </div>
  );
}
