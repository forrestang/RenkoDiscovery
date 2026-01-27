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

  const { totalBars, upBars, dnBars, maStats, allMaStats, runStats, chopStats, stateStats, type1MfeStats } = stats

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

  return (
    <div className="stats-page">
      {/* File Header */}
      <div className="stats-file-header">
        <span className="stats-filename">{filename}</span>
        <span className="stats-total">{totalBars.toLocaleString()} bars</span>
      </div>

      {/* General Stats */}
      <div className="stats-module">
        <table className="stats-table">
          <thead>
            <tr className="module-title-row">
              <th colSpan="3" className="module-title">GENERAL</th>
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
                <th colSpan="3" className="module-title">GLOBAL CHOP INDEX</th>
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
                <th colSpan="5" className="module-title">STATE DISTRIBUTION</th>
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

      {/* Type1 MFE Stats */}
      {type1MfeStats && (type1MfeStats.upDecay?.length > 0 || type1MfeStats.dnDecay?.length > 0) && (
        <div className="stats-module run-distribution">
          <div className="module-title-row standalone-title">
            <span className="module-title">TYPE1 MFE (Bars)</span>
          </div>
          <div className="run-tables-row">
            {/* UP Type1 Decay Table */}
            {type1MfeStats.upDecay?.length > 0 && (
              <table className="stats-table run-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan="3" className="module-title up-title">UP TYPE1 ({type1MfeStats.upTotal})</th>
                  </tr>
                  <tr>
                    <th>&gt;= Bars</th>
                    <th>Count</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {type1MfeStats.upDecay.map(row => (
                    <tr key={row.threshold}>
                      <td>{row.threshold}+</td>
                      <td>{row.count}</td>
                      <td className="up">{row.pct}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* DN Type1 Decay Table */}
            {type1MfeStats.dnDecay?.length > 0 && (
              <table className="stats-table run-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan="3" className="module-title dn-title">DN TYPE1 ({type1MfeStats.dnTotal})</th>
                  </tr>
                  <tr>
                    <th>&gt;= Bars</th>
                    <th>Count</th>
                    <th>%</th>
                  </tr>
                </thead>
                <tbody>
                  {type1MfeStats.dnDecay.map(row => (
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

      {/* Run Distribution Stats */}
      {runStats && (runStats.upDecay?.length > 0 || runStats.dnDecay?.length > 0) && (
        <div className="stats-module run-distribution">
          <div className="run-tables-row">
            {/* UP Runs Decay Table */}
            {runStats.upDecay?.length > 0 && (
              <table className="stats-table run-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan="3" className="module-title up-title">UP RUNS DECAY</th>
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
                    <th colSpan="3" className="module-title dn-title">DN RUNS DECAY</th>
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
                    <th colSpan="3" className="module-title up-title">UP RUNS DISTRIBUTION</th>
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
                    <th colSpan="3" className="module-title dn-title">DN RUNS DISTRIBUTION</th>
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
