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

  const { totalBars, upBars, dnBars, maStats, allMaStats, runStats, chopStats, stateStats, settings, beyondMaStats, beyondAllMaStats } = stats

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
      label: 'ALL MAs',
      colorClass: 'ma-color-all',
      above: allMaStats.aboveAll,
      below: allMaStats.belowAll,
      aboveUp: allMaStats.aboveAllUp ?? 0,
      aboveDown: allMaStats.aboveAllDown ?? 0,
      belowUp: allMaStats.belowAllUp ?? 0,
      belowDown: allMaStats.belowAllDown ?? 0,
    }
  ]

  // Build beyond table data
  const beyondRows = beyondMaStats ? [
    ...beyondMaStats.map((ma, idx) => ({
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
      label: 'ALL MAs',
      colorClass: 'ma-color-all',
      above: beyondAllMaStats.aboveAll,
      below: beyondAllMaStats.belowAll,
      aboveUp: beyondAllMaStats.aboveAllUp ?? 0,
      aboveDown: beyondAllMaStats.aboveAllDown ?? 0,
      belowUp: beyondAllMaStats.belowAllUp ?? 0,
      belowDown: beyondAllMaStats.belowAllDown ?? 0,
    }
  ] : null

  return (
    <div className="stats-page">
      {/* File Header */}
      <div className="stats-file-header">
        <span className="stats-filename">{filename}</span>
        <span className="stats-total">{totalBars.toLocaleString()} bars</span>
      </div>

      {/* User Settings */}
      {settings && (
        <div className="stats-module">
          <table className="stats-table">
            <thead>
              <tr className="module-title-row">
                <th colSpan="3" className="module-title" data-tooltip="User-configured parameters for this dataset">USER SETTINGS</th>
              </tr>
            </thead>
            <tbody>
              <tr className="settings-row">
                <td className="settings-cell"><span className="settings-label">Brick Size</span><span className="settings-value">{settings.brickSize}</span></td>
                <td className="settings-cell"><span className="settings-label">Reversal</span><span className="settings-value">{settings.reversalSize}</span></td>
                <td className="settings-cell"><span className="settings-label">Wicks</span><span className="settings-value">{settings.wickMode}</span></td>
              </tr>
              <tr className="settings-row">
                <td className="settings-cell"><span className="settings-label">ADR</span><span className="settings-value">{settings.adrPeriod}</span></td>
                <td className="settings-cell"><span className="settings-label">Chop</span><span className="settings-value">{settings.chopPeriod}</span></td>
                <td className="settings-cell"></td>
              </tr>
              <tr className="settings-row">
                <td className="settings-cell"><span className="settings-label">MA 1</span><span className="settings-value">{settings.ma1Period}</span></td>
                <td className="settings-cell"><span className="settings-label">MA 2</span><span className="settings-value">{settings.ma2Period}</span></td>
                <td className="settings-cell"><span className="settings-label">MA 3</span><span className="settings-value">{settings.ma3Period}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* General Stats */}
      <div className="stats-module">
        <table className="stats-table">
          <thead>
            <tr className="module-title-row">
              <th colSpan="3" className="module-title" data-tooltip="Total bar count with UP and DN breakdown">GENERAL</th>
            </tr>
            <tr>
              <th>Total Bars</th>
              <th className="up">UP Bars</th>
              <th className="dn">DN Bars</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{totalBars.toLocaleString()}</td>
              <td className="up">{(upBars ?? 0).toLocaleString()} <span className="pct">({pct(upBars ?? 0, totalBars)}%)</span></td>
              <td className="dn">{(dnBars ?? 0).toLocaleString()} <span className="pct">({pct(dnBars ?? 0, totalBars)}%)</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Global Chop Index */}
      {chopStats && (
        <div className="stats-module chop-module">
          <table className="stats-table">
            <thead>
              <tr className="module-title-row">
                <th colSpan="3" className="module-title" data-tooltip="Percentage of bars that reverse direction from the prior bar">GLOBAL CHOP INDEX</th>
              </tr>
              <tr>
                <th>Reversal Bars</th>
                <th>Total</th>
                <th>Chop %</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{chopStats.reversalBars.toLocaleString()}</td>
                <td>{totalBars.toLocaleString()}</td>
                <td className="chop-value">{chopStats.chopIndex}%</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* State Distribution */}
      {stateStats?.length > 0 && (
        <div className="stats-module">
          <table className="stats-table">
            <thead>
              <tr className="module-title-row">
                <th colSpan="5" className="module-title" data-tooltip="Bar count and UP/DN breakdown per MA alignment state (+3 to -3)">STATE DISTRIBUTION</th>
              </tr>
              <tr>
                <th>State</th>
                <th>Count</th>
                <th>%</th>
                <th className="up">UP%</th>
                <th className="dn">DN%</th>
              </tr>
            </thead>
            <tbody>
              {stateStats.map(row => (
                <tr key={row.state}>
                  <td className={row.state > 0 ? 'state-up' : row.state < 0 ? 'state-dn' : ''}>
                    {row.state > 0 ? `+${row.state}` : row.state}
                  </td>
                  <td>{row.count.toLocaleString()}</td>
                  <td>{row.pct}%</td>
                  <td className={`up${row.upPct > row.dnPct ? ' highlight' : ''}`}>{row.upPct}%</td>
                  <td className={`dn${row.dnPct > row.upPct ? ' highlight' : ''}`}>{row.dnPct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Bar Location Stats */}
      <div className="stats-module">
        <table className="stats-table">
          <thead>
            <tr className="module-title-row">
              <th colSpan="7" className="module-title" data-tooltip="Bars where close is above or below each MA">BAR LOCATION(ALL)</th>
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
                <td className={`up${row.aboveUp > row.aboveDown ? ' highlight' : ''}`}>{pct(row.aboveUp, row.above)}%</td>
                <td className={`dn${row.aboveDown > row.aboveUp ? ' highlight' : ''}`}>{pct(row.aboveDown, row.above)}%</td>
                <td>{row.below} <span className="pct">({pct(row.below, totalBars)}%)</span></td>
                <td className={`up${row.belowUp > row.belowDown ? ' highlight' : ''}`}>{pct(row.belowUp, row.below)}%</td>
                <td className={`dn${row.belowDown > row.belowUp ? ' highlight' : ''}`}>{pct(row.belowDown, row.below)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Beyond Bar Location Stats */}
      {beyondRows && (
        <div className="stats-module">
          <table className="stats-table">
            <thead>
              <tr className="module-title-row">
                <th colSpan="7" className="module-title" data-tooltip="Bars entirely above or below each MA (no part of the bar touches the MA)">BAR LOCATION(BEYOND)</th>
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
              {beyondRows.map(row => (
                <tr key={row.label}>
                  <td className={row.colorClass}>{row.label}</td>
                  <td>{row.above} <span className="pct">({pct(row.above, totalBars)}%)</span></td>
                  <td className={`up${row.aboveUp > row.aboveDown ? ' highlight' : ''}`}>{pct(row.aboveUp, row.above)}%</td>
                  <td className={`dn${row.aboveDown > row.aboveUp ? ' highlight' : ''}`}>{pct(row.aboveDown, row.above)}%</td>
                  <td>{row.below} <span className="pct">({pct(row.below, totalBars)}%)</span></td>
                  <td className={`up${row.belowUp > row.belowDown ? ' highlight' : ''}`}>{pct(row.belowUp, row.below)}%</td>
                  <td className={`dn${row.belowDown > row.belowUp ? ' highlight' : ''}`}>{pct(row.belowDown, row.below)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Run Distribution Stats */}
      {runStats && (runStats.upDecay?.length > 0 || runStats.dnDecay?.length > 0) && (
        <div className="stats-module run-distribution">
          <div className="run-tables-row">
            {/* UP Runs Decay Table */}
            {runStats.upDecay?.length > 0 && (
              <table className="stats-table run-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan="3" className="module-title up-title" data-tooltip="Survival rate of consecutive UP bar runs at each threshold">UP RUNS DECAY</th>
                  </tr>
                  <tr>
                    <th>&gt;= Bars</th>
                    <th>Count</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {runStats.upDecay.map(row => (
                    <tr key={row.threshold}>
                      <td>{row.threshold}+</td>
                      <td>{row.count}</td>
                      <td className="up">{row.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* DN Runs Decay Table */}
            {runStats.dnDecay?.length > 0 && (
              <table className="stats-table run-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan="3" className="module-title dn-title" data-tooltip="Survival rate of consecutive DN bar runs at each threshold">DN RUNS DECAY</th>
                  </tr>
                  <tr>
                    <th>&gt;= Bars</th>
                    <th>Count</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {runStats.dnDecay.map(row => (
                    <tr key={row.threshold}>
                      <td>{row.threshold}+</td>
                      <td>{row.count}</td>
                      <td className="dn">{row.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* Run Length Distribution */}
      {runStats && (runStats.upDist?.length > 0 || runStats.dnDist?.length > 0) && (
        <div className="stats-module run-distribution">
          <div className="run-tables-row">
            {/* UP Runs Distribution Table */}
            {runStats.upDist?.length > 0 && (
              <table className="stats-table run-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan="3" className="module-title up-title" data-tooltip="Frequency distribution of consecutive UP bar run lengths">UP RUNS DISTRIBUTION</th>
                  </tr>
                  <tr>
                    <th>Bars</th>
                    <th>Count</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {runStats.upDist.map(row => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{row.count}</td>
                      <td className="up">{row.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* DN Runs Distribution Table */}
            {runStats.dnDist?.length > 0 && (
              <table className="stats-table run-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan="3" className="module-title dn-title" data-tooltip="Frequency distribution of consecutive DN bar run lengths">DN RUNS DISTRIBUTION</th>
                  </tr>
                  <tr>
                    <th>Bars</th>
                    <th>Count</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {runStats.dnDist.map(row => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{row.count}</td>
                      <td className="dn">{row.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default StatsPage
