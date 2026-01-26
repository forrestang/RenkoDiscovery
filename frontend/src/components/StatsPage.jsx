import './StatsPage.css'

function StatsPage({ stats, filename, filepath, isLoading, onDelete }) {
  if (isLoading) {
    return (
      <div className="stats-page">
        <div className="stats-loading">
          <div className="stats-loading-spinner" />
          <span>Loading...</span>
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="stats-page">
        <div className="stats-empty">
          <span className="stats-empty-icon">[···]</span>
          <span>Select a parquet file to view statistics</span>
        </div>
      </div>
    )
  }

  const { totalBars, maStats, allMaStats } = stats

  const pct = (count, total) => total > 0 ? ((count / total) * 100).toFixed(0) : '0'

  // Build table data
  const rows = [
    ...maStats.map((ma, idx) => ({
      label: `MA(${ma.period})`,
      colorClass: `ma-color-${idx + 1}`,
      above: ma.above,
      below: ma.below,
      aboveUp: ma.aboveUp ?? 0,
      aboveDown: ma.aboveDown ?? 0,
      belowUp: ma.belowUp ?? 0,
      belowDown: ma.belowDown ?? 0,
    })),
    {
      label: 'ALL',
      colorClass: 'ma-color-all',
      above: allMaStats.aboveAll,
      below: allMaStats.belowAll,
      aboveUp: allMaStats.aboveAllUp ?? 0,
      aboveDown: allMaStats.aboveAllDown ?? 0,
      belowUp: allMaStats.belowAllUp ?? 0,
      belowDown: allMaStats.belowAllDown ?? 0,
    }
  ]

  return (
    <div className="stats-page">
      {/* File Header */}
      <div className="stats-file-header">
        <span className="stats-filename">{filename}</span>
        <span className="stats-total">{totalBars.toLocaleString()} bars</span>
      </div>

      {/* Bar Location Stats */}
      <div className="stats-module">
        <table className="stats-table">
          <thead>
            <tr className="module-title-row">
              <th colSpan="7" className="module-title">BAR LOCATION</th>
            </tr>
            <tr>
              <th></th>
              <th colSpan="3">Above</th>
              <th colSpan="3">Below</th>
            </tr>
            <tr>
              <th>MA</th>
              <th>Count</th>
              <th className="up">UP%</th>
              <th className="dn">DN%</th>
              <th>Count</th>
              <th className="up">UP%</th>
              <th className="dn">DN%</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.label}>
                <td className={row.colorClass}>{row.label}</td>
                <td>{row.above} <span className="pct">({pct(row.above, totalBars)}%)</span></td>
                <td className="up">{pct(row.aboveUp, row.above)}%</td>
                <td className="dn">{pct(row.aboveDown, row.above)}%</td>
                <td>{row.below} <span className="pct">({pct(row.below, totalBars)}%)</span></td>
                <td className="up">{pct(row.belowUp, row.below)}%</td>
                <td className="dn">{pct(row.belowDown, row.below)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default StatsPage
