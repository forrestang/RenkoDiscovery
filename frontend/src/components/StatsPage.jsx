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

  const pct = (count, total) => ((count / total) * 100).toFixed(1)
  const fmt = (n) => (n ?? 0).toLocaleString()

  const handleDelete = async () => {
    if (!filepath) return
    if (!window.confirm(`Delete ${filename}?`)) return
    onDelete?.(filepath)
  }

  const mixedCount = totalBars - allMaStats.aboveAll - allMaStats.belowAll

  return (
    <div className="stats-page">
      {/* File Header */}
      <div className="stats-file-header">
        <div className="stats-file-info">
          <span className="stats-filename">{filename}</span>
          <span className="stats-total">{fmt(totalBars)} bars</span>
        </div>
        <button className="stats-delete-btn" onClick={handleDelete} title="Delete file">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14z" />
          </svg>
          <span>Delete</span>
        </button>
      </div>

      {/* Individual MA Sections */}
      {maStats.map((ma, idx) => (
        <div key={ma.period} className="stats-section">
          <div className={`stats-section-header ma-header-${idx + 1}`}>MA({ma.period})</div>
          <div className="stats-rows">
            <div className="stats-row">
              <span className="stats-label label-above">Above</span>
              <span className="stats-count">
                {fmt(ma.above)} <span className="stats-pct">({pct(ma.above, totalBars)}%)</span>
              </span>
              <span className="stats-breakdown">
                <span className="stats-up">UP {fmt(ma.aboveUp ?? 0)}</span>
                <span className="stats-dn">DN {fmt(ma.aboveDown ?? 0)}</span>
              </span>
            </div>
            <div className="stats-row">
              <span className="stats-label label-below">Below</span>
              <span className="stats-count">
                {fmt(ma.below)} <span className="stats-pct">({pct(ma.below, totalBars)}%)</span>
              </span>
              <span className="stats-breakdown">
                <span className="stats-up">UP {fmt(ma.belowUp ?? 0)}</span>
                <span className="stats-dn">DN {fmt(ma.belowDown ?? 0)}</span>
              </span>
            </div>
          </div>
        </div>
      ))}

      {/* ALL MAs Section */}
      <div className="stats-section stats-section-all">
        <div className="stats-section-header ma-header-all">ALL MAs</div>
        <div className="stats-rows">
          <div className="stats-row">
            <span className="stats-label label-above">Above All</span>
            <span className="stats-count">
              {fmt(allMaStats.aboveAll)} <span className="stats-pct">({pct(allMaStats.aboveAll, totalBars)}%)</span>
            </span>
            <span className="stats-breakdown">
              <span className="stats-up">UP {fmt(allMaStats.aboveAllUp ?? 0)}</span>
              <span className="stats-dn">DN {fmt(allMaStats.aboveAllDown ?? 0)}</span>
            </span>
          </div>
          <div className="stats-row">
            <span className="stats-label label-below">Below All</span>
            <span className="stats-count">
              {fmt(allMaStats.belowAll)} <span className="stats-pct">({pct(allMaStats.belowAll, totalBars)}%)</span>
            </span>
            <span className="stats-breakdown">
              <span className="stats-up">UP {fmt(allMaStats.belowAllUp ?? 0)}</span>
              <span className="stats-dn">DN {fmt(allMaStats.belowAllDown ?? 0)}</span>
            </span>
          </div>
          <div className="stats-row">
            <span className="stats-label label-mixed">Mixed</span>
            <span className="stats-count">
              {fmt(mixedCount)} <span className="stats-pct">({pct(mixedCount, totalBars)}%)</span>
            </span>
            <span className="stats-mixed-note">between MAs</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default StatsPage
