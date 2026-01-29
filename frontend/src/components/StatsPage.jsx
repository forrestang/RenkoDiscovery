import React from 'react'
import Plot from 'react-plotly.js'
import './StatsPage.css'

function StatsPage({ stats, filename, filepath, isLoading, onDelete }) {
  const equityCurves = stats?.equityCurves

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

  const { totalBars, upBars, dnBars, maStats, allMaStats, runStats, chopStats, stateStats, settings, beyondMaStats, beyondAllMaStats, emaRrDecay, wickDist } = stats

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

      {/* Cumulative R Curve */}
      {equityCurves && Object.values(equityCurves).some(a => a && a.length > 0) && (
        <div className="stats-module equity-curve-module">
          <div className="equity-curve-header">
            <span className="module-title-text">CUMULATIVE R CURVE</span>
            <span className="equity-curve-source">FX_clr_RR</span>
          </div>
          <Plot
            data={[
              { key: 'type1Up', color: '#22c55e', name: 'Type1 UP' },
              { key: 'type1Dn', color: '#ef4444', name: 'Type1 DN' },
              { key: 'type2Up', color: '#4ade80', name: 'Type2 UP', dash: 'dot' },
              { key: 'type2Dn', color: '#f87171', name: 'Type2 DN', dash: 'dot' },
            ]
              .filter(s => equityCurves[s.key]?.length > 0)
              .map(s => ({
                x: equityCurves[s.key].map(pt => pt.x),
                y: equityCurves[s.key].map(pt => pt.y),
                type: 'scatter',
                mode: 'lines',
                name: s.name,
                line: { color: s.color, width: 2, dash: s.dash },
                hovertemplate: '%{y:.2f} RR<extra>%{fullData.name}</extra>',
              }))}
            layout={{
              height: 300,
              margin: { t: 8, r: 16, b: 40, l: 50 },
              paper_bgcolor: '#000000',
              plot_bgcolor: '#000000',
              font: { family: 'monospace', size: 11, color: '#a0a0b0' },
              xaxis: {
                title: { text: 'Signal #', font: { size: 10 } },
                gridcolor: 'rgba(255,255,255,0.1)',
                zeroline: false,
              },
              yaxis: {
                title: { text: 'Cumulative RR', font: { size: 10 } },
                gridcolor: 'rgba(255,255,255,0.1)',
                zeroline: true,
                zerolinecolor: 'rgba(255,255,255,0.15)',
              },
              legend: {
                orientation: 'h',
                x: 0.5,
                xanchor: 'center',
                y: -0.18,
                font: { size: 10 },
              },
              hovermode: 'x unified',
            }}
            config={{ displayModeBar: true, responsive: true, modeBarButtonsToRemove: ['toImage', 'lasso2d', 'select2d'] }}
            useResizeHandler
            style={{ width: '100%', height: 300 }}
          />
        </div>
      )}

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
            <table className="stats-table run-table">
              <thead>
                <tr className="module-title-row">
                  <th colSpan="5" className="module-title" data-tooltip="Survival rate of consecutive bar runs at each threshold">RUNS DECAY</th>
                </tr>
                <tr>
                  <th>&gt;= Bars</th>
                  <th>UP Count</th>
                  <th>UP %</th>
                  <th>DN Count</th>
                  <th>DN %</th>
                </tr>
              </thead>
              <tbody>
                {(runStats.upDecay || runStats.dnDecay || []).map((row, i) => {
                  const upRow = runStats.upDecay?.[i];
                  const dnRow = runStats.dnDecay?.[i];
                  return (
                    <tr key={row.threshold}>
                      <td>{row.threshold}+</td>
                      <td>{upRow?.count ?? ''}</td>
                      <td className="up">{upRow ? `${upRow.pct}%` : ''}</td>
                      <td>{dnRow?.count ?? ''}</td>
                      <td className="dn">{dnRow ? `${dnRow.pct}%` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Run Length Distribution */}
      {runStats && (runStats.upDist?.length > 0 || runStats.dnDist?.length > 0) && (
        <div className="stats-module run-distribution">
          <div className="run-tables-row">
            <table className="stats-table run-table">
              <thead>
                <tr className="module-title-row">
                  <th colSpan="5" className="module-title" data-tooltip="Frequency distribution of consecutive bar run lengths">RUNS DISTRIBUTION</th>
                </tr>
                <tr>
                  <th>Bars</th>
                  <th>UP Count</th>
                  <th>UP %</th>
                  <th>DN Count</th>
                  <th>DN %</th>
                </tr>
              </thead>
              <tbody>
                {(runStats.upDist || runStats.dnDist || []).map((row, i) => {
                  const upRow = runStats.upDist?.[i];
                  const dnRow = runStats.dnDist?.[i];
                  return (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{upRow?.count ?? ''}</td>
                      <td className="up">{upRow ? `${upRow.pct}%` : ''}</td>
                      <td>{dnRow?.count ?? ''}</td>
                      <td className="dn">{dnRow ? `${dnRow.pct}%` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {/* EMA RR Distance Decay Tables */}
      {emaRrDecay && emaRrDecay.map(entry => (
        (entry.upDecay?.length > 0 || entry.dnDecay?.length > 0) && (
          <div className="stats-module run-distribution" key={entry.period}>
            <div className="run-tables-row">
              <table className="stats-table run-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan="5" className="module-title" data-tooltip={`Survival rate of EMA RR distance from EMA(${entry.period})`}>EMA RR DISTANCE DECAY ({entry.period})</th>
                  </tr>
                  <tr>
                    <th>&gt;= RR</th>
                    <th>UP Count</th>
                    <th>UP %</th>
                    <th>DN Count</th>
                    <th>DN %</th>
                  </tr>
                </thead>
                <tbody>
                  {(entry.upDecay || entry.dnDecay || []).map((row, i) => {
                    const upRow = entry.upDecay?.[i];
                    const dnRow = entry.dnDecay?.[i];
                    return (
                      <tr key={row.threshold}>
                        <td>{row.threshold}+</td>
                        <td>{upRow?.count ?? ''}</td>
                        <td className="up">{upRow ? `${upRow.pct}%` : ''}</td>
                        <td>{dnRow?.count ?? ''}</td>
                        <td className="dn">{dnRow ? `${dnRow.pct}%` : ''}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )
      ))}

      {/* Wick Distribution (DD_RR) */}
      {wickDist && (wickDist.upDist?.length > 0 || wickDist.dnDist?.length > 0) && (
        <div className="stats-module run-distribution">
          <div className="run-tables-row">
            <table className="stats-table run-table">
              <thead>
                <tr className="module-title-row">
                  <th colSpan="5" className="module-title" data-tooltip="Distribution of wick size (DD_RR) on UP and DN bars">WICK DISTRIBUTION</th>
                </tr>
                <tr>
                  <th>RR</th>
                  <th>UP Count</th>
                  <th>UP %</th>
                  <th>DN Count</th>
                  <th>DN %</th>
                </tr>
              </thead>
              <tbody>
                {(wickDist.upDist || wickDist.dnDist || []).map((row, i) => {
                  const upRow = wickDist.upDist?.[i];
                  const dnRow = wickDist.dnDist?.[i];
                  return (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td>{upRow?.count ?? ''}</td>
                      <td className="up">{upRow ? `${upRow.pct}%` : ''}</td>
                      <td>{dnRow?.count ?? ''}</td>
                      <td className="dn">{dnRow ? `${dnRow.pct}%` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default StatsPage
