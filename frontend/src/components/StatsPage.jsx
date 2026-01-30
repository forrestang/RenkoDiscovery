import React, { useState, useEffect, useMemo } from 'react'
import Plot from 'react-plotly.js'
import './StatsPage.css'

const STORAGE_PREFIX = 'RenkoDiscovery_'

const RR_FIELDS = [
  { value: 'rr', label: 'FX_clr_RR', desc: 'MFE to color change, reversal-normalized' },
  { value: 'rr_adj', label: 'FX_clr_RR (adj)', desc: 'FX_clr_RR - 1, subtracts one reversal for a more realistic exit estimate' },
  { value: 'clr_adr', label: 'FX_clr_ADR', desc: 'MFE to color change, ADR-normalized' },
  { value: 'clr_adr_adj', label: 'FX_clr_ADR (adj)', desc: 'FX_clr_ADR minus one reversal in ADR units (reversal_size / currentADR), for a more realistic exit estimate' },
  { value: 'ma1_rr', label: 'FX_MA1_RR', desc: 'Move until price closes beyond MA1, reversal-normalized' },
  { value: 'ma1_adr', label: 'FX_MA1_ADR', desc: 'Move until price closes beyond MA1, ADR-normalized' },
  { value: 'ma2_rr', label: 'FX_MA2_RR', desc: 'Move until price closes beyond MA2, reversal-normalized' },
  { value: 'ma2_adr', label: 'FX_MA2_ADR', desc: 'Move until price closes beyond MA2, ADR-normalized' },
  { value: 'ma3_rr', label: 'FX_MA3_RR', desc: 'Move until price closes beyond MA3, reversal-normalized' },
  { value: 'ma3_adr', label: 'FX_MA3_ADR', desc: 'Move until price closes beyond MA3, ADR-normalized' },
]

const RR_BUCKETS = [
  { label: '<=0',      test: v => v <= 0 },
  { label: '>0 to <1', test: v => v > 0 && v < 1 },
  { label: '1 to <2',  test: v => v >= 1 && v < 2 },
  { label: '2 to <3',  test: v => v >= 2 && v < 3 },
  { label: '3 to <5',  test: v => v >= 3 && v < 5 },
  { label: '5+',       test: v => v >= 5 },
]

function computeSignalStats(upArr, dnArr, rrField = 'rr') {
  const getRR = (p) => p[rrField] ?? 0

  const calcSummary = (arr) => {
    if (arr.length === 0) return { count: 0, avgRR: 0, winRate: 0 }
    const sum = arr.reduce((s, p) => s + getRR(p), 0)
    const wins = arr.filter(p => getRR(p) > 0).length
    return {
      count: arr.length,
      avgRR: (sum / arr.length).toFixed(2),
      winRate: (wins / arr.length * 100).toFixed(0),
    }
  }

  const calcNthBreakdown = (arr) => {
    const byN = {}
    arr.forEach(p => {
      if (!byN[p.n]) byN[p.n] = []
      byN[p.n].push(getRR(p))
    })
    return Object.entries(byN)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([n, rrs]) => ({
        n: Number(n),
        count: rrs.length,
        avgRR: (rrs.reduce((s, v) => s + v, 0) / rrs.length).toFixed(2),
        winRate: (rrs.filter(v => v > 0).length / rrs.length * 100).toFixed(0),
      }))
  }

  const calcDist = (arr) => {
    const total = arr.length
    return RR_BUCKETS.map(b => ({
      label: b.label,
      count: arr.filter(p => b.test(getRR(p))).length,
      pct: total > 0 ? (arr.filter(p => b.test(getRR(p))).length / total * 100).toFixed(0) : '0',
    }))
  }

  return {
    upSummary: calcSummary(upArr),
    dnSummary: calcSummary(dnArr),
    upNth: calcNthBreakdown(upArr),
    dnNth: calcNthBreakdown(dnArr),
    upDist: calcDist(upArr),
    dnDist: calcDist(dnArr),
  }
}

