import './StatsPage.css'

function StatsPage({ stats, filename, isLoading }) {
  if (isLoading) {
    return (
      <div className="stats-page">
        <div className="stats-loading">
          <div className="stats-loading-spinner" />
          <span>Loading statistics...</span>
        </div>
      </div>
    )
  }

  if (!stats) {
    return (
      <div className="stats-page">
        <div className="stats-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M3 3v18h18" />
            <path d="M7 16l4-8 4 4 6-8" />
          </svg>
          <span>Select a parquet file and click "Show Stats" to view statistics</span>
        </div>
      </div>
    )
  }

  const { totalBars, maStats, allMaStats } = stats

  const formatPercent = (count, total) => {
    const pct = ((count / total) * 100).toFixed(1)
    return `${pct}%`
  }

  const formatCount = (count) => {
    return count.toLocaleString()
  }

  return (
    <div className="stats-page">
      <div className="stats-header">
        <div className="stats-title-group">
          <h1 className="stats-title">MA Statistics</h1>
          <span className="stats-filename mono">{filename}</span>
        </div>
        <div className="stats-total">
          <span className="stats-total-label">Total Bars</span>
          <span className="stats-total-value mono">{formatCount(totalBars)}</span>
        </div>
      </div>

      <div className="stats-grid">
        {/* Individual MA Stats */}
        {maStats.map((ma, index) => (
          <div key={ma.period} className="stats-card ma-card">
            <div className="stats-card-header">
              <span className={`ma-indicator ma-${index + 1}`}>MA{index + 1}</span>
              <span className="ma-period mono">{ma.period} Period</span>
            </div>

            <div className="stats-card-body">
              <div className="stat-row above">
                <div className="stat-label">
                  <span className="stat-icon bullish">▲</span>
                  <span>Above MA</span>
                </div>
                <div className="stat-values">
                  <span className="stat-count mono">{formatCount(ma.above)}</span>
                  <span className="stat-percent mono bullish">{formatPercent(ma.above, totalBars)}</span>
                </div>
                <div className="stat-bar-container">
                  <div
                    className="stat-bar bullish"
                    style={{ width: `${(ma.above / totalBars) * 100}%` }}
                  />
                </div>
              </div>

              <div className="stat-row below">
                <div className="stat-label">
                  <span className="stat-icon bearish">▼</span>
                  <span>Below MA</span>
                </div>
                <div className="stat-values">
                  <span className="stat-count mono">{formatCount(ma.below)}</span>
                  <span className="stat-percent mono bearish">{formatPercent(ma.below, totalBars)}</span>
                </div>
                <div className="stat-bar-container">
                  <div
                    className="stat-bar bearish"
                    style={{ width: `${(ma.below / totalBars) * 100}%` }}
                  />
                </div>
              </div>
            </div>

            <div className="stats-card-footer">
              <div className="bias-indicator">
                <span className="bias-label">Bias</span>
                <span className={`bias-value ${ma.above > ma.below ? 'bullish' : 'bearish'}`}>
                  {ma.above > ma.below ? 'Bullish' : 'Bearish'}
                  <span className="bias-delta mono">
                    ({ma.above > ma.below ? '+' : ''}{formatPercent(ma.above - ma.below, totalBars)})
                  </span>
                </span>
              </div>
            </div>
          </div>
        ))}

        {/* All MAs Combined Stats */}
        <div className="stats-card all-ma-card">
          <div className="stats-card-header">
            <span className="ma-indicator all-ma">ALL MAs</span>
            <span className="ma-period mono">Combined Analysis</span>
          </div>

          <div className="stats-card-body all-ma-body">
            <div className="all-ma-stat above-all">
              <div className="all-ma-visual">
                <div className="all-ma-circle bullish">
                  <span className="all-ma-percent mono">{formatPercent(allMaStats.aboveAll, totalBars)}</span>
                </div>
                <div className="all-ma-pulse bullish" />
              </div>
              <div className="all-ma-info">
                <span className="all-ma-label">Above ALL MAs</span>
                <span className="all-ma-count mono">{formatCount(allMaStats.aboveAll)} bars</span>
              </div>
            </div>

            <div className="all-ma-divider">
              <div className="divider-line" />
              <span className="divider-text">vs</span>
              <div className="divider-line" />
            </div>

            <div className="all-ma-stat below-all">
              <div className="all-ma-visual">
                <div className="all-ma-circle bearish">
                  <span className="all-ma-percent mono">{formatPercent(allMaStats.belowAll, totalBars)}</span>
                </div>
                <div className="all-ma-pulse bearish" />
              </div>
              <div className="all-ma-info">
                <span className="all-ma-label">Below ALL MAs</span>
                <span className="all-ma-count mono">{formatCount(allMaStats.belowAll)} bars</span>
              </div>
            </div>
          </div>

          <div className="stats-card-footer all-ma-footer">
            <div className="convergence-stat">
              <span className="convergence-label">Mixed (Between MAs)</span>
              <span className="convergence-value mono">
                {formatCount(totalBars - allMaStats.aboveAll - allMaStats.belowAll)} bars
                <span className="convergence-percent">
                  ({formatPercent(totalBars - allMaStats.aboveAll - allMaStats.belowAll, totalBars)})
                </span>
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default StatsPage