function StatsPage({ stats, filename, filepath, isLoading, onDelete }) {
  const signalData = stats?.signalData

  // Derive distinct N values per type
  const type1NValues = useMemo(() => {
    if (!signalData) return []
    const nSet = new Set()
    ;['type1Up', 'type1Dn'].forEach(key => {
      if (signalData[key]) signalData[key].forEach(pt => nSet.add(pt.n))
    })
    return Array.from(nSet).sort((a, b) => a - b)
  }, [signalData])

  const type2NValues = useMemo(() => {
    if (!signalData) return []
    const nSet = new Set()
    ;['type2Up', 'type2Dn'].forEach(key => {
      if (signalData[key]) signalData[key].forEach(pt => nSet.add(pt.n))
    })
    return Array.from(nSet).sort((a, b) => a - b)
  }, [signalData])

  // Independent N selections per type — default to all
  const [selectedType1Ns, setSelectedType1Ns] = useState([])
  const [selectedType2Ns, setSelectedType2Ns] = useState([])
  useEffect(() => { setSelectedType1Ns(type1NValues) }, [type1NValues])
  useEffect(() => { setSelectedType2Ns(type2NValues) }, [type2NValues])

  // Type-level on/off toggles
  const [type1Enabled, setType1Enabled] = useState(true)
  const [type2Enabled, setType2Enabled] = useState(true)
  const [comboMode, setComboMode] = useState(false)
  const [selectedRRField, setSelectedRRField] = useState('rr')

  // Active tab — persist to localStorage
  const [activeTab, setActiveTab] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}statsActiveTab`)
    return saved || 'general'
  })
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}statsActiveTab`, activeTab)
  }, [activeTab])

  // Collapsible filter panel — persist to localStorage
  const [filtersOpen, setFiltersOpen] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}statsFiltersOpen`)
    return saved !== null ? saved === 'true' : false
  })
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}statsFiltersOpen`, filtersOpen.toString())
  }, [filtersOpen])

  // Filter signal data by per-type N selections and enabled state
  const filteredSignalData = useMemo(() => {
    if (!signalData) return {}
    const t1NsSet = new Set(selectedType1Ns)
    const t2NsSet = new Set(selectedType2Ns)
    const result = {}
    for (const [key, arr] of Object.entries(signalData)) {
      if (key.startsWith('type1')) {
        result[key] = type1Enabled && arr ? arr.filter(pt => t1NsSet.has(pt.n)) : []
      } else if (key.startsWith('type2')) {
        result[key] = type2Enabled && arr ? arr.filter(pt => t2NsSet.has(pt.n)) : []
      } else {
        result[key] = arr || []
      }
    }
    return result
  }, [signalData, selectedType1Ns, selectedType2Ns, type1Enabled, type2Enabled])

  const rrLabel = RR_FIELDS.find(f => f.value === selectedRRField)?.label || 'RR'

  // Build equity curve traces from filtered data
  const equityCurveTraces = useMemo(() => {
    if (!filteredSignalData) return []
    return [
      { key: 'type1Up', color: '#22c55e', name: 'Type1 UP' },
      { key: 'type1Dn', color: '#ef4444', name: 'Type1 DN' },
      { key: 'type2Up', color: '#4ade80', name: 'Type2 UP', dash: 'dot' },
      { key: 'type2Dn', color: '#f87171', name: 'Type2 DN', dash: 'dot' },
    ]
      .filter(s => filteredSignalData[s.key]?.length > 0)
      .map(s => {
        const arr = filteredSignalData[s.key]
        let cum = 0
        const xs = []
        const ys = []
        arr.forEach((pt, i) => {
          cum += (pt[selectedRRField] ?? 0)
          xs.push(i + 1)
          ys.push(Math.round(cum * 100) / 100)
        })
        return {
          x: xs,
          y: ys,
          type: 'scatter',
          mode: 'lines',
          name: s.name,
          line: { color: s.color, width: 2, dash: s.dash },
          hovertemplate: `%{y:.2f} ${rrLabel}<extra>%{fullData.name}</extra>`,
        }
      })
  }, [filteredSignalData, selectedRRField, rrLabel])

  // Build combined UP+DN traces (interleaved chronologically by row index)
  const comboCurveTraces = useMemo(() => {
    if (!filteredSignalData) return []
    const combos = [
      { upKey: 'type1Up', dnKey: 'type1Dn', color: '#facc15', name: 'Type1 Combo' },
      { upKey: 'type2Up', dnKey: 'type2Dn', color: '#fb923c', name: 'Type2 Combo', dash: 'dot' },
    ]
    return combos
      .map(c => {
        const ups = filteredSignalData[c.upKey] || []
        const dns = filteredSignalData[c.dnKey] || []
        const merged = [...ups, ...dns].sort((a, b) => a.idx - b.idx)
        if (merged.length === 0) return null
        let cum = 0
        const xs = []
        const ys = []
        merged.forEach((pt, i) => {
          cum += (pt[selectedRRField] ?? 0)
          xs.push(i + 1)
          ys.push(Math.round(cum * 100) / 100)
        })
        return {
          x: xs,
          y: ys,
          type: 'scatter',
          mode: 'lines',
          name: c.name,
          line: { color: c.color, width: 2, dash: c.dash },
          hovertemplate: `%{y:.2f} ${rrLabel}<extra>%{fullData.name}</extra>`,
        }
      })
      .filter(Boolean)
  }, [filteredSignalData, selectedRRField, rrLabel])

  // Compute signal type stats from filtered data
  const type1Stats = useMemo(() => {
    if (!filteredSignalData.type1Up && !filteredSignalData.type1Dn) return null
    return computeSignalStats(filteredSignalData.type1Up || [], filteredSignalData.type1Dn || [], selectedRRField)
  }, [filteredSignalData, selectedRRField])

  const type2Stats = useMemo(() => {
    if (!filteredSignalData.type2Up && !filteredSignalData.type2Dn) return null
    return computeSignalStats(filteredSignalData.type2Up || [], filteredSignalData.type2Dn || [], selectedRRField)
  }, [filteredSignalData, selectedRRField])

  // Compute Module 3: Signal performance by chop regime (respects signal filter)
  const chopSignalPerf = useMemo(() => {
    if (!filteredSignalData) return null
    const regimes = [
      { key: 'low', label: 'Low (<0.2)', test: v => v < 0.2 },
      { key: 'mid', label: 'Mid (0.2-0.4)', test: v => v >= 0.2 && v <= 0.4 },
      { key: 'high', label: 'High (>0.4)', test: v => v > 0.4 },
    ]
    const getRR = (pt) => pt[selectedRRField] ?? 0
    const result = regimes.map(r => {
      const t1 = [...(filteredSignalData.type1Up || []), ...(filteredSignalData.type1Dn || [])].filter(pt => pt.chop != null && r.test(pt.chop))
      const t2 = [...(filteredSignalData.type2Up || []), ...(filteredSignalData.type2Dn || [])].filter(pt => pt.chop != null && r.test(pt.chop))
      const calc = (arr) => {
        if (arr.length === 0) return { count: 0, winPct: 0, avgRR: 0 }
        const wins = arr.filter(pt => getRR(pt) > 0).length
        const sum = arr.reduce((s, pt) => s + getRR(pt), 0)
        return {
          count: arr.length,
          winPct: (wins / arr.length * 100).toFixed(0),
          avgRR: (sum / arr.length).toFixed(2),
        }
      }
      return { ...r, type1: calc(t1), type2: calc(t2) }
    })
    return result
  }, [filteredSignalData, selectedRRField])

  const hasSignalData = signalData && Object.values(signalData).some(a => a?.length > 0)

  // Per-type chip toggle handlers
  const toggleType1N = (n) => {
    setSelectedType1Ns(prev =>
      prev.includes(n) ? prev.filter(v => v !== n) : [...prev, n].sort((a, b) => a - b)
    )
  }
  const toggleAllType1 = () => {
    setSelectedType1Ns(prev => prev.length === type1NValues.length ? [] : [...type1NValues])
  }
  const toggleType2N = (n) => {
    setSelectedType2Ns(prev =>
      prev.includes(n) ? prev.filter(v => v !== n) : [...prev, n].sort((a, b) => a - b)
    )
  }
  const toggleAllType2 = () => {
    setSelectedType2Ns(prev => prev.length === type2NValues.length ? [] : [...type2NValues])
  }

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

  const { totalBars, upBars, dnBars, maStats, allMaStats, runStats, chopStats, stateStats, settings, beyondMaStats, beyondAllMaStats, emaRrDecay, wickDist, chopRegimeStats, stateConbarsHeatmap, stateTransitionMatrix } = stats

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

  // Render a signal type stats module
  const renderSignalModule = (title, typeStats, tooltip) => {
    if (!typeStats) return null
    const { upSummary, dnSummary, upNth, dnNth, upDist, dnDist } = typeStats
    if (upSummary.count === 0 && dnSummary.count === 0) return null

    // Merge Nth rows: union of all N values from both sides
    const allNs = new Set([...upNth.map(r => r.n), ...dnNth.map(r => r.n)])
    const nthRows = Array.from(allNs).sort((a, b) => a - b).map(n => ({
      n,
      up: upNth.find(r => r.n === n),
      dn: dnNth.find(r => r.n === n),
    }))

    return (
      <div className="stats-module">
        {/* Summary */}
        <table className="stats-table">
          <thead>
            <tr className="module-title-row">
              <th colSpan="3" className="module-title" data-tooltip={tooltip}>{title}</th>
            </tr>
            <tr>
              <th></th>
              <th className="up">UP</th>
              <th className="dn">DN</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Count</td>
              <td className="up">{upSummary.count}</td>
              <td className="dn">{dnSummary.count}</td>
            </tr>
            <tr>
              <td>Avg RR</td>
              <td className="up">{upSummary.avgRR}</td>
              <td className="dn">{dnSummary.avgRR}</td>
            </tr>
            <tr>
              <td>Win Rate</td>
              <td className="up">{upSummary.winRate}%</td>
              <td className="dn">{dnSummary.winRate}%</td>
            </tr>
          </tbody>
        </table>

        {/* Nth Occurrence Breakdown */}
        {nthRows.length > 0 && (
          <table className="stats-table signal-nth-table">
            <thead>
              <tr className="module-title-row">
                <th colSpan="7" className="module-title">NTH OCCURRENCE</th>
              </tr>
              <tr>
                <th>N</th>
                <th className="up">UP Count</th>
                <th className="up">UP Avg RR</th>
                <th className="up">UP Win%</th>
                <th className="dn">DN Count</th>
                <th className="dn">DN Avg RR</th>
                <th className="dn">DN Win%</th>
              </tr>
            </thead>
            <tbody>
              {nthRows.map(row => (
                <tr key={row.n}>
                  <td>{row.n}</td>
                  <td className="up">{row.up?.count ?? ''}</td>
                  <td className="up">{row.up?.avgRR ?? ''}</td>
                  <td className="up">{row.up ? `${row.up.winRate}%` : ''}</td>
                  <td className="dn">{row.dn?.count ?? ''}</td>
                  <td className="dn">{row.dn?.avgRR ?? ''}</td>
                  <td className="dn">{row.dn ? `${row.dn.winRate}%` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* RR Distribution */}
        <table className="stats-table signal-dist-table">
          <thead>
            <tr className="module-title-row">
              <th colSpan="5" className="module-title">RR DISTRIBUTION</th>
            </tr>
            <tr>
              <th>RR</th>
              <th className="up">UP Count</th>
              <th className="up">UP %</th>
              <th className="dn">DN Count</th>
              <th className="dn">DN %</th>
            </tr>
          </thead>
          <tbody>
            {upDist.map((row, i) => {
              const dnRow = dnDist[i]
              return (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="up">{row.count}</td>
                  <td className="up">{row.pct}%</td>
                  <td className="dn">{dnRow.count}</td>
                  <td className="dn">{dnRow.pct}%</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div className="stats-page">
      {/* Top bar: file header + tabs + settings in one line */}
      <div className="stats-top-bar">
        <div className="stats-file-header">
          <span className="stats-filename">{filename}</span>
          <span className="stats-total">{totalBars.toLocaleString()} bars</span>
        </div>
        <div className="stats-tabs">
          <button
            className={`stats-tab ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >General Stats</button>
          <button
            className={`stats-tab ${activeTab === 'signals' ? 'active' : ''}`}
            onClick={() => setActiveTab('signals')}
          >Type1/Type2 Stats</button>
        </div>
        {settings && (
          <div className="settings-inline">
            <span className="settings-inline-item"><span className="settings-inline-label">Brick:</span><span className="settings-inline-val">{settings.brickSize}</span></span>
            <span className="settings-inline-sep" />
            <span className="settings-inline-item"><span className="settings-inline-label">Rev:</span><span className="settings-inline-val">{settings.reversalSize}</span></span>
            <span className="settings-inline-sep" />
            <span className="settings-inline-item"><span className="settings-inline-label">Wicks:</span><span className="settings-inline-val">{settings.wickMode}</span></span>
            <span className="settings-inline-sep" />
            <span className="settings-inline-item"><span className="settings-inline-label">ADR:</span><span className="settings-inline-val">{settings.adrPeriod}</span></span>
            <span className="settings-inline-sep" />
            <span className="settings-inline-item"><span className="settings-inline-label">Chop:</span><span className="settings-inline-val">{settings.chopPeriod}</span></span>
            <span className="settings-inline-sep" />
            <span className="settings-inline-item"><span className="settings-inline-label">MA1:</span><span className="settings-inline-val">{settings.ma1Period}</span></span>
            <span className="settings-inline-sep" />
            <span className="settings-inline-item"><span className="settings-inline-label">MA2:</span><span className="settings-inline-val">{settings.ma2Period}</span></span>
            <span className="settings-inline-sep" />
            <span className="settings-inline-item"><span className="settings-inline-label">MA3:</span><span className="settings-inline-val">{settings.ma3Period}</span></span>
          </div>
        )}
      </div>

      {/* ==================== Type1/Type2 Stats Tab ==================== */}
      {activeTab === 'signals' && (
        <div className="stats-tab-content">
          {/* Module 1: Cumulative R Curve */}
          {hasSignalData && (
            <div className="stats-module equity-curve-module module-box">
              <div className="equity-curve-header">
                <span className="module-title-text">CUMULATIVE R CURVE</span>
                <select
                  className="fx-column-select"
                  value={selectedRRField}
                  onChange={e => setSelectedRRField(e.target.value)}
                >
                  {RR_FIELDS.map(f => (
                    <option key={f.value} value={f.value} title={f.desc}>{f.label}</option>
                  ))}
                </select>
              </div>
              <div className="curve-filters-toggle">
                <span className="curve-filters-toggle-left" onClick={() => setFiltersOpen(prev => !prev)}>
                  <span className={`collapse-arrow ${filtersOpen ? 'open' : ''}`}>&#9654;</span>
                  <span className="collapse-label">Filters</span>
                </span>
                <span className="curve-filters-toggle-actions">
                  <button className="filter-action-btn" onClick={() => {
                    setType1Enabled(true); setType2Enabled(true)
                    setSelectedType1Ns([...type1NValues]); setSelectedType2Ns([...type2NValues])
                  }}>Select All</button>
                  <button className="filter-action-btn" onClick={() => {
                    setType1Enabled(false); setType2Enabled(false)
                    setSelectedType1Ns([]); setSelectedType2Ns([])
                  }}>Deselect All</button>
                  <button
                    className={`filter-action-btn ${comboMode ? 'active' : ''}`}
                    onClick={() => setComboMode(prev => !prev)}
                  >Combo</button>
                </span>
              </div>
              {filtersOpen && (
                <div className="curve-filters-panel">
                  {type1NValues.length > 0 && (
                    <div className="filter-group">
                      <button
                        className={`nth-chip type-toggle ${type1Enabled ? 'active' : ''}`}
                        onClick={() => setType1Enabled(prev => !prev)}
                      >T1</button>
                      <button
                        className={`nth-chip ${selectedType1Ns.length === type1NValues.length ? 'active' : ''}`}
                        onClick={toggleAllType1}
                      >All</button>
                      {type1NValues.map(n => (
                        <button
                          key={n}
                          className={`nth-chip ${selectedType1Ns.includes(n) ? 'active' : ''}`}
                          onClick={() => toggleType1N(n)}
                        >{n}</button>
                      ))}
                    </div>
                  )}
                  {type2NValues.length > 0 && (
                    <div className="filter-group">
                      <button
                        className={`nth-chip type-toggle ${type2Enabled ? 'active' : ''}`}
                        onClick={() => setType2Enabled(prev => !prev)}
                      >T2</button>
                      <button
                        className={`nth-chip ${selectedType2Ns.length === type2NValues.length ? 'active' : ''}`}
                        onClick={toggleAllType2}
                      >All</button>
                      {type2NValues.map(n => (
                        <button
                          key={n}
                          className={`nth-chip ${selectedType2Ns.includes(n) ? 'active' : ''}`}
                          onClick={() => toggleType2N(n)}
                        >{n}</button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {(comboMode ? comboCurveTraces : equityCurveTraces).length > 0 && (
                <Plot
                  data={comboMode ? comboCurveTraces : equityCurveTraces}
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
              )}
            </div>
          )}

          {/* Module 2: Signal Type Performance */}
          <div className="signal-modules-row module-box">
            {renderSignalModule('SIGNAL TYPE 1', type1Stats, 'Type1 pullback signal performance (MA1 touch reversal pattern in +3/-3 state)')}
            {renderSignalModule('SIGNAL TYPE 2', type2Stats, 'Type2 wick signal performance (wicked bars in +3/-3 state)')}
          </div>

          {/* Module 3: Chop Regime Stats */}
          {chopRegimeStats && (
            <div className="module-box chop-regime-module">
              <div className="chop-regime-tables">
                {/* Table 1: Chop Regime Overview */}
                <table className="stats-table">
                  <thead>
                    <tr className="module-title-row">
                      <th colSpan="4" className="module-title" data-tooltip="Bar count and UP/DN breakdown per chop regime (all bars)">CHOP REGIME OVERVIEW</th>
                    </tr>
                    <tr>
                      <th></th>
                      {chopRegimeStats.overview.map(r => <th key={r.key}>{r.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>Bar count</td>
                      {chopRegimeStats.overview.map(r => <td key={r.key}>{r.count.toLocaleString()}</td>)}
                    </tr>
                    <tr>
                      <td>UP %</td>
                      {chopRegimeStats.overview.map(r => <td key={r.key} className="up">{r.upPct}%</td>)}
                    </tr>
                    <tr>
                      <td>DN %</td>
                      {chopRegimeStats.overview.map(r => <td key={r.key} className="dn">{r.dnPct}%</td>)}
                    </tr>
                  </tbody>
                </table>

                {/* Table 2: State Distribution by Chop Regime */}
                {chopRegimeStats.stateByChop?.length > 0 && (
                  <table className="stats-table">
                    <thead>
                      <tr className="module-title-row">
                        <th colSpan="4" className="module-title" data-tooltip="State distribution within each chop regime (all bars)">STATE DISTRIBUTION BY CHOP</th>
                      </tr>
                      <tr>
                        <th>State</th>
                        <th>Low (&lt;0.2)</th>
                        <th>Mid (0.2-0.4)</th>
                        <th>High (&gt;0.4)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chopRegimeStats.stateByChop.map(row => (
                        <tr key={row.state}>
                          <td className={row.state > 0 ? 'state-up' : row.state < 0 ? 'state-dn' : ''}>
                            {row.state > 0 ? `+${row.state}` : row.state}
                          </td>
                          <td>{row.low}%</td>
                          <td>{row.mid}%</td>
                          <td>{row.high}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Table 3: Signal Performance by Chop Regime */}
                {chopSignalPerf && (
                  <table className="stats-table">
                    <thead>
                      <tr className="module-title-row">
                        <th colSpan="4" className="module-title" data-tooltip="Signal performance within each chop regime (signal bars only, respects filters)">SIGNAL PERF BY CHOP</th>
                      </tr>
                      <tr>
                        <th></th>
                        <th>Low (&lt;0.2)</th>
                        <th>Mid (0.2-0.4)</th>
                        <th>High (&gt;0.4)</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr><td>Type1 count</td>{chopSignalPerf.map(r => <td key={r.key}>{r.type1.count}</td>)}</tr>
                      <tr><td>Type1 win %</td>{chopSignalPerf.map(r => <td key={r.key}>{r.type1.winPct}%</td>)}</tr>
                      <tr><td>Type1 avg RR</td>{chopSignalPerf.map(r => <td key={r.key}>{r.type1.avgRR}</td>)}</tr>
                      <tr><td>Type2 count</td>{chopSignalPerf.map(r => <td key={r.key}>{r.type2.count}</td>)}</tr>
                      <tr><td>Type2 win %</td>{chopSignalPerf.map(r => <td key={r.key}>{r.type2.winPct}%</td>)}</tr>
                      <tr><td>Type2 avg RR</td>{chopSignalPerf.map(r => <td key={r.key}>{r.type2.avgRR}</td>)}</tr>
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ==================== General Stats Tab ==================== */}
      {activeTab === 'general' && (
        <div className="stats-tab-content">
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

          {/* Module 5: State x Consecutive Bars Heatmap */}
          {stateConbarsHeatmap && stateConbarsHeatmap.length > 0 && (() => {
            const states = [3, 2, 1, -1, -2, -3];
            const stateLabels = { 3: '+3', 2: '+2', 1: '+1', '-1': '-1', '-2': '-2', '-3': '-3' };
            // Color scale: green for positive RR, red for negative, white/neutral for zero
            const cellBg = (avgRR) => {
              if (avgRR === null || avgRR === undefined) return 'transparent';
              const clamped = Math.max(-3, Math.min(3, avgRR));
              if (clamped >= 0) {
                const intensity = Math.min(clamped / 3, 1);
                return `rgba(34, 197, 94, ${(intensity * 0.45 + 0.05).toFixed(2)})`;
              } else {
                const intensity = Math.min(Math.abs(clamped) / 3, 1);
                return `rgba(239, 68, 68, ${(intensity * 0.45 + 0.05).toFixed(2)})`;
              }
            };
            const conBarsRange = stateConbarsHeatmap.map(r => r.conBars);
            return (
              <div className="stats-module">
                <table className="stats-table">
                  <thead>
                    <tr className="module-title-row">
                      <th colSpan={conBarsRange.length + 1} className="module-title" data-tooltip="Average FX_clr_RR by State and consecutive bar count. Green = positive RR, Red = negative. Shows sample count in parentheses.">RR per CONSECUTIVE BAR IN A GIVEN STATE</th>
                    </tr>
                    <tr>
                      <th>State</th>
                      {conBarsRange.map(c => (
                        <th key={c}>{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {states.map(s => (
                      <tr key={s}>
                        <td className={s > 0 ? 'up' : 'dn'}>{stateLabels[s]}</td>
                        {stateConbarsHeatmap.map(row => {
                          const count = row[`s${s}_count`];
                          const avgRR = row[`s${s}_avgRR`];
                          const dir = s > 0 ? 'up' : 'down';
                          const ordinal = row.conBars === 1 ? '1st' : row.conBars === 2 ? '2nd' : row.conBars === 3 ? '3rd' : `${row.conBars}th`;
                          const tooltip = count > 0
                            ? `When I'm on the ${ordinal} consecutive ${dir} bar in State ${stateLabels[s]}, the bars in that situation averaged ${avgRR.toFixed(2)} RR`
                            : null;
                          return (
                            <td key={row.conBars} style={{ background: cellBg(avgRR), textAlign: 'center' }} title={tooltip}>
                              {count > 0 ? (
                                <span>
                                  <span style={{ fontWeight: 600 }}>{avgRR.toFixed(2)}</span>
                                  <span style={{ fontSize: '10px', opacity: 0.5, marginLeft: '3px' }}>({count})</span>
                                </span>
                              ) : (
                                <span style={{ opacity: 0.25 }}>—</span>
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* Module 6: State Transition Matrix */}
          {stateTransitionMatrix && stateTransitionMatrix.length > 0 && (() => {
            const states = [3, 2, 1, -1, -2, -3];
            const stateLabels = { 3: '+3', 2: '+2', 1: '+1', '-1': '-1', '-2': '-2', '-3': '-3' };
            const cellBg = (pct, isDiagonal) => {
              if (isDiagonal) {
                const intensity = Math.min(pct / 100, 1);
                return `rgba(255, 193, 7, ${(intensity * 0.5 + 0.05).toFixed(2)})`;
              }
              const intensity = Math.min(pct / 50, 1);
              return `rgba(147, 130, 220, ${(intensity * 0.4).toFixed(2)})`;
            };
            return (
              <div className="stats-module">
                <table className="stats-table">
                  <thead>
                    <tr className="module-title-row">
                      <th colSpan={states.length + 1} className="module-title" data-tooltip="Probability of transitioning from one State (row) to another (column). Diagonal = persistence. Color intensity by probability.">STATE TRANSITION MATRIX</th>
                    </tr>
                    <tr>
                      <th data-tooltip="Prior State (row) → Current State (column)">From \ To</th>
                      {states.map(s => (
                        <th key={s} className={s > 0 ? 'up' : 'dn'}>{stateLabels[s]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stateTransitionMatrix.map(row => (
                      <tr key={row.fromState}>
                        <td className={row.fromState > 0 ? 'up' : 'dn'}>{stateLabels[row.fromState]}</td>
                        {states.map(toState => {
                          const pct = row[`to_${toState}_pct`];
                          const count = row[`to_${toState}_count`];
                          const isDiagonal = row.fromState === toState;
                          return (
                            <td key={toState} style={{
                              background: cellBg(pct, isDiagonal),
                              textAlign: 'center',
                              fontWeight: isDiagonal ? 700 : 400,
                            }} title={`From State ${stateLabels[row.fromState]} → State ${stateLabels[toState]}: ${pct}% (${count} bars)`}>
                              {pct}%
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  )
}

export default StatsPage
