import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import ReactDOM from 'react-dom'
import Plot from 'react-plotly.js'
import { COLUMN_DESCRIPTIONS, ColumnItem } from '../utils/columnDescriptions'
import BacktestChart from './BacktestChart'
import './StatsPage.css'

const STORAGE_PREFIX = 'RenkoDiscovery_'

const RR_FIELDS = [
  { value: 'rr', label: 'MFE_clr_RR', desc: 'MFE to color change, reversal-normalized (always >= 0)' },
  { value: 'rr_adj', label: 'REAL_clr_RR', desc: 'MFE_clr_price minus reversal_size, reversal-normalized. Realistic exit estimate (can be negative)' },
  { value: 'clr_adr', label: 'MFE_clr_ADR', desc: 'MFE to color change, ADR-normalized (always >= 0)' },
  { value: 'clr_adr_adj', label: 'REAL_clr_ADR', desc: 'MFE_clr_price minus reversal_size, ADR-normalized. Realistic exit estimate (can be negative)' },
  { value: 'ma1_rr', label: 'REAL_MA1_RR', desc: 'Move until price closes beyond MA1, reversal-normalized' },
  { value: 'ma1_adr', label: 'REAL_MA1_ADR', desc: 'Move until price closes beyond MA1, ADR-normalized' },
  { value: 'ma2_rr', label: 'REAL_MA2_RR', desc: 'Move until price closes beyond MA2, reversal-normalized' },
  { value: 'ma2_adr', label: 'REAL_MA2_ADR', desc: 'Move until price closes beyond MA2, ADR-normalized' },
  { value: 'ma3_rr', label: 'REAL_MA3_RR', desc: 'Move until price closes beyond MA3, reversal-normalized' },
  { value: 'ma3_adr', label: 'REAL_MA3_ADR', desc: 'Move until price closes beyond MA3, ADR-normalized' },
]

const RR_BUCKETS = [
  { label: '<=0',      test: v => v <= 0 },
  { label: '>0 to <1', test: v => v > 0 && v < 1 },
  { label: '1 to <2',  test: v => v >= 1 && v < 2 },
  { label: '2 to <3',  test: v => v >= 2 && v < 3 },
  { label: '3 to <5',  test: v => v >= 3 && v < 5 },
  { label: '5+',       test: v => v >= 5 },
]

const PLAYGROUND_COLORS = [
  '#3b82f6', '#f59e0b', '#a855f7', '#22c55e', '#ef4444',
  '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#6366f1',
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

// --- Client-side stat computation helpers ---
function pick(arr, indices) {
  if (!indices) return arr
  return indices.map(i => arr[i])
}

function computeHemisphere(bd, indices, maPeriods) {
  const open = pick(bd.open, indices)
  const close = pick(bd.close, indices)
  const total = open.length
  const isUp = close.map((c, i) => c > open[i])
  const isDn = close.map((c, i) => c < open[i])

  // Load raw distance arrays for each MA
  const rawArrays = maPeriods.map(period => {
    const key = `emaRaw${period}`
    return bd[key] ? pick(bd[key], indices) : null
  })

  // All 7 combos: indices into maPeriods
  const combos = [
    { idxs: [0], label: `MA(${maPeriods[0]})` },
    { idxs: [1], label: `MA(${maPeriods[1]})` },
    { idxs: [2], label: `MA(${maPeriods[2]})` },
    'sep',
    { idxs: [0, 1], label: `MA(${maPeriods[0]}+${maPeriods[1]})` },
    { idxs: [0, 2], label: `MA(${maPeriods[0]}+${maPeriods[2]})` },
    { idxs: [1, 2], label: `MA(${maPeriods[1]}+${maPeriods[2]})` },
    'sep',
    { idxs: [0, 1, 2], label: `MA(${maPeriods[0]}+${maPeriods[1]}+${maPeriods[2]})` },
  ]

  return combos.map(combo => {
    if (combo === 'sep') return 'sep'
    const { idxs, label } = combo
    const buy = { count: 0, up: 0, dn: 0 }
    const sell = { count: 0, up: 0, dn: 0 }
    const neutral = { count: 0, up: 0, dn: 0 }

    // Check if all required raw arrays exist
    const comboRaws = idxs.map(j => rawArrays[j])
    if (comboRaws.some(r => r === null)) return { label, idxs, buy, sell, neutral }

    for (let i = 0; i < total; i++) {
      // Get raw distances for this bar
      const dists = comboRaws.map(r => r[i])
      if (dists.some(d => d == null)) continue

      const allAbove = dists.every(d => d > 0)
      const allBelow = dists.every(d => d < 0)

      let zone = neutral
      if (allAbove && idxs.length === 1) {
        zone = buy
      } else if (allBelow && idxs.length === 1) {
        zone = sell
      } else if (allAbove && idxs.length > 1) {
        // Check bullish stacking: for each pair (faster, slower), rawDist_faster < rawDist_slower
        let stacked = true
        for (let p = 0; p < idxs.length - 1 && stacked; p++) {
          if (dists[p] >= dists[p + 1]) stacked = false
        }
        zone = stacked ? buy : neutral
      } else if (allBelow && idxs.length > 1) {
        // Check bearish stacking: for each pair (faster, slower), rawDist_faster > rawDist_slower
        let stacked = true
        for (let p = 0; p < idxs.length - 1 && stacked; p++) {
          if (dists[p] <= dists[p + 1]) stacked = false
        }
        zone = stacked ? sell : neutral
      }

      zone.count++
      if (isUp[i]) zone.up++
      if (isDn[i]) zone.dn++
    }

    return { label, idxs, buy, sell, neutral }
  })
}

const stateMAOrder = {
  3: 'fast>med>slow', 2: 'fast>slow>med', 1: 'slow>fast>med',
  '-1': 'med>fast>slow', '-2': 'med>slow>fast', '-3': 'slow>med>fast',
};

function StatsPage({ stats, filename, filepath, isLoading, onDelete, apiBase }) {
  const signalData = stats?.signalData
  const brickEqReversal = stats?.settings?.brickSize != null && stats.settings.brickSize === stats.settings.reversalSize

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
    const validTabs = ['general', 'signals', 'playground', 'backtest', 'optimizer']
    return validTabs.includes(saved) ? saved : 'general'
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

  // Signal Quality Filter state
  const SQF_DEFAULTS = { ema1: { upEnabled: false, dnEnabled: false, upRange: [null, null], dnRange: [null, null] }, ema2: { upEnabled: false, dnEnabled: false, upRange: [null, null], dnRange: [null, null] }, ema3: { upEnabled: false, dnEnabled: false, upRange: [null, null], dnRange: [null, null] }, dd: { upEnabled: false, dnEnabled: false, upRange: [null, null], dnRange: [null, null] }, prRunCnt: { upEnabled: false, dnEnabled: false, upRange: [null, null], dnRange: [null, null] }, conBars: { upEnabled: false, dnEnabled: false, upRange: [null, null], dnRange: [null, null] }, stateDur: { upEnabled: false, dnEnabled: false, upRange: [null, null], dnRange: [null, null] }, barDur: { upEnabled: false, dnEnabled: false, upRange: [null, null], dnRange: [null, null] } }
  const [sqfNormMode, setSqfNormMode] = useState(() => {
    return localStorage.getItem(`${STORAGE_PREFIX}sqfNormMode`) || 'rr'
  })
  const [sqfPanelOpenT1, setSqfPanelOpenT1] = useState(() => {
    return localStorage.getItem(`${STORAGE_PREFIX}sqfPanelOpenT1`) === 'true'
  })
  const [sqfPanelOpenT2, setSqfPanelOpenT2] = useState(() => {
    return localStorage.getItem(`${STORAGE_PREFIX}sqfPanelOpenT2`) === 'true'
  })
  const [sqfFilters, setSqfFilters] = useState(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}sqfFilters`)
      if (saved) {
        const parsed = JSON.parse(saved)
        // Migration: old flat shape → new nested shape
        if (parsed.ema1 && !parsed.t1) return { t1: parsed, t2: SQF_DEFAULTS }
        return parsed
      }
      return { t1: SQF_DEFAULTS, t2: SQF_DEFAULTS }
    } catch { return { t1: SQF_DEFAULTS, t2: SQF_DEFAULTS } }
  })

  // Expectancy heatmap column selector
  const [expectancyCol, setExpectancyCol] = useState(() => {
    return localStorage.getItem(`${STORAGE_PREFIX}expectancyCol`) || 'realClrRR'
  })
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}expectancyCol`, expectancyCol)
  }, [expectancyCol])

  const expectancyColumns = [
    { value: 'realClrRR', label: 'REAL Clr RR' },
    { value: 'mfeClrRR', label: 'MFE Clr RR' },
    { value: 'realClrADR', label: 'REAL Clr ADR' },
    { value: 'mfeClrADR', label: 'MFE Clr ADR' },
    { value: 'realMA1RR', label: 'REAL MA1 RR' },
    { value: 'realMA2RR', label: 'REAL MA2 RR' },
    { value: 'realMA3RR', label: 'REAL MA3 RR' },
    { value: 'realMA1ADR', label: 'REAL MA1 ADR' },
    { value: 'realMA2ADR', label: 'REAL MA2 ADR' },
    { value: 'realMA3ADR', label: 'REAL MA3 ADR' },
  ]

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}sqfNormMode`, sqfNormMode)
  }, [sqfNormMode])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}sqfPanelOpenT1`, sqfPanelOpenT1.toString())
  }, [sqfPanelOpenT1])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}sqfPanelOpenT2`, sqfPanelOpenT2.toString())
  }, [sqfPanelOpenT2])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}sqfFilters`, JSON.stringify(sqfFilters))
  }, [sqfFilters])

  const updateSqfFilter = (type, group, field, value) => {
    setSqfFilters(prev => {
      const updated = { ...prev[type][group], [field]: value }
      // When enabling, seed null range values from data bounds
      if (value === true && sqfBounds?.[type]?.[group]) {
        const dir = field === 'upEnabled' ? 'up' : 'dn'
        const rangeKey = field === 'upEnabled' ? 'upRange' : 'dnRange'
        const bounds = sqfBounds[type][group][dir]
        const range = updated[rangeKey]
        if (range[0] == null || range[1] == null) {
          updated[rangeKey] = [
            range[0] ?? bounds[0],
            range[1] ?? bounds[1],
          ]
        }
      }
      return { ...prev, [type]: { ...prev[type], [group]: updated } }
    })
  }
  const updateSqfRange = (type, group, rangeKey, idx, value) => {
    setSqfFilters(prev => {
      const range = [...prev[type][group][rangeKey]]
      range[idx] = value === '' ? null : parseFloat(value)
      return { ...prev, [type]: { ...prev[type], [group]: { ...prev[type][group], [rangeKey]: range } } }
    })
  }

  // ==================== Playground Tab State ====================
  const [playgroundSignals, setPlaygroundSignals] = useState(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}playgroundSignals`)
      if (saved) return JSON.parse(saved)
    } catch {}
    return [{ name: 'Signal 1', expression: '', enabled: true }]
  })
  const [playgroundData, setPlaygroundData] = useState({ signals: {}, errors: {} })
  const [playgroundLoading, setPlaygroundLoading] = useState(false)
  const [playgroundRRField, setPlaygroundRRField] = useState('rr')
  const [pgComboMode, setPgComboMode] = useState(false)
  const [showPlaygroundHelp, setShowPlaygroundHelp] = useState(false)
  const [pgHelpPos, setPgHelpPos] = useState({ x: 200, y: 100 })
  const [pgDragging, setPgDragging] = useState(false)
  const pgDragOffset = useRef({ x: 0, y: 0 })
  const [savedSignals, setSavedSignals] = useState([])
  const [showLoadDropdown, setShowLoadDropdown] = useState(false)
  const loadDropdownRef = useRef(null)
  const [saveToastVisible, setSaveToastVisible] = useState(false)
  const saveToastTimer = useRef(null)

  // Persist playground signals to localStorage
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}playgroundSignals`, JSON.stringify(playgroundSignals))
  }, [playgroundSignals])

  // Help panel drag effect
  useEffect(() => {
    if (!pgDragging) return
    const onMouseMove = (e) => {
      setPgHelpPos({ x: e.clientX - pgDragOffset.current.x, y: e.clientY - pgDragOffset.current.y })
    }
    const onMouseUp = () => setPgDragging(false)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [pgDragging])

  const addPlaygroundSignal = useCallback(() => {
    setPlaygroundSignals(prev => [...prev, { name: `Signal ${prev.length + 1}`, expression: '', enabled: true }])
  }, [])

  const removePlaygroundSignal = useCallback((index) => {
    setPlaygroundSignals(prev => {
      const next = prev.filter((_, i) => i !== index)
      return next.length === 0 ? [{ name: '', expression: '', enabled: true }] : next
    })
  }, [])

  const updatePlaygroundSignal = useCallback((index, field, value) => {
    setPlaygroundSignals(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }, [])

  const togglePlaygroundSignal = useCallback((index) => {
    setPlaygroundSignals(prev => prev.map((s, i) =>
      i === index ? { ...s, enabled: s.enabled === false ? true : false } : s
    ))
  }, [])

  const evaluatePlaygroundSignals = useCallback(async () => {
    if (!filepath || !apiBase) return
    const nonEmpty = playgroundSignals.filter(s => s.expression.trim() && s.enabled !== false)
    if (nonEmpty.length === 0) return
    setPlaygroundLoading(true)
    try {
      const res = await fetch(`${apiBase}/playground-signals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath, signals: nonEmpty }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setPlaygroundData(data)
    } catch (e) {
      setPlaygroundData({ signals: {}, errors: { _global: e.message } })
    } finally {
      setPlaygroundLoading(false)
    }
  }, [filepath, apiBase, playgroundSignals])

  // Fetch saved signals when filepath changes
  useEffect(() => {
    if (!filepath || !apiBase) return
    fetch(`${apiBase}/playground-saved-signals?filepath=${encodeURIComponent(filepath)}`)
      .then(r => r.ok ? r.json() : { signals: [] })
      .then(data => setSavedSignals(data.signals || []))
      .catch(() => setSavedSignals([]))
  }, [filepath, apiBase])

  const savePlaygroundSignal = useCallback(async (signal) => {
    if (!filepath || !apiBase || !signal.name.trim() || !signal.expression.trim()) return
    try {
      const res = await fetch(`${apiBase}/playground-save-signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath, name: signal.name, expression: signal.expression }),
      })
      if (res.ok) {
        const data = await res.json()
        setSavedSignals(data.signals || [])
        setBtSavedSignals(data.signals || [])
        clearTimeout(saveToastTimer.current)
        setSaveToastVisible(true)
        saveToastTimer.current = setTimeout(() => setSaveToastVisible(false), 1500)
      }
    } catch {}
  }, [filepath, apiBase])

  const deletePlaygroundSavedSignal = useCallback(async (name) => {
    if (!filepath || !apiBase) return
    try {
      const res = await fetch(`${apiBase}/playground-delete-signal?filepath=${encodeURIComponent(filepath)}&name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        const data = await res.json()
        setSavedSignals(data.signals || [])
        setBtSavedSignals(data.signals || [])
      }
    } catch {}
  }, [filepath, apiBase])

  const loadPlaygroundSignal = useCallback((saved) => {
    setPlaygroundSignals(prev => {
      const emptyIdx = prev.findIndex(s => !s.expression.trim())
      if (emptyIdx >= 0) {
        return prev.map((s, i) => i === emptyIdx ? { name: saved.name, expression: saved.expression, enabled: true } : s)
      }
      return [...prev, { name: saved.name, expression: saved.expression, enabled: true }]
    })
    setShowLoadDropdown(false)
  }, [])

  // Close load dropdown on outside click
  useEffect(() => {
    if (!showLoadDropdown) return
    const handler = (e) => {
      if (loadDropdownRef.current && !loadDropdownRef.current.contains(e.target)) {
        setShowLoadDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showLoadDropdown])

  // Memoized R-Curve traces for playground
  const playgroundCurveTraces = useMemo(() => {
    const traces = []
    const sigs = playgroundData.signals || {}
    playgroundSignals.forEach((signal, i) => {
      if (signal.enabled === false) return
      const points = sigs[signal.name]
      if (!points || points.length === 0) return
      const sorted = [...points].sort((a, b) => a.idx - b.idx)
      const rrKey = playgroundRRField
      let cumulative = 0
      const x = []
      const y = []
      sorted.forEach((pt, j) => {
        cumulative += (pt[rrKey] ?? 0)
        x.push(j + 1)
        y.push(parseFloat(cumulative.toFixed(2)))
      })
      traces.push({
        x, y,
        type: 'scatter',
        mode: 'lines',
        name: signal.name,
        line: { color: PLAYGROUND_COLORS[i % PLAYGROUND_COLORS.length], width: 1.5 },
      })
    })
    return traces
  }, [playgroundData, playgroundSignals, playgroundRRField])

  // Memoized combo R-Curve trace for playground
  const pgComboCurveTraces = useMemo(() => {
    const sigs = playgroundData.signals || {}
    const rrKey = playgroundRRField
    const allPoints = []
    playgroundSignals.forEach((signal) => {
      if (signal.enabled === false) return
      const points = sigs[signal.name]
      if (!points || points.length === 0) return
      points.forEach(pt => allPoints.push({ idx: pt.idx, rr: pt[rrKey] ?? 0 }))
    })
    if (allPoints.length === 0) return []
    allPoints.sort((a, b) => a.idx - b.idx)
    let cumulative = 0
    const x = []
    const y = []
    allPoints.forEach((pt, j) => {
      cumulative += pt.rr
      x.push(j + 1)
      y.push(parseFloat(cumulative.toFixed(2)))
    })
    return [{
      x, y,
      type: 'scatter',
      mode: 'lines',
      name: 'Combo',
      line: { color: '#facc15', width: 1.5 },
    }]
  }, [playgroundData, playgroundSignals, playgroundRRField])

  // Memoized stats for playground signals
  const playgroundStats = useMemo(() => {
    const sigs = playgroundData.signals || {}
    const result = {}
    playgroundSignals.forEach((signal) => {
      if (signal.enabled === false) return
      const points = sigs[signal.name]
      if (!points || points.length === 0) return
      const rrKey = playgroundRRField
      const values = points.map(p => p[rrKey] ?? 0)
      const count = values.length
      const sum = values.reduce((s, v) => s + v, 0)
      const avgRR = (sum / count).toFixed(2)
      const wins = values.filter(v => v > 0).length
      const winRate = (wins / count * 100).toFixed(0)
      const dist = RR_BUCKETS.map(b => {
        const cnt = values.filter(b.test).length
        return { label: b.label, count: cnt, pct: count > 0 ? (cnt / count * 100).toFixed(1) : '0.0' }
      })
      result[signal.name] = { count, avgRR, winRate, dist }
    })
    return result
  }, [playgroundData, playgroundSignals, playgroundRRField])

  // Memoized combo stats for playground
  const pgComboStats = useMemo(() => {
    const sigs = playgroundData.signals || {}
    const rrKey = playgroundRRField
    const allValues = []
    playgroundSignals.forEach((signal) => {
      if (signal.enabled === false) return
      const points = sigs[signal.name]
      if (!points || points.length === 0) return
      points.forEach(p => allValues.push(p[rrKey] ?? 0))
    })
    if (allValues.length === 0) return null
    const count = allValues.length
    const sum = allValues.reduce((s, v) => s + v, 0)
    const avgRR = (sum / count).toFixed(2)
    const wins = allValues.filter(v => v > 0).length
    const winRate = (wins / count * 100).toFixed(0)
    const dist = RR_BUCKETS.map(b => {
      const cnt = allValues.filter(b.test).length
      return { label: b.label, count: cnt, pct: count > 0 ? (cnt / count * 100).toFixed(1) : '0.0' }
    })
    return { count, avgRR, winRate, dist }
  }, [playgroundData, playgroundSignals, playgroundRRField])

  // ==================== Backtest Tab State ====================
  const [btSignals, setBtSignals] = useState(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}btSignals`)
      if (saved) return JSON.parse(saved)
    } catch {}
    return [{ name: 'Signal 1', expression: '', enabled: true }]
  })
  const [btStopType, setBtStopType] = useState(() => localStorage.getItem(`${STORAGE_PREFIX}btStopType`) || 'rr')
  const [btStopValue, setBtStopValue] = useState(() => {
    const v = localStorage.getItem(`${STORAGE_PREFIX}btStopValue`)
    return v ? parseFloat(v) : 1
  })
  const [btTargetType, setBtTargetType] = useState(() => localStorage.getItem(`${STORAGE_PREFIX}btTargetType`) || 'fixed_rr')
  const [btTargetValue, setBtTargetValue] = useState(() => {
    const v = localStorage.getItem(`${STORAGE_PREFIX}btTargetValue`)
    return v ? parseFloat(v) : 2
  })
  const [btTargetMA, setBtTargetMA] = useState(() => {
    const v = localStorage.getItem(`${STORAGE_PREFIX}btTargetMA`)
    return v ? parseInt(v) : 1
  })
  const [btReportUnit, setBtReportUnit] = useState(() => localStorage.getItem(`${STORAGE_PREFIX}btReportUnit`) || 'rr')
  const [btData, setBtData] = useState({ signals: {}, errors: {} })
  const [btLoading, setBtLoading] = useState(false)
  const [btSignalFilter, setBtSignalFilter] = useState('all')
  const [btSavedSignals, setBtSavedSignals] = useState([])
  const [showBtLoadDropdown, setShowBtLoadDropdown] = useState(false)
  const btLoadDropdownRef = useRef(null)
  const [btSaveToastVisible, setBtSaveToastVisible] = useState(false)
  const btSaveToastTimer = useRef(null)
  const [btAllowOverlap, setBtAllowOverlap] = useState(() => {
    const v = localStorage.getItem(`${STORAGE_PREFIX}btAllowOverlap`)
    return v === null ? true : v === 'true'
  })
  const [btComboMode, setBtComboMode] = useState(false)
  const [btShowChart, setBtShowChart] = useState(() => localStorage.getItem(`${STORAGE_PREFIX}btShowChart`) === 'true')
  const [btChartDecimals, setBtChartDecimals] = useState(() => parseInt(localStorage.getItem(`${STORAGE_PREFIX}btChartDecimals`)) || 5)
  const [btShowIndicator, setBtShowIndicator] = useState(() => localStorage.getItem(`${STORAGE_PREFIX}btShowIndicator`) === 'true')
  const [btShowEMA, setBtShowEMA] = useState(() => {
    const v = localStorage.getItem(`${STORAGE_PREFIX}btShowEMA`)
    return v === null ? true : v === 'true'
  })
  const [btShowSMAE, setBtShowSMAE] = useState(() => localStorage.getItem(`${STORAGE_PREFIX}btShowSMAE`) === 'true')
  const [btShowPWAP, setBtShowPWAP] = useState(() => localStorage.getItem(`${STORAGE_PREFIX}btShowPWAP`) === 'true')
  const [btLineWeight, setBtLineWeight] = useState(() => parseFloat(localStorage.getItem(`${STORAGE_PREFIX}btLineWeight`)) || 1.5)
  const [btLineStyle, setBtLineStyle] = useState(() => localStorage.getItem(`${STORAGE_PREFIX}btLineStyle`) || 'dotted')
  const [btMarkerSize, setBtMarkerSize] = useState(() => parseInt(localStorage.getItem(`${STORAGE_PREFIX}btMarkerSize`)) || 4)
  const [btChartHeight, setBtChartHeight] = useState(() => parseInt(localStorage.getItem(`${STORAGE_PREFIX}btChartHeight`)) || 500)
  const btChartResizing = useRef(false)
  const btChartStartY = useRef(0)
  const btChartStartH = useRef(0)
  const [btFocusBar, setBtFocusBar] = useState(null)  // { idx, ts } to allow re-clicks
  const [showBtHelp, setShowBtHelp] = useState(false)
  const [btHelpPos, setBtHelpPos] = useState({ x: 200, y: 100 })
  const [btDragging, setBtDragging] = useState(false)
  const btDragOffset = useRef({ x: 0, y: 0 })

  // Backtest help panel drag effect
  useEffect(() => {
    if (!btDragging) return
    const onMouseMove = (e) => {
      setBtHelpPos({ x: e.clientX - btDragOffset.current.x, y: e.clientY - btDragOffset.current.y })
    }
    const onMouseUp = () => setBtDragging(false)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [btDragging])

  // Backtest chart resize drag handler
  const handleChartResizeMouseDown = useCallback((e) => {
    e.preventDefault()
    btChartResizing.current = true
    btChartStartY.current = e.clientY
    btChartStartH.current = btChartHeight
    const onMouseMove = (ev) => {
      if (!btChartResizing.current) return
      const newH = Math.min(1200, Math.max(200, btChartStartH.current + (ev.clientY - btChartStartY.current)))
      setBtChartHeight(newH)
    }
    const onMouseUp = () => {
      btChartResizing.current = false
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
  }, [btChartHeight])

  // Persist backtest config to localStorage
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btSignals`, JSON.stringify(btSignals))
  }, [btSignals])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btStopType`, btStopType)
  }, [btStopType])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btStopValue`, btStopValue.toString())
  }, [btStopValue])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btTargetType`, btTargetType)
  }, [btTargetType])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btTargetValue`, btTargetValue.toString())
  }, [btTargetValue])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btTargetMA`, btTargetMA.toString())
  }, [btTargetMA])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btReportUnit`, btReportUnit)
  }, [btReportUnit])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btAllowOverlap`, btAllowOverlap.toString())
  }, [btAllowOverlap])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btShowChart`, btShowChart.toString())
  }, [btShowChart])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btChartDecimals`, btChartDecimals.toString())
  }, [btChartDecimals])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btShowIndicator`, btShowIndicator.toString())
  }, [btShowIndicator])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btShowEMA`, btShowEMA.toString())
  }, [btShowEMA])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btShowSMAE`, btShowSMAE.toString())
  }, [btShowSMAE])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btShowPWAP`, btShowPWAP.toString())
  }, [btShowPWAP])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btLineWeight`, btLineWeight.toString())
  }, [btLineWeight])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btLineStyle`, btLineStyle)
  }, [btLineStyle])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btMarkerSize`, btMarkerSize.toString())
  }, [btMarkerSize])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}btChartHeight`, btChartHeight.toString())
  }, [btChartHeight])

  // ==================== Optimizer Tab State ====================
  const OPT_DEFAULTS = {
    single_ma: { enabled: true, ma_type: 'both', start_period: 5, end_period: 200, step: 5 },
    two_ma: { enabled: true, ma_type: 'both', start_period: 5, end_period: 200, step: 5 },
    three_ma: { enabled: true, ma_type: 'both', start_period: 5, end_period: 200, step: 10 },
    single_smae: { enabled: true, start_period: 5, end_period: 200, step: 5, deviation: 1.0 },
    two_smae: { enabled: true, start_period: 5, end_period: 200, step: 10, deviation: 1.0 },
  }
  const [optConfig, setOptConfig] = useState(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}optConfig`)
      if (saved) return { ...OPT_DEFAULTS, ...JSON.parse(saved) }
    } catch {}
    return { ...OPT_DEFAULTS }
  })
  const [optRunning, setOptRunning] = useState(false)
  const [optProgress, setOptProgress] = useState(0)
  const [optMessage, setOptMessage] = useState('')
  const [optElapsed, setOptElapsed] = useState(0)
  const optTimerRef = useRef(null)
  const optStartRef = useRef(null)
  const [optResults, setOptResults] = useState({})
  const [optSortConfig, setOptSortConfig] = useState({})
  const [optError, setOptError] = useState('')

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}optConfig`, JSON.stringify(optConfig))
  }, [optConfig])

  const updateOptSection = useCallback((section, field, value) => {
    setOptConfig(prev => ({
      ...prev,
      [section]: { ...prev[section], [field]: value }
    }))
  }, [])

  const formatOptTime = (seconds) => {
    const m = Math.floor(seconds / 60)
    const s = seconds % 60
    return `${m}:${s.toString().padStart(2, '0')}`
  }

  const runOptimizer = useCallback(async () => {
    if (!filepath || !apiBase || optRunning) return
    setOptRunning(true)
    setOptProgress(0)
    setOptMessage('Starting...')
    setOptElapsed(0)
    setOptResults({})
    setOptError('')
    optStartRef.current = Date.now()
    optTimerRef.current = setInterval(() => {
      setOptElapsed(Math.floor((Date.now() - optStartRef.current) / 1000))
    }, 1000)

    try {
      const res = await fetch(`${apiBase}/optimizer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath, ...optConfig })
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6))
              if (event.phase === 'progress') {
                setOptProgress(event.progress)
                setOptMessage(event.message)
              } else if (event.phase === 'section_done') {
                setOptResults(prev => {
                  const next = { ...prev }
                  if (event.results_zone) {
                    next[event.section + '_zone'] = event.results_zone
                    next[event.section + '_state'] = event.results_state
                  } else {
                    next[event.section] = event.results
                  }
                  return next
                })
              } else if (event.phase === 'done') {
                setOptProgress(100)
                setOptMessage('Done')
              } else if (event.phase === 'error') {
                setOptError(event.message)
              }
            } catch (e) {
              console.error('Failed to parse optimizer SSE event:', e)
            }
          }
        }
      }
    } catch (err) {
      setOptError('Optimizer failed: ' + err.message)
    } finally {
      setOptRunning(false)
      clearInterval(optTimerRef.current)
    }
  }, [filepath, apiBase, optRunning, optConfig])

  const handleOptSort = useCallback((sectionKey, columnKey) => {
    setOptSortConfig(prev => {
      const cur = prev[sectionKey]
      if (cur && cur.key === columnKey) {
        return { ...prev, [sectionKey]: { key: columnKey, dir: cur.dir === 'desc' ? 'asc' : 'desc' } }
      }
      return { ...prev, [sectionKey]: { key: columnKey, dir: 'desc' } }
    })
  }, [])

  const getSortedOptResults = useCallback((sectionKey) => {
    const data = optResults[sectionKey]
    if (!data || data.length === 0) return []
    const sort = optSortConfig[sectionKey] || { key: 'score', dir: 'desc' }
    const sorted = [...data].sort((a, b) => {
      const av = a[sort.key] ?? 0
      const bv = b[sort.key] ?? 0
      return sort.dir === 'desc' ? bv - av : av - bv
    })
    return sorted
  }, [optResults, optSortConfig])

  const OptSortTh = useCallback(({ sectionKey, colKey, children, title, className }) => {
    const sort = optSortConfig[sectionKey]
    const active = sort && sort.key === colKey
    return (
      <th className={`sortable-th${className ? ' ' + className : ''}`} onClick={() => handleOptSort(sectionKey, colKey)} title={title}>
        {children}
        <span className={`sort-arrow ${active ? 'active' : ''}`}>
          {active ? (sort.dir === 'desc' ? ' \u25BC' : ' \u25B2') : ' \u25BC'}
        </span>
      </th>
    )
  }, [optSortConfig, handleOptSort])

  const addBtSignal = useCallback(() => {
    setBtSignals(prev => [...prev, { name: `Signal ${prev.length + 1}`, expression: '', enabled: true }])
  }, [])

  const removeBtSignal = useCallback((index) => {
    setBtSignals(prev => {
      const next = prev.filter((_, i) => i !== index)
      return next.length === 0 ? [{ name: '', expression: '', enabled: true }] : next
    })
  }, [])

  const updateBtSignal = useCallback((index, field, value) => {
    setBtSignals(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
  }, [])

  const toggleBtSignal = useCallback((index) => {
    setBtSignals(prev => prev.map((s, i) =>
      i === index ? { ...s, enabled: s.enabled === false ? true : false } : s
    ))
  }, [])

  // Fetch saved signals for backtest (shares same storage as playground)
  useEffect(() => {
    if (!filepath || !apiBase) return
    fetch(`${apiBase}/playground-saved-signals?filepath=${encodeURIComponent(filepath)}`)
      .then(r => r.ok ? r.json() : { signals: [] })
      .then(data => setBtSavedSignals(data.signals || []))
      .catch(() => setBtSavedSignals([]))
  }, [filepath, apiBase])

  const saveBtSignal = useCallback(async (signal) => {
    if (!filepath || !apiBase || !signal.name.trim() || !signal.expression.trim()) return
    try {
      const res = await fetch(`${apiBase}/playground-save-signal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath, name: signal.name, expression: signal.expression }),
      })
      if (res.ok) {
        const data = await res.json()
        setBtSavedSignals(data.signals || [])
        setSavedSignals(data.signals || [])
        clearTimeout(btSaveToastTimer.current)
        setBtSaveToastVisible(true)
        btSaveToastTimer.current = setTimeout(() => setBtSaveToastVisible(false), 1500)
      }
    } catch {}
  }, [filepath, apiBase])

  const deleteBtSavedSignal = useCallback(async (name) => {
    if (!filepath || !apiBase) return
    try {
      const res = await fetch(`${apiBase}/playground-delete-signal?filepath=${encodeURIComponent(filepath)}&name=${encodeURIComponent(name)}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        const data = await res.json()
        setBtSavedSignals(data.signals || [])
        setSavedSignals(data.signals || [])
      }
    } catch {}
  }, [filepath, apiBase])

  const loadBtSignal = useCallback((saved) => {
    setBtSignals(prev => {
      const emptyIdx = prev.findIndex(s => !s.expression.trim())
      if (emptyIdx >= 0) {
        return prev.map((s, i) => i === emptyIdx ? { name: saved.name, expression: saved.expression, enabled: true } : s)
      }
      return [...prev, { name: saved.name, expression: saved.expression, enabled: true }]
    })
    setShowBtLoadDropdown(false)
  }, [])

  // Close backtest load dropdown on outside click
  useEffect(() => {
    if (!showBtLoadDropdown) return
    const handler = (e) => {
      if (btLoadDropdownRef.current && !btLoadDropdownRef.current.contains(e.target)) {
        setShowBtLoadDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showBtLoadDropdown])

  const evaluateBacktest = useCallback(async () => {
    if (!filepath || !apiBase) return
    const nonEmpty = btSignals.filter(s => s.expression.trim() && s.enabled !== false)
    if (nonEmpty.length === 0) return
    setBtLoading(true)
    try {
      const res = await fetch(`${apiBase}/backtest-signals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filepath,
          signals: nonEmpty,
          stop_type: btStopType,
          stop_value: btStopValue,
          target_type: btTargetType,
          target_value: btTargetValue,
          target_ma: btTargetMA,
          report_unit: btReportUnit,
          allow_overlap: btAllowOverlap,
        }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setBtData(data)
    } catch (e) {
      setBtData({ signals: {}, errors: { _global: e.message } })
    } finally {
      setBtLoading(false)
    }
  }, [filepath, apiBase, btSignals, btStopType, btStopValue, btTargetType, btTargetValue, btTargetMA, btReportUnit, btAllowOverlap])

  // Memoized R-Curve traces for backtest
  const btCurveTraces = useMemo(() => {
    const traces = []
    const sigs = btData.signals || {}
    btSignals.forEach((signal, i) => {
      if (signal.enabled === false) return
      const sigData = sigs[signal.name]
      if (!sigData || !sigData.trades || sigData.trades.length === 0) return
      const sorted = [...sigData.trades].sort((a, b) => a.idx - b.idx)
      let cumulative = 0
      const x = [0]
      const y = [0]
      sorted.forEach((t, j) => {
        cumulative += t.result
        x.push(j + 1)
        y.push(parseFloat(cumulative.toFixed(2)))
      })
      traces.push({
        x, y,
        type: 'scatter',
        mode: 'lines',
        name: signal.name,
        line: { color: PLAYGROUND_COLORS[i % PLAYGROUND_COLORS.length], width: 1.5 },
      })
    })
    return traces
  }, [btData, btSignals])

  // Memoized combo equity curve for backtest (sorted by exit_idx)
  const btComboCurveTraces = useMemo(() => {
    const sigs = btData.signals || {}
    const allTrades = []
    btSignals.forEach((signal) => {
      if (signal.enabled === false) return
      const sigData = sigs[signal.name]
      if (!sigData || !sigData.trades) return
      sigData.trades.forEach(t => allTrades.push(t))
    })
    if (allTrades.length === 0) return []
    allTrades.sort((a, b) => (a.exit_idx ?? a.idx) - (b.exit_idx ?? b.idx))
    let cumulative = 0
    const x = [0]
    const y = [0]
    allTrades.forEach((t, j) => {
      cumulative += t.result
      x.push(j + 1)
      y.push(parseFloat(cumulative.toFixed(2)))
    })
    return [{
      x, y,
      type: 'scatter',
      mode: 'lines',
      name: 'Combo',
      line: { color: '#facc15', width: 1.5 },
    }]
  }, [btData, btSignals])

  // Flat trade list for backtest chart
  const btChartTrades = useMemo(() => {
    if (!btData?.signals) return []
    const all = []
    btSignals.forEach((sig, i) => {
      if (sig.enabled === false) return
      const sigData = btData.signals[sig.name]
      if (!sigData?.trades) return
      sigData.trades.forEach(t => {
        all.push({ ...t, signalColor: PLAYGROUND_COLORS[i % PLAYGROUND_COLORS.length] })
      })
    })
    return all
  }, [btData, btSignals])

  // Memoized combo summary stats for backtest
  const btComboStats = useMemo(() => {
    const sigs = btData.signals || {}
    const allTrades = []
    btSignals.forEach((signal) => {
      if (signal.enabled === false) return
      const sigData = sigs[signal.name]
      if (!sigData || !sigData.trades) return
      sigData.trades.forEach(t => allTrades.push(t))
    })
    if (allTrades.length === 0) return null
    allTrades.sort((a, b) => (a.exit_idx ?? a.idx) - (b.exit_idx ?? b.idx))
    const count = allTrades.length
    const closed = allTrades.filter(t => t.outcome !== 'open')
    const open = allTrades.filter(t => t.outcome === 'open').length
    const wins = closed.filter(t => t.result > 0)
    const losses = closed.filter(t => t.result <= 0)
    const winCount = wins.length
    const lossCount = losses.length
    const winRate = closed.length > 0 ? winCount / closed.length : 0
    const avgWin = winCount > 0 ? (wins.reduce((s, t) => s + t.result, 0) / winCount) : 0
    const avgLoss = lossCount > 0 ? (losses.reduce((s, t) => s + t.result, 0) / lossCount) : 0
    const grossWin = wins.reduce((s, t) => s + t.result, 0)
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.result, 0))
    const profitFactor = grossLoss > 0 ? (grossWin / grossLoss) : grossWin > 0 ? Infinity : 0
    const totalR = allTrades.reduce((s, t) => s + t.result, 0)
    const expectancy = closed.length > 0 ? (closed.reduce((s, t) => s + t.result, 0) / closed.length) : 0
    // Max drawdown
    let peak = 0, maxDD = 0, cum = 0
    allTrades.forEach(t => {
      cum += t.result
      if (cum > peak) peak = cum
      const dd = peak - cum
      if (dd > maxDD) maxDD = dd
    })
    // Sharpe
    const results = closed.map(t => t.result)
    const mean = results.length > 0 ? results.reduce((s, v) => s + v, 0) / results.length : 0
    const variance = results.length > 1 ? results.reduce((s, v) => s + (v - mean) ** 2, 0) / (results.length - 1) : 0
    const stdDev = Math.sqrt(variance)
    const sharpe = stdDev > 0 ? (mean / stdDev) : null
    // Streaks
    let maxConsecWins = 0, maxConsecLosses = 0, cw = 0, cl = 0
    closed.forEach(t => {
      if (t.result > 0) { cw++; cl = 0; if (cw > maxConsecWins) maxConsecWins = cw }
      else { cl++; cw = 0; if (cl > maxConsecLosses) maxConsecLosses = cl }
    })
    // Avg bars held
    const barsArr = allTrades.filter(t => t.bars_held != null).map(t => t.bars_held)
    const avgBarsHeld = barsArr.length > 0 ? (barsArr.reduce((s, v) => s + v, 0) / barsArr.length) : 0
    return {
      count,
      wins: winCount,
      losses: lossCount,
      open,
      win_rate: winRate,
      avg_win: parseFloat(avgWin.toFixed(2)),
      avg_loss: parseFloat(avgLoss.toFixed(2)),
      profit_factor: profitFactor === Infinity ? '∞' : parseFloat(profitFactor.toFixed(2)),
      expectancy: parseFloat(expectancy.toFixed(2)),
      total_r: parseFloat(totalR.toFixed(2)),
      max_drawdown: parseFloat(maxDD.toFixed(2)),
      sharpe: sharpe != null ? parseFloat(sharpe.toFixed(2)) : null,
      max_consec_wins: maxConsecWins,
      max_consec_losses: maxConsecLosses,
      avg_bars_held: parseFloat(avgBarsHeld.toFixed(1)),
    }
  }, [btData, btSignals])

  // Reset SQF filters when a new file is loaded
  useEffect(() => {
    setSqfFilters({ t1: SQF_DEFAULTS, t2: SQF_DEFAULTS })
  }, [filepath])

  // Compute SQF bounds from raw signal data (not filtered), split by type and UP/DN
  const sqfBounds = useMemo(() => {
    if (!signalData) return null
    const suffix = sqfNormMode === 'adr' ? '_adr' : '_rr'
    const groups = [
      { key: 'ema1', field: 'ema1Dist' },
      { key: 'ema2', field: 'ema2Dist' },
      { key: 'ema3', field: 'ema3Dist' },
      { key: 'dd', field: 'dd' },
      { key: 'prRunCnt', field: 'prRunCnt', integer: true },
      { key: 'conBars', field: 'conUpBars', dnField: 'conDnBars', integer: true },
      { key: 'stateDur', field: 'stateDur', integer: true },
      { key: 'barDur', field: 'barDur', integer: true },
    ]
    const result = {}
    for (const [type, upKey, dnKey] of [['t1', 'type1Up', 'type1Dn'], ['t2', 'type2Up', 'type2Dn']]) {
      const bounds = {}
      for (const { key, field, dnField, integer: isInt } of groups) {
        const upFld = isInt ? field : field + suffix
        const dnFld = isInt ? (dnField || field) : (dnField || field) + suffix
        const upVals = (signalData[upKey] || []).map(p => p[upFld]).filter(v => v != null)
        const dnVals = (signalData[dnKey] || []).map(p => p[dnFld]).filter(v => v != null)
        const expand = isInt ? 1 : 0.1
        const round1 = isInt ? v => Math.round(v) : v => Math.round(v * 10) / 10
        bounds[key] = {
          up: upVals.length > 0
            ? [round1(Math.min(...upVals) - expand), round1(Math.max(...upVals) + expand)]
            : [0, 0],
          dn: dnVals.length > 0
            ? (isInt
              ? [round1(Math.min(...dnVals) - expand), round1(Math.max(...dnVals) + expand)]
              : [round1(Math.max(...dnVals) + expand), round1(Math.min(...dnVals) - expand)])
            : [0, 0],
          available: upVals.length > 0 || dnVals.length > 0,
        }
      }
      result[type] = bounds
    }
    return result
  }, [signalData, sqfNormMode])

  // SQF pass test: check if a signal point passes all enabled SQF filters
  const passesSqf = (pt, dir, type) => {
    const suffix = sqfNormMode === 'adr' ? '_adr' : '_rr'
    const groups = [
      { key: 'ema1', field: 'ema1Dist' },
      { key: 'ema2', field: 'ema2Dist' },
      { key: 'ema3', field: 'ema3Dist' },
      { key: 'dd', field: 'dd' },
      { key: 'prRunCnt', field: 'prRunCnt', integer: true },
      { key: 'conBars', field: 'conUpBars', dnField: 'conDnBars', integer: true },
      { key: 'stateDur', field: 'stateDur', integer: true },
      { key: 'barDur', field: 'barDur', integer: true },
    ]
    for (const { key, field, dnField, integer: isInt } of groups) {
      const cfg = sqfFilters[type][key]
      const enabled = dir === 'up' ? cfg.upEnabled : cfg.dnEnabled
      if (!enabled) continue
      const activeField = (dir === 'dn' && dnField) ? dnField : field
      const val = pt[isInt ? activeField : activeField + suffix]
      if (val == null) return false
      const range = dir === 'up' ? cfg.upRange : cfg.dnRange
      const [a, b] = range
      const lo = (a != null && b != null) ? Math.min(a, b) : a
      const hi = (a != null && b != null) ? Math.max(a, b) : b
      if (lo != null && val < lo) return false
      if (hi != null && val > hi) return false
    }
    return true
  }

  // Filter signal data by per-type N selections, enabled state, and SQF
  const filteredSignalData = useMemo(() => {
    if (!signalData) return {}
    const t1NsSet = new Set(selectedType1Ns)
    const t2NsSet = new Set(selectedType2Ns)
    const result = {}
    for (const [key, arr] of Object.entries(signalData)) {
      const dir = key.endsWith('Up') ? 'up' : 'dn'
      if (key.startsWith('type1')) {
        result[key] = type1Enabled && arr ? arr.filter(pt => t1NsSet.has(pt.n) && passesSqf(pt, dir, 't1')) : []
      } else if (key.startsWith('type2')) {
        result[key] = type2Enabled && arr ? arr.filter(pt => t2NsSet.has(pt.n) && passesSqf(pt, dir, 't2')) : []
      } else {
        result[key] = arr || []
      }
    }
    return result
  }, [signalData, selectedType1Ns, selectedType2Ns, type1Enabled, type2Enabled, sqfFilters, sqfNormMode])

  const rrLabel = RR_FIELDS.find(f => f.value === selectedRRField)?.label || 'RR'

  // Build equity curve traces from filtered data
  const equityCurveTraces = useMemo(() => {
    if (!filteredSignalData) return []
    return [
      { key: 'type1Up', color: '#22c55e', name: 'Type1 UP' },
      { key: 'type1Dn', color: '#ef4444', name: 'Type1 DN' },
      ...(!brickEqReversal ? [
        { key: 'type2Up', color: '#4ade80', name: 'Type2 UP', dash: 'dot' },
        { key: 'type2Dn', color: '#f87171', name: 'Type2 DN', dash: 'dot' },
      ] : []),
    ]
      .filter(s => filteredSignalData[s.key]?.length > 0)
      .map(s => {
        const arr = filteredSignalData[s.key]
        let cum = 0
        const xs = [0]
        const ys = [0]
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
  }, [filteredSignalData, selectedRRField, rrLabel, brickEqReversal])

  // Build combined UP+DN traces (interleaved chronologically by row index)
  const comboCurveTraces = useMemo(() => {
    if (!filteredSignalData) return []
    const combos = [
      { upKey: 'type1Up', dnKey: 'type1Dn', color: '#facc15', name: 'Type1 Combo' },
      ...(!brickEqReversal ? [
        { upKey: 'type2Up', dnKey: 'type2Dn', color: '#fb923c', name: 'Type2 Combo', dash: 'dot' },
      ] : []),
    ]
    return combos
      .map(c => {
        const ups = filteredSignalData[c.upKey] || []
        const dns = filteredSignalData[c.dnKey] || []
        const merged = [...ups, ...dns].sort((a, b) => a.idx - b.idx)
        if (merged.length === 0) return null
        let cum = 0
        const xs = [0]
        const ys = [0]
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
  }, [filteredSignalData, selectedRRField, rrLabel, brickEqReversal])

  // Compute signal type stats from filtered data
  const type1Stats = useMemo(() => {
    if (!filteredSignalData.type1Up && !filteredSignalData.type1Dn) return null
    return computeSignalStats(filteredSignalData.type1Up || [], filteredSignalData.type1Dn || [], selectedRRField)
  }, [filteredSignalData, selectedRRField])

  const type2Stats = useMemo(() => {
    if (!filteredSignalData.type2Up && !filteredSignalData.type2Dn) return null
    return computeSignalStats(filteredSignalData.type2Up || [], filteredSignalData.type2Dn || [], selectedRRField)
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

  const totalBars = stats.totalBars
  const upBars = stats.upBars
  const dnBars = stats.dnBars
  const _maStats = stats.maStats
  const _allMaStats = stats.allMaStats
  const _beyondMaStats = stats.beyondMaStats
  const _beyondAllMaStats = stats.beyondAllMaStats
  const _smaeStats = stats.smaeStats
  const _allSmaeStats = stats.allSmaeStats
  const _beyondSmaeStats = stats.beyondSmaeStats
  const _beyondAllSmaeStats = stats.beyondAllSmaeStats
  const _pwapMeanStats = stats.pwapMeanStats
  const _beyondPwapMeanStats = stats.beyondPwapMeanStats
  const _chopStats = stats.chopStats
  const _stateStats = stats.stateStats
  const _wickDist = stats.wickDist
  const _hemisphere = stats.barData ? computeHemisphere(stats.barData, null, stats.maPeriods || []) : []
  const { settings } = stats

  const pct = (count, total) => total > 0 ? ((count / total) * 100).toFixed(0) : '0'

  // Build table data
  const rows = [
    ..._maStats.map((ma, idx) => ({
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
      above: _allMaStats.aboveAll,
      below: _allMaStats.belowAll,
      aboveUp: _allMaStats.aboveAllUp ?? 0,
      aboveDown: _allMaStats.aboveAllDown ?? 0,
      belowUp: _allMaStats.belowAllUp ?? 0,
      belowDown: _allMaStats.belowAllDown ?? 0,
    }
  ]

  // Build beyond table data
  const beyondRows = _beyondMaStats ? [
    ..._beyondMaStats.map((ma, idx) => ({
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
      above: _beyondAllMaStats.aboveAll,
      below: _beyondAllMaStats.belowAll,
      aboveUp: _beyondAllMaStats.aboveAllUp ?? 0,
      aboveDown: _beyondAllMaStats.aboveAllDown ?? 0,
      belowUp: _beyondAllMaStats.belowAllUp ?? 0,
      belowDown: _beyondAllMaStats.belowAllDown ?? 0,
    }
  ] : null

  // Build SMAE table rows
  const smaeRows = _smaeStats?.length ? [
    ..._smaeStats.map(s => ({
      label: `SMAE${s.n}(${s.n === 1 ? settings.smae1Period : settings.smae2Period})`,
      colorClass: `smae-color-${s.n}`,
      above: s.above, between: s.between, below: s.below,
      aboveUp: s.aboveUp ?? 0, aboveDown: s.aboveDown ?? 0,
      betweenUp: s.betweenUp ?? 0, betweenDown: s.betweenDown ?? 0,
      belowUp: s.belowUp ?? 0, belowDown: s.belowDown ?? 0,
    })),
    ...(_allSmaeStats ? [{
      label: 'ALL SMAEs',
      colorClass: 'smae-color-all',
      above: _allSmaeStats.above, between: _allSmaeStats.between, below: _allSmaeStats.below,
      aboveUp: _allSmaeStats.aboveUp ?? 0, aboveDown: _allSmaeStats.aboveDown ?? 0,
      betweenUp: _allSmaeStats.betweenUp ?? 0, betweenDown: _allSmaeStats.betweenDown ?? 0,
      belowUp: _allSmaeStats.belowUp ?? 0, belowDown: _allSmaeStats.belowDown ?? 0,
    }] : [])
  ] : null

  const beyondSmaeRows = _beyondSmaeStats?.length ? [
    ..._beyondSmaeStats.map(s => ({
      label: `SMAE${s.n}(${s.n === 1 ? settings.smae1Period : settings.smae2Period})`,
      colorClass: `smae-color-${s.n}`,
      above: s.above, between: s.between, below: s.below,
      aboveUp: s.aboveUp ?? 0, aboveDown: s.aboveDown ?? 0,
      betweenUp: s.betweenUp ?? 0, betweenDown: s.betweenDown ?? 0,
      belowUp: s.belowUp ?? 0, belowDown: s.belowDown ?? 0,
    })),
    ...(_beyondAllSmaeStats ? [{
      label: 'ALL SMAEs',
      colorClass: 'smae-color-all',
      above: _beyondAllSmaeStats.above, between: _beyondAllSmaeStats.between, below: _beyondAllSmaeStats.below,
      aboveUp: _beyondAllSmaeStats.aboveUp ?? 0, aboveDown: _beyondAllSmaeStats.aboveDown ?? 0,
      betweenUp: _beyondAllSmaeStats.betweenUp ?? 0, betweenDown: _beyondAllSmaeStats.betweenDown ?? 0,
      belowUp: _beyondAllSmaeStats.belowUp ?? 0, belowDown: _beyondAllSmaeStats.belowDown ?? 0,
    }] : [])
  ] : null

  // Build PWAP Mean rows
  const pwapMeanRow = _pwapMeanStats ? {
    label: 'PWAP Mean',
    colorClass: 'pwap-color-mean',
    above: _pwapMeanStats.above, below: _pwapMeanStats.below,
    aboveUp: _pwapMeanStats.aboveUp ?? 0, aboveDown: _pwapMeanStats.aboveDown ?? 0,
    belowUp: _pwapMeanStats.belowUp ?? 0, belowDown: _pwapMeanStats.belowDown ?? 0,
  } : null

  const beyondPwapMeanRow = _beyondPwapMeanStats ? {
    label: 'PWAP Mean',
    colorClass: 'pwap-color-mean',
    above: _beyondPwapMeanStats.above, below: _beyondPwapMeanStats.below,
    aboveUp: _beyondPwapMeanStats.aboveUp ?? 0, aboveDown: _beyondPwapMeanStats.aboveDown ?? 0,
    belowUp: _beyondPwapMeanStats.belowUp ?? 0, belowDown: _beyondPwapMeanStats.belowDown ?? 0,
  } : null

  // Render Nth occurrence table for a signal type
  const renderNthOccurrence = (title, typeStats) => {
    if (!typeStats) return null
    const { upSummary, dnSummary, upNth, dnNth } = typeStats
    if (upSummary.count === 0 && dnSummary.count === 0) return null
    const allNs = new Set([...upNth.map(r => r.n), ...dnNth.map(r => r.n)])
    const nthRows = Array.from(allNs).sort((a, b) => a - b).map(n => ({
      n,
      up: upNth.find(r => r.n === n),
      dn: dnNth.find(r => r.n === n),
    }))
    if (nthRows.length === 0) return null
    return (
      <div className="stats-module">
        <table className="stats-table signal-nth-table">
          <thead>
            <tr className="module-title-row">
              <th colSpan="7" className="module-title">{title}</th>
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
      </div>
    )
  }

  return (
    <div className="stats-page">
      {/* Top bar: tabs left, file header centered, settings right */}
      <div className="stats-top-bar">
        <div className="stats-tabs">
          <button
            className={`stats-tab ${activeTab === 'general' ? 'active' : ''}`}
            onClick={() => setActiveTab('general')}
          >General</button>
          <button
            className={`stats-tab ${activeTab === 'signals' ? 'active' : ''}`}
            onClick={() => setActiveTab('signals')}
          >Type1/Type2</button>
          <button
            className={`stats-tab ${activeTab === 'playground' ? 'active' : ''}`}
            onClick={() => setActiveTab('playground')}
          >Playground</button>
          <button
            className={`stats-tab ${activeTab === 'backtest' ? 'active' : ''}`}
            onClick={() => setActiveTab('backtest')}
          >Backtest</button>
          <button
            className={`stats-tab ${activeTab === 'optimizer' ? 'active' : ''}`}
            onClick={() => setActiveTab('optimizer')}
          >Optimizer</button>
        </div>
        {settings && (
          <div className="settings-inline-wrap">
            <div className="settings-inline">
              <span className="settings-inline-item"><span className="settings-inline-label">Brick:</span><span className="settings-inline-val">{settings.brickSize}</span></span>
              <span className="settings-inline-item"><span className="settings-inline-label">Rev:</span><span className="settings-inline-val">{settings.reversalSize}</span></span>
              {settings.smae1Period != null && (
                <span className="settings-inline-item">
                  <span className="settings-inline-label">ENV1:</span>
                  <span className="settings-inline-val">{settings.smae1Period}/{settings.smae1Deviation}</span>
                </span>
              )}
              {settings.smae2Period != null && (
                <span className="settings-inline-item">
                  <span className="settings-inline-label">ENV2:</span>
                  <span className="settings-inline-val">{settings.smae2Period}/{settings.smae2Deviation}</span>
                </span>
              )}
              {settings.pwapSigmas != null && (
                <span className="settings-inline-item">
                  <span className="settings-inline-label">PWAP:</span>
                  <span className="settings-inline-val">{settings.pwapSigmas.join(',')}σ</span>
                </span>
              )}
            </div>
            <div className="settings-inline">
              <span className="settings-inline-item"><span className="settings-inline-label">Wicks:</span><span className="settings-inline-val">{settings.wickMode}</span></span>
              <span className="settings-inline-item"><span className="settings-inline-label">ADR:</span><span className="settings-inline-val">{settings.adrPeriod}</span></span>
              <span className="settings-inline-item"><span className="settings-inline-label">Chop:</span><span className="settings-inline-val">{settings.chopPeriod}</span></span>
              <span className="settings-inline-item"><span className="settings-inline-label">MA1:</span><span className="settings-inline-val">{settings.ma1Period}</span></span>
              <span className="settings-inline-item"><span className="settings-inline-label">MA2:</span><span className="settings-inline-val">{settings.ma2Period}</span></span>
              <span className="settings-inline-item"><span className="settings-inline-label">MA3:</span><span className="settings-inline-val">{settings.ma3Period}</span></span>
            </div>
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
                  {type2NValues.length > 0 && !brickEqReversal && (
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
                  {/* Signal Quality Filters — separate T1 and T2 panels */}
                  {[
                    { type: 't1', label: 'Signal Quality-T1', open: sqfPanelOpenT1, setOpen: setSqfPanelOpenT1 },
                    { type: 't2', label: 'Signal Quality-T2', open: sqfPanelOpenT2, setOpen: setSqfPanelOpenT2 },
                  ].filter(({ type }) => sqfBounds?.[type] && !(type === 't2' && brickEqReversal)).map(({ type, label, open, setOpen }) => (
                    <div key={type} className="sqf-filters-panel">
                      <div className="sqf-header-row">
                        <span className="sqf-label" onClick={() => setOpen(prev => !prev)}>
                          <span className={`collapse-arrow ${open ? 'open' : ''}`}>&#9654;</span>
                          {label}
                        </span>
                        <span className="sqf-norm-toggle">
                          {['rr', 'adr'].map(mode => (
                            <button
                              key={mode}
                              className={`sqf-norm-btn${sqfNormMode === mode ? ' active' : ''}`}
                              onClick={() => {
                                setSqfNormMode(mode)
                                setSqfFilters({ t1: SQF_DEFAULTS, t2: SQF_DEFAULTS })
                              }}
                            >{mode.toUpperCase()}</button>
                          ))}
                        </span>
                      </div>
                      {open && (
                        <div className="sqf-groups">
                          {[
                            { key: 'ema1', label: `EMA(${stats?.settings?.ma1Period ?? stats?.maPeriods?.[0] ?? '?'})`, tooltip: 'Distance from MA for entry bar' },
                            { key: 'ema2', label: `EMA(${stats?.settings?.ma2Period ?? stats?.maPeriods?.[1] ?? '?'})`, tooltip: 'Distance from MA for entry bar' },
                            { key: 'ema3', label: `EMA(${stats?.settings?.ma3Period ?? stats?.maPeriods?.[2] ?? '?'})`, tooltip: 'Distance from MA for entry bar' },
                            { key: 'dd', label: 'DD', tooltip: 'Wick size of entry bar' },
                            { key: 'prRunCnt', label: 'PRIOR RUN COUNT', tooltip: 'Prior run count', integer: true },
                            { key: 'conBars', label: 'CON UP/DN', tooltip: 'Consecutive UP/DN bars', integer: true },
                            { key: 'stateDur', label: 'STATE DURATION', tooltip: 'State duration (minutes)', integer: true },
                            { key: 'barDur', label: 'BARDURATION', tooltip: 'Bar duration (minutes)', integer: true },
                          ].filter(g => sqfBounds[type][g.key]?.available).map(({ key, label: groupLabel, tooltip, integer: isInt }) => (
                            <div key={key} className="sqf-filter-group">
                              <div className="sqf-filter-label" title={tooltip}>{groupLabel}</div>
                              {['up', 'dn'].map(dir => {
                                const enabledKey = dir === 'up' ? 'upEnabled' : 'dnEnabled'
                                const rangeKey = dir === 'up' ? 'upRange' : 'dnRange'
                                const bounds = sqfBounds[type][key][dir]
                                const cfg = sqfFilters[type][key]
                                const enabled = cfg[enabledKey]
                                return (
                                  <div key={dir} className="sqf-slider-row">
                                    <label className="sqf-checkbox-label">
                                      <input
                                        type="checkbox"
                                        checked={enabled}
                                        onChange={e => updateSqfFilter(type, key, enabledKey, e.target.checked)}
                                      />
                                      <span className={`sqf-dir-label ${dir}`}>{dir.toUpperCase()}</span>
                                    </label>
                                    <input
                                      type="number"
                                      step={isInt ? "1" : "0.1"}
                                      className="sqf-range-input"
                                      disabled={!enabled}
                                      placeholder={isInt ? (bounds[0]?.toFixed(0) ?? '') : (bounds[0]?.toFixed(1) ?? '')}
                                      value={cfg[rangeKey][0] ?? ''}
                                      onChange={e => updateSqfRange(type, key, rangeKey, 0, e.target.value)}
                                    />
                                    <span className="sqf-range-sep">to</span>
                                    <input
                                      type="number"
                                      step={isInt ? "1" : "0.1"}
                                      className="sqf-range-input"
                                      disabled={!enabled}
                                      placeholder={isInt ? (bounds[1]?.toFixed(0) ?? '') : (bounds[1]?.toFixed(1) ?? '')}
                                      value={cfg[rangeKey][1] ?? ''}
                                      onChange={e => updateSqfRange(type, key, rangeKey, 1, e.target.value)}
                                    />
                                  </div>
                                )
                              })}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
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

          {/* Signal Type Performance + RR Distribution */}
          {(type1Stats || type2Stats) && (
            <div className="stats-module">
              <table className="stats-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan={brickEqReversal ? 3 : 5} className="module-title" data-tooltip="Signal performance summary for Type1 (3-bar reversal pattern) and Type2 (wicked bars in +3/-3 state)">SIGNAL PERFORMANCE</th>
                  </tr>
                  <tr>
                    <th></th>
                    <th colSpan="2">Type 1</th>
                    {!brickEqReversal && <th colSpan="2">Type 2</th>}
                  </tr>
                  <tr>
                    <th></th>
                    <th className="up">UP</th>
                    <th className="dn">DN</th>
                    {!brickEqReversal && <th className="up">UP</th>}
                    {!brickEqReversal && <th className="dn">DN</th>}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Count</td>
                    <td className="up">{type1Stats?.upSummary.count ?? '—'}</td>
                    <td className="dn">{type1Stats?.dnSummary.count ?? '—'}</td>
                    {!brickEqReversal && <td className="up">{type2Stats?.upSummary.count ?? '—'}</td>}
                    {!brickEqReversal && <td className="dn">{type2Stats?.dnSummary.count ?? '—'}</td>}
                  </tr>
                  <tr>
                    <td>Avg RR</td>
                    <td className="up">{type1Stats?.upSummary.avgRR ?? '—'}</td>
                    <td className="dn">{type1Stats?.dnSummary.avgRR ?? '—'}</td>
                    {!brickEqReversal && <td className="up">{type2Stats?.upSummary.avgRR ?? '—'}</td>}
                    {!brickEqReversal && <td className="dn">{type2Stats?.dnSummary.avgRR ?? '—'}</td>}
                  </tr>
                  <tr>
                    <td>Win Rate</td>
                    <td className="up">{type1Stats ? `${type1Stats.upSummary.winRate}%` : '—'}</td>
                    <td className="dn">{type1Stats ? `${type1Stats.dnSummary.winRate}%` : '—'}</td>
                    {!brickEqReversal && <td className="up">{type2Stats ? `${type2Stats.upSummary.winRate}%` : '—'}</td>}
                    {!brickEqReversal && <td className="dn">{type2Stats ? `${type2Stats.dnSummary.winRate}%` : '—'}</td>}
                  </tr>
                </tbody>
                {/* RR Distribution */}
                <thead>
                  <tr className="module-title-row">
                    <th colSpan={brickEqReversal ? 3 : 5} className="module-title">RR DISTRIBUTION</th>
                  </tr>
                  <tr>
                    <th></th>
                    <th colSpan="2">Type 1</th>
                    {!brickEqReversal && <th colSpan="2">Type 2</th>}
                  </tr>
                  <tr>
                    <th>RR</th>
                    <th className="up">UP</th>
                    <th className="dn">DN</th>
                    {!brickEqReversal && <th className="up">UP</th>}
                    {!brickEqReversal && <th className="dn">DN</th>}
                  </tr>
                </thead>
                <tbody>
                  {RR_BUCKETS.map((bucket, i) => (
                    <tr key={bucket.label}>
                      <td>{bucket.label}</td>
                      <td className="up">{type1Stats ? `${type1Stats.upDist[i].count} (${type1Stats.upDist[i].pct}%)` : '—'}</td>
                      <td className="dn">{type1Stats ? `${type1Stats.dnDist[i].count} (${type1Stats.dnDist[i].pct}%)` : '—'}</td>
                      {!brickEqReversal && <td className="up">{type2Stats ? `${type2Stats.upDist[i].count} (${type2Stats.upDist[i].pct}%)` : '—'}</td>}
                      {!brickEqReversal && <td className="dn">{type2Stats ? `${type2Stats.dnDist[i].count} (${type2Stats.dnDist[i].pct}%)` : '—'}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Nth Occurrence — side by side */}
          <div className="signal-modules-row">
            {renderNthOccurrence('TYPE 1 NTH OCCURRENCE', type1Stats)}
            {renderNthOccurrence('TYPE 2 NTH OCCURRENCE', type2Stats)}
          </div>
        </div>
      )}

      {/* ==================== General Stats Tab ==================== */}
      {activeTab === 'general' && (
        <div className="stats-tab-content">
          {/* General Stats + Global Chop Index */}
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
              {_chopStats && (
                <>
                  <thead>
                    <tr className="module-title-row">
                      <th colSpan="3" className="module-title" data-tooltip="Percentage of bars that reverse direction from the prior bar. Not affected by chop filter — requires sequential bar context.">GLOBAL CHOP INDEX</th>
                    </tr>
                    <tr>
                      <th>Reversal Bars</th>
                      <th>Total</th>
                      <th>Chop %</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>{_chopStats.reversalBars.toLocaleString()}</td>
                      <td>{totalBars.toLocaleString()}</td>
                      <td className="chop-value">{_chopStats.chopIndex}%</td>
                    </tr>
                  </tbody>
                </>
              )}
            </table>
          </div>

          {/* State Distribution */}
          {_stateStats?.length > 0 && (
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
                  {_stateStats.map(row => (
                    <tr key={row.state}>
                      <td className={row.state > 0 ? 'state-up' : row.state < 0 ? 'state-dn' : ''} data-tooltip={stateMAOrder[row.state]}>
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

          {/* Bar Location Stats (ALL + BEYOND) */}
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
              {beyondRows && (
                <>
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
                </>
              )}
            </table>
          </div>

          {/* SMAE Bar Location Stats */}
          {smaeRows && (
            <div className="stats-module">
              <table className="stats-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan="10" className="module-title" data-tooltip="Bars where close is above, between, or below each SMAE channel">SMAE BAR LOCATION(ALL)</th>
                  </tr>
                  <tr>
                    <th></th>
                    <th colSpan="3">Above Channel</th>
                    <th colSpan="3">Between</th>
                    <th colSpan="3">Below Channel</th>
                  </tr>
                  <tr>
                    <th>SMAE</th>
                    <th>Count</th>
                    <th className="up">UP%</th>
                    <th className="dn">DN%</th>
                    <th>Count</th>
                    <th className="up">UP%</th>
                    <th className="dn">DN%</th>
                    <th>Count</th>
                    <th className="up">UP%</th>
                    <th className="dn">DN%</th>
                  </tr>
                </thead>
                <tbody>
                  {smaeRows.map(row => (
                    <tr key={row.label}>
                      <td className={row.colorClass}>{row.label}</td>
                      <td>{row.above} <span className="pct">({pct(row.above, totalBars)}%)</span></td>
                      <td className={`up${row.aboveUp > row.aboveDown ? ' highlight' : ''}`}>{pct(row.aboveUp, row.above)}%</td>
                      <td className={`dn${row.aboveDown > row.aboveUp ? ' highlight' : ''}`}>{pct(row.aboveDown, row.above)}%</td>
                      <td>{row.between} <span className="pct">({pct(row.between, totalBars)}%)</span></td>
                      <td className={`up${row.betweenUp > row.betweenDown ? ' highlight' : ''}`}>{pct(row.betweenUp, row.between)}%</td>
                      <td className={`dn${row.betweenDown > row.betweenUp ? ' highlight' : ''}`}>{pct(row.betweenDown, row.between)}%</td>
                      <td>{row.below} <span className="pct">({pct(row.below, totalBars)}%)</span></td>
                      <td className={`up${row.belowUp > row.belowDown ? ' highlight' : ''}`}>{pct(row.belowUp, row.below)}%</td>
                      <td className={`dn${row.belowDown > row.belowUp ? ' highlight' : ''}`}>{pct(row.belowDown, row.below)}%</td>
                    </tr>
                  ))}
                </tbody>
                {beyondSmaeRows && (
                  <>
                    <thead>
                      <tr className="module-title-row">
                        <th colSpan="10" className="module-title" data-tooltip="Bars entirely above, within, or below each SMAE channel (no part of the bar crosses a band)">SMAE BAR LOCATION(BEYOND)</th>
                      </tr>
                      <tr>
                        <th></th>
                        <th colSpan="3">Above Channel</th>
                        <th colSpan="3">Between</th>
                        <th colSpan="3">Below Channel</th>
                      </tr>
                      <tr>
                        <th>SMAE</th>
                        <th>Count</th>
                        <th className="up">UP%</th>
                        <th className="dn">DN%</th>
                        <th>Count</th>
                        <th className="up">UP%</th>
                        <th className="dn">DN%</th>
                        <th>Count</th>
                        <th className="up">UP%</th>
                        <th className="dn">DN%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {beyondSmaeRows.map(row => (
                        <tr key={row.label}>
                          <td className={row.colorClass}>{row.label}</td>
                          <td>{row.above} <span className="pct">({pct(row.above, totalBars)}%)</span></td>
                          <td className={`up${row.aboveUp > row.aboveDown ? ' highlight' : ''}`}>{pct(row.aboveUp, row.above)}%</td>
                          <td className={`dn${row.aboveDown > row.aboveUp ? ' highlight' : ''}`}>{pct(row.aboveDown, row.above)}%</td>
                          <td>{row.between} <span className="pct">({pct(row.between, totalBars)}%)</span></td>
                          <td className={`up${row.betweenUp > row.betweenDown ? ' highlight' : ''}`}>{pct(row.betweenUp, row.between)}%</td>
                          <td className={`dn${row.betweenDown > row.betweenUp ? ' highlight' : ''}`}>{pct(row.betweenDown, row.between)}%</td>
                          <td>{row.below} <span className="pct">({pct(row.below, totalBars)}%)</span></td>
                          <td className={`up${row.belowUp > row.belowDown ? ' highlight' : ''}`}>{pct(row.belowUp, row.below)}%</td>
                          <td className={`dn${row.belowDown > row.belowUp ? ' highlight' : ''}`}>{pct(row.belowDown, row.below)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </>
                )}
              </table>
            </div>
          )}

          {/* PWAP Mean Bar Location Stats */}
          {pwapMeanRow && (
            <div className="stats-module">
              <table className="stats-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan="7" className="module-title" data-tooltip="Bars where close is above or below PWAP Mean">PWAP MEAN BAR LOCATION(ALL)</th>
                  </tr>
                  <tr>
                    <th></th>
                    <th colSpan="3">Above</th>
                    <th colSpan="3">Below</th>
                  </tr>
                  <tr>
                    <th>PWAP</th>
                    <th>Count</th>
                    <th className="up">UP%</th>
                    <th className="dn">DN%</th>
                    <th>Count</th>
                    <th className="up">UP%</th>
                    <th className="dn">DN%</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className={pwapMeanRow.colorClass}>{pwapMeanRow.label}</td>
                    <td>{pwapMeanRow.above} <span className="pct">({pct(pwapMeanRow.above, totalBars)}%)</span></td>
                    <td className={`up${pwapMeanRow.aboveUp > pwapMeanRow.aboveDown ? ' highlight' : ''}`}>{pct(pwapMeanRow.aboveUp, pwapMeanRow.above)}%</td>
                    <td className={`dn${pwapMeanRow.aboveDown > pwapMeanRow.aboveUp ? ' highlight' : ''}`}>{pct(pwapMeanRow.aboveDown, pwapMeanRow.above)}%</td>
                    <td>{pwapMeanRow.below} <span className="pct">({pct(pwapMeanRow.below, totalBars)}%)</span></td>
                    <td className={`up${pwapMeanRow.belowUp > pwapMeanRow.belowDown ? ' highlight' : ''}`}>{pct(pwapMeanRow.belowUp, pwapMeanRow.below)}%</td>
                    <td className={`dn${pwapMeanRow.belowDown > pwapMeanRow.belowUp ? ' highlight' : ''}`}>{pct(pwapMeanRow.belowDown, pwapMeanRow.below)}%</td>
                  </tr>
                </tbody>
                {beyondPwapMeanRow && (
                  <>
                    <thead>
                      <tr className="module-title-row">
                        <th colSpan="7" className="module-title" data-tooltip="Bars entirely above or below PWAP Mean (no part of the bar touches the mean)">PWAP MEAN BAR LOCATION(BEYOND)</th>
                      </tr>
                      <tr>
                        <th></th>
                        <th colSpan="3">Above</th>
                        <th colSpan="3">Below</th>
                      </tr>
                      <tr>
                        <th>PWAP</th>
                        <th>Count</th>
                        <th className="up">UP%</th>
                        <th className="dn">DN%</th>
                        <th>Count</th>
                        <th className="up">UP%</th>
                        <th className="dn">DN%</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className={beyondPwapMeanRow.colorClass}>{beyondPwapMeanRow.label}</td>
                        <td>{beyondPwapMeanRow.above} <span className="pct">({pct(beyondPwapMeanRow.above, totalBars)}%)</span></td>
                        <td className={`up${beyondPwapMeanRow.aboveUp > beyondPwapMeanRow.aboveDown ? ' highlight' : ''}`}>{pct(beyondPwapMeanRow.aboveUp, beyondPwapMeanRow.above)}%</td>
                        <td className={`dn${beyondPwapMeanRow.aboveDown > beyondPwapMeanRow.aboveUp ? ' highlight' : ''}`}>{pct(beyondPwapMeanRow.aboveDown, beyondPwapMeanRow.above)}%</td>
                        <td>{beyondPwapMeanRow.below} <span className="pct">({pct(beyondPwapMeanRow.below, totalBars)}%)</span></td>
                        <td className={`up${beyondPwapMeanRow.belowUp > beyondPwapMeanRow.belowDown ? ' highlight' : ''}`}>{pct(beyondPwapMeanRow.belowUp, beyondPwapMeanRow.below)}%</td>
                        <td className={`dn${beyondPwapMeanRow.belowDown > beyondPwapMeanRow.belowUp ? ' highlight' : ''}`}>{pct(beyondPwapMeanRow.belowDown, beyondPwapMeanRow.below)}%</td>
                      </tr>
                    </tbody>
                  </>
                )}
              </table>
            </div>
          )}

          {/* Wick Distribution (DD_RR) */}
          {_wickDist && (_wickDist.upDist?.length > 0 || _wickDist.dnDist?.length > 0) && (
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
                    {(_wickDist.upDist || _wickDist.dnDist || []).map((row, i) => {
                      const upRow = _wickDist.upDist?.[i];
                      const dnRow = _wickDist.dnDist?.[i];
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

          {/* State x Consecutive Bars Heatmap */}
          {stats.barData && stats.barData.state && (() => {
            const states = [3, 2, 1, -1, -2, -3];
            const stateLabels = { 3: '+3', 2: '+2', 1: '+1', '-1': '-1', '-2': '-2', '-3': '-3' };
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

            // Compute heatmap data client-side from barData
            const bd = stats.barData;
            const colData = bd[expectancyCol] || [];
            const maxConBars = 10;
            const conBarsRange = Array.from({ length: maxConBars }, (_, i) => i + 1);

            // Build lookup: { state -> { conBars -> { sum, count } } }
            const heatmapData = {};
            states.forEach(s => { heatmapData[s] = {}; conBarsRange.forEach(c => { heatmapData[s][c] = { sum: 0, count: 0 }; }); });

            for (let i = 0; i < (bd.state?.length || 0); i++) {
              const state = bd.state[i];
              const val = colData[i];
              if (state == null || val == null || !states.includes(state)) continue;
              const conBars = state > 0 ? bd.conUp?.[i] : bd.conDn?.[i];
              if (conBars == null || conBars < 1 || conBars > maxConBars) continue;
              heatmapData[state][conBars].sum += val;
              heatmapData[state][conBars].count += 1;
            }

            const selectedLabel = expectancyColumns.find(c => c.value === expectancyCol)?.label || expectancyCol;

            return (
              <div className="stats-module">
                <table className="stats-table">
                  <thead>
                    <tr className="module-title-row">
                      <th colSpan={conBarsRange.length + 1} className="module-title" data-tooltip={`Average ${selectedLabel} by State and consecutive bar count. Green = positive, Red = negative. Shows sample count in parentheses.`}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>EXPECTANCY BY STATE/CONSECUTIVE BAR</span>
                          <select
                            value={expectancyCol}
                            onChange={(e) => setExpectancyCol(e.target.value)}
                            style={{ marginLeft: '10px', padding: '2px 6px', fontSize: '11px', background: '#1e293b', color: '#e2e8f0', border: '1px solid #475569', borderRadius: '4px', cursor: 'pointer' }}
                          >
                            {expectancyColumns.map(col => (
                              <option key={col.value} value={col.value}>{col.label}</option>
                            ))}
                          </select>
                        </div>
                      </th>
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
                        <td className={s > 0 ? 'up' : 'dn'} data-tooltip={stateMAOrder[s]}>{stateLabels[s]}</td>
                        {conBarsRange.map(conBars => {
                          const cell = heatmapData[s][conBars];
                          const count = cell.count;
                          const avgRR = count > 0 ? cell.sum / count : null;
                          const dir = s > 0 ? 'up' : 'down';
                          const ordinal = conBars === 1 ? '1st' : conBars === 2 ? '2nd' : conBars === 3 ? '3rd' : `${conBars}th`;
                          const tooltip = count > 0
                            ? `When I'm on the ${ordinal} consecutive ${dir} bar in State ${stateLabels[s]}, the bars in that situation averaged ${avgRR.toFixed(2)} ${selectedLabel}`
                            : null;
                          return (
                            <td key={conBars} style={{ background: cellBg(avgRR), textAlign: 'center' }} title={tooltip}>
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

          {/* State Transition Matrix */}
          {stats.stateTransitionMatrix && stats.stateTransitionMatrix.length > 0 && (() => {
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
                        <th key={s} className={s > 0 ? 'up' : 'dn'} data-tooltip={stateMAOrder[s]}>{stateLabels[s]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.stateTransitionMatrix.map(row => (
                      <tr key={row.fromState}>
                        <td className={row.fromState > 0 ? 'up' : 'dn'} data-tooltip={stateMAOrder[row.fromState]}>{stateLabels[row.fromState]}</td>
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

          {/* MA Hemisphere Analysis */}
          {_hemisphere && _hemisphere.length > 0 && (
            <div className="stats-module">
              <table className="stats-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan="10" className="module-title" data-tooltip="Classifies bars into Buy (above MAs with bullish stacking), Sell (below MAs with bearish stacking), or Neutral zones for each MA combination">MA HEMISPHERE ANALYSIS</th>
                  </tr>
                  <tr>
                    <th></th>
                    <th colSpan="3">Buy</th>
                    <th colSpan="3">Sell</th>
                    <th colSpan="3">Neutral</th>
                  </tr>
                  <tr>
                    <th>Combo</th>
                    <th>Count</th><th className="up">UP%</th><th className="dn">DN%</th>
                    <th>Count</th><th className="up">UP%</th><th className="dn">DN%</th>
                    <th>Count</th><th className="up">UP%</th><th className="dn">DN%</th>
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const maColors = ['#f59e0b', '#3b82f6', '#a855f7']
                    const maPeriods = stats.maPeriods || []
                    const zoneLabels = { buy: 'Buy Hemisphere', sell: 'Sell Hemisphere', neutral: 'Neutral zone' }
                    return _hemisphere.map((row, i) => {
                      if (row === 'sep') return <tr key={`sep-${i}`} className="separator-row"><td colSpan="10"></td></tr>
                      const isSingle = row.idxs.length === 1
                      const comboLabel = isSingle
                        ? <td className={`ma-color-${row.idxs[0] + 1}`}>{row.label}</td>
                        : <td style={{ fontWeight: 600 }}>
                            <span>MA(</span>
                            {row.idxs.map((idx, j) => (
                              <React.Fragment key={idx}>
                                {j > 0 && <span>+</span>}
                                <span style={{ color: maColors[idx] }}>{maPeriods[idx]}</span>
                              </React.Fragment>
                            ))}
                            <span>)</span>
                          </td>
                      return (
                        <tr key={row.label}>
                          {comboLabel}
                          {['buy','sell','neutral'].map(zone => {
                            const zName = zoneLabels[zone]
                            const countPct = pct(row[zone].count, stats.totalBars)
                            const upPct = pct(row[zone].up, row[zone].count)
                            const dnPct = pct(row[zone].dn, row[zone].count)
                            return (
                              <React.Fragment key={zone}>
                                <td title={`${row[zone].count} bars (${countPct}% of total) are in the ${zName} for ${row.label}`}>
                                  {row[zone].count} <span className="pct">({countPct}%)</span>
                                </td>
                                <td className={`up${row[zone].up > row[zone].dn ? ' highlight' : ''}`}
                                    title={`${upPct}% of the bars in the ${zName} are UP bars`}>
                                  {upPct}%
                                </td>
                                <td className={`dn${row[zone].dn > row[zone].up ? ' highlight' : ''}`}
                                    title={`${dnPct}% of the bars in the ${zName} are DN bars`}>
                                  {dnPct}%
                                </td>
                              </React.Fragment>
                            )
                          })}
                        </tr>
                      )
                    })
                  })()}
                </tbody>
              </table>
            </div>
          )}

        </div>
      )}

      {/* ==================== Playground Tab ==================== */}
      {activeTab === 'playground' && (
        <div className="stats-tab-content">
          {/* Signal Definitions */}
          <div className="stats-module module-box playground-signals-module" style={{ position: 'relative' }}>
            {saveToastVisible && (
              <div className="playground-save-toast">Saved</div>
            )}
            <div className="playground-header">
              <span className="module-title-text">SIGNAL DEFINITIONS</span>
              <div className="playground-header-actions">
                <div className="playground-load-wrapper" ref={loadDropdownRef}>
                  <button className="filter-action-btn" onClick={() => setShowLoadDropdown(prev => !prev)}>
                    Load ▼
                  </button>
                  {showLoadDropdown && (
                    <div className="playground-load-dropdown">
                      {savedSignals.length === 0 ? (
                        <div className="playground-load-empty">No saved signals</div>
                      ) : savedSignals.map((s, i) => (
                        <div key={i} className="playground-load-item">
                          <span className="playground-load-item-name" onClick={() => loadPlaygroundSignal(s)}>{s.name}</span>
                          <span className="playground-load-item-expr" onClick={() => loadPlaygroundSignal(s)}>{s.expression}</span>
                          <button
                            className="playground-load-delete"
                            onClick={(e) => { e.stopPropagation(); deletePlaygroundSavedSignal(s.name) }}
                            title="Delete saved signal"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button className="filter-help-btn" onClick={() => setShowPlaygroundHelp(prev => !prev)} title="Help">?</button>
                <button className="filter-action-btn" onClick={addPlaygroundSignal}>+ Add Signal</button>
                <button className="filter-action-btn active" onClick={evaluatePlaygroundSignals} disabled={playgroundLoading}>
                  {playgroundLoading ? 'Evaluating...' : 'Evaluate'}
                </button>
              </div>
            </div>
            {playgroundSignals.map((signal, i) => (
              <div key={i} className={`playground-signal-row${signal.enabled === false ? ' playground-signal-row-disabled' : ''}`}>
                <button
                  className="playground-signal-color"
                  style={signal.enabled === false
                    ? { background: 'transparent', borderColor: PLAYGROUND_COLORS[i % PLAYGROUND_COLORS.length] }
                    : { background: PLAYGROUND_COLORS[i % PLAYGROUND_COLORS.length] }}
                  onClick={() => togglePlaygroundSignal(i)}
                  title={signal.enabled === false ? 'Enable signal' : 'Disable signal'}
                />
                <input
                  className="playground-signal-name"
                  value={signal.name}
                  onChange={e => updatePlaygroundSignal(i, 'name', e.target.value)}
                  placeholder="Name"
                />
                <input
                  className="playground-signal-expr"
                  value={signal.expression}
                  onChange={e => updatePlaygroundSignal(i, 'expression', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') evaluatePlaygroundSignals() }}
                  placeholder="Pandas expression, e.g. State == 3"
                />
                <button
                  className={`playground-signal-save${savedSignals.some(s => s.name === signal.name && s.expression === signal.expression) ? ' saved' : ''}`}
                  onClick={() => savePlaygroundSignal(signal)}
                  title="Save signal to disk"
                >💾</button>
                <button className="playground-signal-remove" onClick={() => removePlaygroundSignal(i)} title="Remove signal">&times;</button>
              </div>
            ))}
            {/* Per-signal errors */}
            {Object.entries(playgroundData.errors || {}).map(([name, msg]) => (
              <div key={name} className="playground-error">
                <strong>{name}:</strong> {msg}
              </div>
            ))}
          </div>

          {/* Cumulative R Curve */}
          <div className="stats-module module-box playground-rcurve-module">
            <div className="equity-curve-header">
              <span className="module-title-text">CUMULATIVE R CURVE</span>
              <span>
                <select
                  className="fx-column-select"
                  value={playgroundRRField}
                  onChange={e => setPlaygroundRRField(e.target.value)}
                >
                  {RR_FIELDS.map(f => (
                    <option key={f.value} value={f.value} title={f.desc}>{f.label}</option>
                  ))}
                </select>
                <button
                  className={`filter-action-btn ${pgComboMode ? 'active' : ''}`}
                  onClick={() => setPgComboMode(prev => !prev)}
                >Combo</button>
              </span>
            </div>
            <Plot
              data={pgComboMode ? pgComboCurveTraces : playgroundCurveTraces}
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
                  title: { text: 'Cumulative R', font: { size: 10 } },
                  gridcolor: 'rgba(255,255,255,0.1)',
                  zeroline: true,
                  zerolinecolor: 'rgba(255,255,255,0.2)',
                },
                showlegend: true,
                legend: { font: { size: 10 }, bgcolor: 'transparent', x: 0, y: 1 },
              }}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%' }}
            />
          </div>

          {/* Signal Performance Table */}
          {(() => {
            const enabledSignals = playgroundSignals.filter(s => s.enabled !== false)
            if (pgComboMode && pgComboStats) {
              return (
              <div className="stats-module">
                <table className="stats-table">
                  <thead>
                    <tr className="module-title-row">
                      <th colSpan={2} className="module-title">SIGNAL PERFORMANCE</th>
                    </tr>
                    <tr>
                      <th></th>
                      <th style={{ color: '#facc15' }}>Combo</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr><td>Count</td><td>{pgComboStats.count}</td></tr>
                    <tr><td>Avg RR</td><td>{pgComboStats.avgRR}</td></tr>
                    <tr><td>Win Rate</td><td>{pgComboStats.winRate}%</td></tr>
                  </tbody>
                </table>
                <table className="stats-table" style={{ marginTop: '8px' }}>
                  <thead>
                    <tr className="module-title-row">
                      <th colSpan={2} className="module-title">RR DISTRIBUTION</th>
                    </tr>
                    <tr>
                      <th>Bucket</th>
                      <th style={{ color: '#facc15' }}>Combo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {RR_BUCKETS.map(bucket => {
                      const d = pgComboStats.dist?.find(d => d.label === bucket.label)
                      return <tr key={bucket.label}><td>{bucket.label}</td><td>{d ? `${d.count} (${d.pct}%)` : '—'}</td></tr>
                    })}
                  </tbody>
                </table>
              </div>
              )
            }
            return (
            <div className="stats-module">
              <table className="stats-table">
                <thead>
                  <tr className="module-title-row">
                    <th colSpan={enabledSignals.length + 1} className="module-title">SIGNAL PERFORMANCE</th>
                  </tr>
                  <tr>
                    <th></th>
                    {enabledSignals.map((s, i) => (
                      <th key={s.name + i} style={{ color: PLAYGROUND_COLORS[playgroundSignals.indexOf(s) % PLAYGROUND_COLORS.length] }}>{s.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Count</td>
                    {enabledSignals.map((s, i) => (
                      <td key={s.name + i}>{playgroundStats[s.name]?.count ?? '—'}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Avg RR</td>
                    {enabledSignals.map((s, i) => (
                      <td key={s.name + i}>{playgroundStats[s.name]?.avgRR ?? '—'}</td>
                    ))}
                  </tr>
                  <tr>
                    <td>Win Rate</td>
                    {enabledSignals.map((s, i) => {
                      const st = playgroundStats[s.name]
                      return <td key={s.name + i}>{st ? `${st.winRate}%` : '—'}</td>
                    })}
                  </tr>
                </tbody>
              </table>

              {/* RR Distribution */}
              <table className="stats-table" style={{ marginTop: '8px' }}>
                <thead>
                  <tr className="module-title-row">
                    <th colSpan={enabledSignals.length + 1} className="module-title">RR DISTRIBUTION</th>
                  </tr>
                  <tr>
                    <th>Bucket</th>
                    {enabledSignals.map((s, i) => (
                      <th key={s.name + i} style={{ color: PLAYGROUND_COLORS[playgroundSignals.indexOf(s) % PLAYGROUND_COLORS.length] }}>{s.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RR_BUCKETS.map(bucket => (
                    <tr key={bucket.label}>
                      <td>{bucket.label}</td>
                      {enabledSignals.map((s, i) => {
                        const d = playgroundStats[s.name]?.dist?.find(d => d.label === bucket.label)
                        return <td key={s.name + i}>{d ? `${d.count} (${d.pct}%)` : '—'}</td>
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )
          })()}

          {/* Help Panel (Portal) */}
          {showPlaygroundHelp && ReactDOM.createPortal(
            <div className="filter-help-panel" style={{ left: pgHelpPos.x, top: pgHelpPos.y }}>
              <div
                className={`filter-help-panel-header ${pgDragging ? 'grabbing' : ''}`}
                onMouseDown={(e) => {
                  pgDragOffset.current = { x: e.clientX - pgHelpPos.x, y: e.clientY - pgHelpPos.y }
                  setPgDragging(true)
                }}
              >
                <span className="filter-help-panel-title">Playground — Pandas Query Syntax</span>
                <button className="filter-help-close" onClick={() => setShowPlaygroundHelp(false)}>&times;</button>
              </div>
              <div className="filter-help-panel-body">
                <p>Enter a <strong>pandas query expression</strong> to define each signal. Matching rows become signal occurrences, and their MFE/RR metrics are plotted.</p>

                <h4>Operators</h4>
                <table className="filter-help-table">
                  <thead>
                    <tr><th>Operator</th><th>Meaning</th><th>Example</th></tr>
                  </thead>
                  <tbody>
                    <tr><td><code>==</code></td><td>equals</td><td><code>State == 3</code></td></tr>
                    <tr><td><code>!=</code></td><td>not equal</td><td><code>State != 0</code></td></tr>
                    <tr><td><code>&gt;</code> <code>&gt;=</code></td><td>greater than</td><td><code>State &gt;= 2</code></td></tr>
                    <tr><td><code>&lt;</code> <code>&lt;=</code></td><td>less than</td><td><code>DD_RR &lt; 0.5</code></td></tr>
                    <tr><td><code>and</code></td><td>both conditions</td><td><code>Type1 == 1 and State &gt; 0</code></td></tr>
                    <tr><td><code>or</code></td><td>either condition</td><td><code>Type1 == 1 or Type2 == 1</code></td></tr>
                    <tr><td><code>in</code></td><td>matches any in list</td><td><code>State in [2, 3]</code></td></tr>
                    <tr><td><code>not in</code></td><td>excludes list</td><td><code>State not in [-1, 0, 1]</code></td></tr>
                  </tbody>
                </table>

                <h4>Examples</h4>
                <ul>
                  <li><code>State == 3</code> — fast &gt; med &gt; slow</li>
                  <li><code>State == -3</code> — fast &lt; med &lt; slow</li>
                  <li><code>Type1 &gt; 0 and low &lt; MA1</code> — Type1 UP w/low below MA1</li>
                  <li><code>DD_RR &lt; 0.3 and State in [2, 3]</code> — small wicks in states 2 or 3</li>
                  <li><code>Con_UP_bars &gt;= 3</code> — 3+ consecutive UP bars</li>
                </ul>

                <h4>Available Columns</h4>

                <h5>System</h5>
                <ul>
                  <ColumnItem label="currentADR" desc={COLUMN_DESCRIPTIONS['currentADR']} />
                  <ColumnItem label="chop(rolling)" desc={COLUMN_DESCRIPTIONS['chop(rolling)']} />
                </ul>

                <h5>Signals</h5>
                <ul>
                  <ColumnItem label="Type1" desc={COLUMN_DESCRIPTIONS['Type1']} />
                  <ColumnItem label="Type2" desc={COLUMN_DESCRIPTIONS['Type2']} />
                </ul>

                <h5>OHLC &amp; Price</h5>
                <ul>
                  <ColumnItem label="open, high, low, close, direction" desc={COLUMN_DESCRIPTIONS['open, high, low, close, direction']} />
                  <ColumnItem label="open1, high1, low1, close1, direction1" desc={COLUMN_DESCRIPTIONS['open1, high1, low1, close1, direction1']} />
                  <ColumnItem label="open2, high2, low2, close2, direction2" desc={COLUMN_DESCRIPTIONS['open2, high2, low2, close2, direction2']} />
                </ul>

                <h5>Moving Averages</h5>
                <ul>
                  <ColumnItem label="EMA_rawDistance(20/50/200)" desc={COLUMN_DESCRIPTIONS['EMA_rawDistance(20/50/200)']} />
                  <ColumnItem label="EMA_adrDistance(20/50/200)" desc={COLUMN_DESCRIPTIONS['EMA_adrDistance(20/50/200)']} />
                  <ColumnItem label="EMA_rrDistance(20/50/200)" desc={COLUMN_DESCRIPTIONS['EMA_rrDistance(20/50/200)']} />
                  <ColumnItem label="MA1, MA2, MA3" desc={COLUMN_DESCRIPTIONS['MA1, MA2, MA3']} />
                  <ColumnItem label="MA1_1, MA2_1, MA3_1" desc={COLUMN_DESCRIPTIONS['MA1_1, MA2_1, MA3_1']} />
                  <ColumnItem label="MA1_2, MA2_2, MA3_2" desc={COLUMN_DESCRIPTIONS['MA1_2, MA2_2, MA3_2']} />
                </ul>

                <h5>SMAE Channel</h5>
                <ul>
                  <ColumnItem label="SMAE1_Upper, SMAE1_Lower" desc={COLUMN_DESCRIPTIONS['SMAE1_Upper, SMAE1_Lower']} />
                  <ColumnItem label="SMAE2_Upper, SMAE2_Lower" desc={COLUMN_DESCRIPTIONS['SMAE2_Upper, SMAE2_Lower']} />
                </ul>

                <h5>PWAP</h5>
                <ul>
                  <ColumnItem label="PWAP_Mean" desc={COLUMN_DESCRIPTIONS['PWAP_Mean']} />
                  <ColumnItem label="PWAP_Upper1, PWAP_Lower1" desc={COLUMN_DESCRIPTIONS['PWAP_Upper1, PWAP_Lower1']} />
                  <ColumnItem label="PWAP_Upper2, PWAP_Lower2" desc={COLUMN_DESCRIPTIONS['PWAP_Upper2, PWAP_Lower2']} />
                  <ColumnItem label="PWAP_Upper3, PWAP_Lower3" desc={COLUMN_DESCRIPTIONS['PWAP_Upper3, PWAP_Lower3']} />
                  <ColumnItem label="PWAP_Upper4, PWAP_Lower4" desc={COLUMN_DESCRIPTIONS['PWAP_Upper4, PWAP_Lower4']} />
                  <ColumnItem label="PWAP_distance_RR" desc={COLUMN_DESCRIPTIONS['PWAP_distance_RR']} />
                  <ColumnItem label="PWAP_distance_ADR" desc={COLUMN_DESCRIPTIONS['PWAP_distance_ADR']} />
                </ul>

                <h5>State &amp; Structure</h5>
                <ul>
                  <ColumnItem label="State" desc={COLUMN_DESCRIPTIONS['State']} />
                  <ColumnItem label="prState" desc={COLUMN_DESCRIPTIONS['prState']} />
                  <ColumnItem label="fromState" desc={COLUMN_DESCRIPTIONS['fromState']} />
                  <ColumnItem label="stateBarCount" desc={COLUMN_DESCRIPTIONS['stateBarCount']} />
                </ul>

                <h5>Consecutive Bars</h5>
                <ul>
                  <ColumnItem label="Con_UP_bars" desc={COLUMN_DESCRIPTIONS['Con_UP_bars']} />
                  <ColumnItem label="Con_DN_bars" desc={COLUMN_DESCRIPTIONS['Con_DN_bars']} />
                  <ColumnItem label="Con_UP_bars(state)" desc={COLUMN_DESCRIPTIONS['Con_UP_bars(state)']} />
                  <ColumnItem label="Con_DN_bars(state)" desc={COLUMN_DESCRIPTIONS['Con_DN_bars(state)']} />
                  <ColumnItem label="priorRunCount" desc={COLUMN_DESCRIPTIONS['priorRunCount']} />
                </ul>

                <h5>Drawdown/Wick</h5>
                <ul>
                  <ColumnItem label="DD" desc={COLUMN_DESCRIPTIONS['DD']} />
                  <ColumnItem label="DD_RR" desc={COLUMN_DESCRIPTIONS['DD_RR']} />
                  <ColumnItem label="DD_ADR" desc={COLUMN_DESCRIPTIONS['DD_ADR']} />
                </ul>

                <h5>Duration</h5>
                <ul>
                  <ColumnItem label="barDuration" desc={COLUMN_DESCRIPTIONS['barDuration']} />
                  <ColumnItem label="stateDuration" desc={COLUMN_DESCRIPTIONS['stateDuration']} />
                </ul>

                <h5>MFE / Outcome Metrics</h5>
                <ul>
                  <ColumnItem label="MFE_clr_Bars" desc={COLUMN_DESCRIPTIONS['MFE_clr_Bars']} />
                  <ColumnItem label="MFE_clr_price" desc={COLUMN_DESCRIPTIONS['MFE_clr_price']} />
                  <ColumnItem label="MFE_clr_ADR" desc={COLUMN_DESCRIPTIONS['MFE_clr_ADR']} />
                  <ColumnItem label="MFE_clr_RR" desc={COLUMN_DESCRIPTIONS['MFE_clr_RR']} />
                  <ColumnItem label="REAL_clr_ADR" desc={COLUMN_DESCRIPTIONS['REAL_clr_ADR']} />
                  <ColumnItem label="REAL_clr_RR" desc={COLUMN_DESCRIPTIONS['REAL_clr_RR']} />
                  <ColumnItem label="REAL_MA1_Price, REAL_MA1_ADR, REAL_MA1_RR" desc={COLUMN_DESCRIPTIONS['REAL_MA1_Price, REAL_MA1_ADR, REAL_MA1_RR']} />
                  <ColumnItem label="REAL_MA2_Price, REAL_MA2_ADR, REAL_MA2_RR" desc={COLUMN_DESCRIPTIONS['REAL_MA2_Price, REAL_MA2_ADR, REAL_MA2_RR']} />
                  <ColumnItem label="REAL_MA3_Price, REAL_MA3_ADR, REAL_MA3_RR" desc={COLUMN_DESCRIPTIONS['REAL_MA3_Price, REAL_MA3_ADR, REAL_MA3_RR']} />
                </ul>

                <h4>Tips</h4>
                <ul>
                  <li>Column names are case-sensitive</li>
                  <li>Use <code>and</code> / <code>or</code> (not <code>&amp;&amp;</code> / <code>||</code>)</li>
                  <li>Group with parentheses: <code>(A or B) and C</code></li>
                  <li>Press Enter in any expression field to evaluate</li>
                </ul>
              </div>
            </div>,
            document.body
          )}
        </div>
      )}

      {/* ==================== Backtest Tab ==================== */}
      {activeTab === 'backtest' && (
        <div className="stats-tab-content">

          {/* Config Module */}
          <div className="stats-module module-box backtest-config-module">
            <div className="backtest-config-header">
              <span className="module-title-text">BACKTEST CONFIG</span>
            </div>
            <div className="backtest-config-grid">
              <div className="backtest-config-group">
                <label className="backtest-config-label">Stop</label>
                <select
                  className="backtest-config-select"
                  value={btStopType}
                  onChange={e => setBtStopType(e.target.value)}
                >
                  <option value="rr">RR</option>
                  <option value="adr">ADR</option>
                </select>
                <input
                  type="number"
                  className="backtest-config-input"
                  value={btStopValue}
                  step="0.5"
                  min="0.5"
                  onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setBtStopValue(v) }}
                />
              </div>
              <div className="backtest-config-group">
                <label className="backtest-config-label">Target</label>
                <select
                  className="backtest-config-select"
                  value={btTargetType}
                  onChange={e => setBtTargetType(e.target.value)}
                >
                  <option value="fixed_rr">Fixed RR</option>
                  <option value="fixed_adr">Fixed ADR</option>
                  <option value="ma_trail">MA Trail</option>
                  <option value="color_change">Color Change</option>
                </select>
                {btTargetType !== 'color_change' && btTargetType !== 'ma_trail' && (
                  <input
                    type="number"
                    className="backtest-config-input"
                    value={btTargetValue}
                    step="0.5"
                    min="0.5"
                    onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v)) setBtTargetValue(v) }}
                  />
                )}
                {btTargetType === 'ma_trail' && (
                  <select
                    className="backtest-config-select"
                    value={btTargetMA}
                    onChange={e => setBtTargetMA(parseInt(e.target.value))}
                  >
                    <option value={1}>MA1</option>
                    <option value={2}>MA2</option>
                    <option value={3}>MA3</option>
                  </select>
                )}
              </div>
              <div className="backtest-config-group">
                <label className="backtest-config-label">Report</label>
                <select
                  className="backtest-config-select"
                  value={btReportUnit}
                  onChange={e => setBtReportUnit(e.target.value)}
                >
                  <option value="rr">RR</option>
                  <option value="adr">ADR</option>
                </select>
              </div>
              <div className="backtest-config-group" data-tooltip="When checked, a new trade will not be entered while an existing trade is still open">
                <label className="backtest-config-label" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <input
                    type="checkbox"
                    checked={!btAllowOverlap}
                    onChange={e => setBtAllowOverlap(!e.target.checked)}
                    style={{ margin: 0 }}
                  />
                  One Trade at a Time
                </label>
              </div>
            </div>
          </div>

          {/* Signal Definitions */}
          <div className="stats-module module-box backtest-signals-module" style={{ position: 'relative' }}>
            {btSaveToastVisible && (
              <div className="playground-save-toast">Saved</div>
            )}
            <div className="playground-header">
              <span className="module-title-text">SIGNAL DEFINITIONS</span>
              <div className="playground-header-actions">
                <div className="playground-load-wrapper" ref={btLoadDropdownRef}>
                  <button className="filter-action-btn" onClick={() => setShowBtLoadDropdown(prev => !prev)}>
                    Load ▼
                  </button>
                  {showBtLoadDropdown && (
                    <div className="playground-load-dropdown">
                      {btSavedSignals.length === 0 ? (
                        <div className="playground-load-empty">No saved signals</div>
                      ) : btSavedSignals.map((s, i) => (
                        <div key={i} className="playground-load-item">
                          <span className="playground-load-item-name" onClick={() => loadBtSignal(s)}>{s.name}</span>
                          <span className="playground-load-item-expr" onClick={() => loadBtSignal(s)}>{s.expression}</span>
                          <button
                            className="playground-load-delete"
                            onClick={(e) => { e.stopPropagation(); deleteBtSavedSignal(s.name) }}
                            title="Delete saved signal"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                              <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <button className="filter-help-btn" onClick={() => setShowBtHelp(prev => !prev)} title="Help">?</button>
                <button className="filter-action-btn" onClick={addBtSignal}>+ Add Signal</button>
                <button className="filter-action-btn active" onClick={evaluateBacktest} disabled={btLoading}>
                  {btLoading ? 'Running...' : 'Run Backtest'}
                </button>
              </div>
            </div>
            {btSignals.map((signal, i) => (
              <div key={i} className={`playground-signal-row${signal.enabled === false ? ' playground-signal-row-disabled' : ''}`}>
                <button
                  className="playground-signal-color"
                  style={signal.enabled === false
                    ? { background: 'transparent', borderColor: PLAYGROUND_COLORS[i % PLAYGROUND_COLORS.length] }
                    : { background: PLAYGROUND_COLORS[i % PLAYGROUND_COLORS.length] }}
                  onClick={() => toggleBtSignal(i)}
                  title={signal.enabled === false ? 'Enable signal' : 'Disable signal'}
                />
                <input
                  className="playground-signal-name"
                  value={signal.name}
                  onChange={e => updateBtSignal(i, 'name', e.target.value)}
                  placeholder="Name"
                />
                <input
                  className="playground-signal-expr"
                  value={signal.expression}
                  onChange={e => updateBtSignal(i, 'expression', e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') evaluateBacktest() }}
                  placeholder="Pandas expression, e.g. State == 3"
                />
                <button
                  className={`playground-signal-save${btSavedSignals.some(s => s.name === signal.name && s.expression === signal.expression) ? ' saved' : ''}`}
                  onClick={() => saveBtSignal(signal)}
                  title="Save signal to disk"
                >💾</button>
                <button className="playground-signal-remove" onClick={() => removeBtSignal(i)} title="Remove signal">&times;</button>
              </div>
            ))}
            {Object.entries(btData.errors || {}).map(([name, msg]) => (
              <div key={name} className="playground-error">
                <strong>{name}:</strong> {msg}
              </div>
            ))}
          </div>

          {/* Equity Curve */}
          {btCurveTraces.length > 0 && (() => {
            const btShowCombo = !btAllowOverlap || btComboMode
            return (
            <div className="stats-module module-box backtest-curve-module">
              <div className="equity-curve-header">
                <span className="module-title-text">EQUITY CURVE (CUMULATIVE {btReportUnit.toUpperCase()})</span>
                {btAllowOverlap && (
                  <button
                    className={`filter-action-btn ${btComboMode ? 'active' : ''}`}
                    onClick={() => setBtComboMode(prev => !prev)}
                  >Combo</button>
                )}
              </div>
              <Plot
                data={btShowCombo ? btComboCurveTraces : btCurveTraces}
                layout={{
                  height: 300,
                  margin: { t: 8, r: 16, b: 40, l: 50 },
                  paper_bgcolor: '#000000',
                  plot_bgcolor: '#000000',
                  font: { family: 'monospace', size: 11, color: '#a0a0b0' },
                  xaxis: {
                    title: { text: 'Trade #', font: { size: 10 } },
                    gridcolor: 'rgba(255,255,255,0.1)',
                    zeroline: false,
                  },
                  yaxis: {
                    title: { text: `Cumulative ${btReportUnit.toUpperCase()}`, font: { size: 10 } },
                    gridcolor: 'rgba(255,255,255,0.1)',
                    zeroline: true,
                    zerolinecolor: 'rgba(255,255,255,0.2)',
                  },
                  showlegend: true,
                  legend: { font: { size: 10 }, bgcolor: 'transparent', x: 0, y: 1 },
                }}
                config={{ displayModeBar: false, responsive: true }}
                style={{ width: '100%' }}
              />
            </div>
            )
          })()}

          {/* Summary Stats Table + Chart wrapper */}
          {(() => {
            const enabledSignals = btSignals.filter(s => s.enabled !== false)
            const hasSummary = enabledSignals.some(s => btData.signals?.[s.name]?.summary)
            if (!hasSummary && !(btChartTrades.length > 0 && stats?.barData)) return null
            const btShowCombo = !btAllowOverlap || btComboMode
            return (
              <div className="backtest-summary-chart-wrapper">
                {hasSummary && (
              <div className="stats-module module-box backtest-stats-module">
                <table className="stats-table">
                  <thead>
                    <tr className="module-title-row">
                      <th colSpan={16} className="module-title">BACKTEST SUMMARY</th>
                    </tr>
                    <tr>
                      <th>Signal</th>
                      <th>Count</th>
                      <th>Wins</th>
                      <th>Losses</th>
                      <th>Open</th>
                      <th>Win %</th>
                      <th>Avg Win</th>
                      <th>Avg Loss</th>
                      <th data-tooltip="Profit Factor — gross wins / gross losses. Above 1.0 = profitable.">PF</th>
                      <th data-tooltip="Expectancy — average result per closed trade. Positive = profitable on average.">Expect.</th>
                      <th>Total {btReportUnit.toUpperCase()}</th>
                      <th data-tooltip="Max Drawdown — largest peak-to-trough decline in equity curve.">Max DD</th>
                      <th data-tooltip="Sharpe Ratio — mean trade result / std deviation. Higher = more consistent.">Sharpe</th>
                      <th data-tooltip="Max Consecutive Wins — longest winning streak.">W Streak</th>
                      <th data-tooltip="Max Consecutive Losses — longest losing streak.">L Streak</th>
                      <th data-tooltip="Avg Bars Held — average trade duration in renko bars.">Avg Bars</th>
                    </tr>
                  </thead>
                  <tbody>
                    {enabledSignals.map((s, i) => {
                      const sm = btData.signals?.[s.name]?.summary
                      if (!sm) return null
                      return (
                        <tr key={s.name + i}>
                          <td style={{ color: PLAYGROUND_COLORS[btSignals.indexOf(s) % PLAYGROUND_COLORS.length], fontWeight: 600 }}>{s.name}</td>
                          <td>{sm.count}</td>
                          <td className="up">{sm.wins}</td>
                          <td className="dn">{sm.losses}</td>
                          <td>{sm.open}</td>
                          <td>{(sm.win_rate * 100).toFixed(1)}%</td>
                          <td className="up">{sm.avg_win}</td>
                          <td className="dn">{sm.avg_loss}</td>
                          <td>{sm.profit_factor}</td>
                          <td style={{ color: sm.expectancy >= 0 ? '#22c55e' : '#ef4444' }}>{sm.expectancy}</td>
                          <td style={{ fontWeight: 600, color: sm.total_r >= 0 ? '#22c55e' : '#ef4444' }}>{sm.total_r}</td>
                          <td className="dn">{sm.max_drawdown}</td>
                          <td>{sm.sharpe != null ? sm.sharpe : '\u2014'}</td>
                          <td className="up">{sm.max_consec_wins}</td>
                          <td className="dn">{sm.max_consec_losses}</td>
                          <td>{sm.avg_bars_held}</td>
                        </tr>
                      )
                    })}
                    {btShowCombo && btComboStats && (
                      <tr style={{ borderTop: '2px solid rgba(250,204,21,0.3)' }}>
                        <td style={{ color: '#facc15', fontWeight: 600 }}>Combo</td>
                        <td>{btComboStats.count}</td>
                        <td className="up">{btComboStats.wins}</td>
                        <td className="dn">{btComboStats.losses}</td>
                        <td>{btComboStats.open}</td>
                        <td>{(btComboStats.win_rate * 100).toFixed(1)}%</td>
                        <td className="up">{btComboStats.avg_win}</td>
                        <td className="dn">{btComboStats.avg_loss}</td>
                        <td>{btComboStats.profit_factor}</td>
                        <td style={{ color: btComboStats.expectancy >= 0 ? '#22c55e' : '#ef4444' }}>{btComboStats.expectancy}</td>
                        <td style={{ fontWeight: 600, color: btComboStats.total_r >= 0 ? '#22c55e' : '#ef4444' }}>{btComboStats.total_r}</td>
                        <td className="dn">{btComboStats.max_drawdown}</td>
                        <td>{btComboStats.sharpe != null ? btComboStats.sharpe : '\u2014'}</td>
                        <td className="up">{btComboStats.max_consec_wins}</td>
                        <td className="dn">{btComboStats.max_consec_losses}</td>
                        <td>{btComboStats.avg_bars_held}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                )}
          {btChartTrades.length > 0 && stats?.barData && (
            <div className="stats-module module-box backtest-chart-module">
              <div className="backtest-chart-header">
                <span className="module-title-text"></span>
                <div className="backtest-chart-controls">
                  {btShowChart && (
                    <>
                      <label className="backtest-config-label">Decimals</label>
                      <select
                        className="backtest-config-select"
                        value={btChartDecimals}
                        onChange={e => setBtChartDecimals(parseInt(e.target.value))}
                      >
                        <option value={1}>1</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                        <option value={4}>4</option>
                        <option value={5}>5</option>
                      </select>
                      <label className="backtest-config-label">Line</label>
                      <select
                        className="backtest-config-select"
                        value={btLineWeight}
                        onChange={e => setBtLineWeight(parseFloat(e.target.value))}
                      >
                        <option value={1}>1</option>
                        <option value={1.5}>1.5</option>
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                      </select>
                      <select
                        className="backtest-config-select"
                        value={btLineStyle}
                        onChange={e => setBtLineStyle(e.target.value)}
                      >
                        <option value="solid">Solid</option>
                        <option value="dashed">Dashed</option>
                        <option value="dotted">Dotted</option>
                      </select>
                      <label className="backtest-config-label">Marker</label>
                      <select
                        className="backtest-config-select"
                        value={btMarkerSize}
                        onChange={e => setBtMarkerSize(parseInt(e.target.value))}
                      >
                        <option value={2}>2</option>
                        <option value={3}>3</option>
                        <option value={4}>4</option>
                        <option value={5}>5</option>
                        <option value={6}>6</option>
                      </select>
                      <button
                        className={`filter-action-btn${btShowIndicator ? ' active' : ''}`}
                        onClick={() => setBtShowIndicator(p => !p)}
                      >Indicator</button>
                      <button
                        className={`filter-action-btn${btShowEMA ? ' active' : ''}`}
                        onClick={() => setBtShowEMA(p => !p)}
                      >EMA</button>
                      <button
                        className={`filter-action-btn${btShowSMAE ? ' active' : ''}`}
                        onClick={() => setBtShowSMAE(p => !p)}
                        disabled={!stats?.barData?.smae1Center}
                      >ENV</button>
                      <button
                        className={`filter-action-btn${btShowPWAP ? ' active' : ''}`}
                        onClick={() => setBtShowPWAP(p => !p)}
                        disabled={!stats?.barData?.pwapMean}
                      >PWAP</button>
                    </>
                  )}
                  <button
                    className={`filter-action-btn${btShowChart ? ' active' : ''}`}
                    onClick={() => setBtShowChart(p => !p)}
                  >{btShowChart ? 'Hide' : 'Show Chart'}</button>
                </div>
              </div>
              {btShowChart && (
                <div className="backtest-chart-tradelog-wrapper">
                  <div className="backtest-chart-container" style={{ height: btChartHeight }}>
                    <BacktestChart
                      barData={stats.barData}
                      trades={btChartTrades}
                      pricePrecision={btChartDecimals}
                      showIndicator={btShowIndicator}
                      focusBar={btFocusBar}
                      lineWeight={btLineWeight}
                      lineStyle={btLineStyle}
                      markerSize={btMarkerSize}
                      showEMA={btShowEMA}
                      showSMAE={btShowSMAE}
                      showPWAP={btShowPWAP}
                      sessionBreaks={stats.sessionBreaks || []}
                    />
                  </div>
                  <div className="backtest-chart-resize-handle" onMouseDown={handleChartResizeMouseDown}>
                    <div className="resize-handle-grip" />
                  </div>
                  {(() => {
                    const enabledSignals = btSignals.filter(s => s.enabled !== false)
                    const allTrades = []
                    enabledSignals.forEach(s => {
                      const sigData = btData.signals?.[s.name]
                      if (sigData?.trades) {
                        sigData.trades.forEach(t => allTrades.push({ ...t, signalName: s.name, signalIdx: btSignals.indexOf(s) }))
                      }
                    })
                    if (allTrades.length === 0) return null

                    const filteredTrades = btSignalFilter === 'all'
                      ? allTrades.sort((a, b) => a.idx - b.idx)
                      : allTrades.filter(t => t.signalName === btSignalFilter).sort((a, b) => a.idx - b.idx)

                    return (
                      <div className="stats-module module-box backtest-tradelog-module">
                        <div className="backtest-tradelog-header">
                          <span className="module-title-text">TRADE LOG ({filteredTrades.length} trades)</span>
                          <select
                            className="backtest-config-select"
                            value={btSignalFilter}
                            onChange={e => setBtSignalFilter(e.target.value)}
                          >
                            <option value="all">All Signals</option>
                            {enabledSignals.map(s => (
                              <option key={s.name} value={s.name}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                        <div className="backtest-tradelog-scroll">
                          <table className="stats-table backtest-tradelog-table">
                            <thead>
                              <tr>
                                <th>#</th>
                                <th>Signal</th>
                                <th>Entry Date</th>
                                <th>Entry Price</th>
                                <th>Bar#</th>
                                <th>Dir</th>
                                <th>Outcome</th>
                                <th>Result</th>
                                <th>Bars</th>
                                <th>Exit Date</th>
                                <th>Exit Price</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredTrades.map((t, i) => (
                                <tr
                                  key={i}
                                  className={
                                    t.outcome === 'open' ? 'backtest-trade-open' :
                                    t.result > 0 ? 'backtest-trade-win' :
                                    'backtest-trade-loss'
                                  }
                                  style={{ cursor: 'pointer' }}
                                  onClick={() => setBtFocusBar({ idx: t.idx, ts: Date.now() })}
                                >
                                  <td>{i + 1}</td>
                                  <td style={{ color: PLAYGROUND_COLORS[t.signalIdx % PLAYGROUND_COLORS.length] }}>{t.signalName}</td>
                                  <td>{t.entry_dt}</td>
                                  <td>{t.entry_price}</td>
                                  <td>{t.idx}</td>
                                  <td className={t.direction === 'long' ? 'up' : 'dn'}>{t.direction === 'long' ? 'L' : 'S'}</td>
                                  <td>{t.outcome === 'target' ? 'W' : t.outcome === 'stop' ? 'L' : 'Open'}</td>
                                  <td style={{ color: t.result >= 0 ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                                    {t.result >= 0 ? '+' : ''}{t.result}
                                  </td>
                                  <td>{t.bars_held}</td>
                                  <td>{t.exit_dt}</td>
                                  <td>{t.exit_price}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )
                  })()}
                </div>
              )}
            </div>
          )}
              </div>
            )
          })()}

          {/* Help Panel (Portal) */}
          {showBtHelp && ReactDOM.createPortal(
            <div className="filter-help-panel" style={{ left: btHelpPos.x, top: btHelpPos.y }}>
              <div
                className={`filter-help-panel-header ${btDragging ? 'grabbing' : ''}`}
                onMouseDown={(e) => {
                  btDragOffset.current = { x: e.clientX - btHelpPos.x, y: e.clientY - btHelpPos.y }
                  setBtDragging(true)
                }}
              >
                <span className="filter-help-panel-title">Backtest — Pandas Query Syntax</span>
                <button className="filter-help-close" onClick={() => setShowBtHelp(false)}>&times;</button>
              </div>
              <div className="filter-help-panel-body">
                <p>Enter a <strong>pandas query expression</strong> to define each signal. Matching rows become signal occurrences, and their MFE/RR metrics are plotted.</p>

                <h4>Operators</h4>
                <table className="filter-help-table">
                  <thead>
                    <tr><th>Operator</th><th>Meaning</th><th>Example</th></tr>
                  </thead>
                  <tbody>
                    <tr><td><code>==</code></td><td>equals</td><td><code>State == 3</code></td></tr>
                    <tr><td><code>!=</code></td><td>not equal</td><td><code>State != 0</code></td></tr>
                    <tr><td><code>&gt;</code> <code>&gt;=</code></td><td>greater than</td><td><code>State &gt;= 2</code></td></tr>
                    <tr><td><code>&lt;</code> <code>&lt;=</code></td><td>less than</td><td><code>DD_RR &lt; 0.5</code></td></tr>
                    <tr><td><code>and</code></td><td>both conditions</td><td><code>Type1 == 1 and State &gt; 0</code></td></tr>
                    <tr><td><code>or</code></td><td>either condition</td><td><code>Type1 == 1 or Type2 == 1</code></td></tr>
                    <tr><td><code>in</code></td><td>matches any in list</td><td><code>State in [2, 3]</code></td></tr>
                    <tr><td><code>not in</code></td><td>excludes list</td><td><code>State not in [-1, 0, 1]</code></td></tr>
                  </tbody>
                </table>

                <h4>Examples</h4>
                <ul>
                  <li><code>State == 3</code> — fast &gt; med &gt; slow</li>
                  <li><code>State == -3</code> — fast &lt; med &lt; slow</li>
                  <li><code>Type1 &gt; 0 and low &lt; MA1</code> — Type1 UP w/low below MA1</li>
                  <li><code>DD_RR &lt; 0.3 and State in [2, 3]</code> — small wicks in states 2 or 3</li>
                  <li><code>Con_UP_bars &gt;= 3</code> — 3+ consecutive UP bars</li>
                </ul>

                <h4>Available Columns</h4>

                <h5>System</h5>
                <ul>
                  <ColumnItem label="currentADR" desc={COLUMN_DESCRIPTIONS['currentADR']} />
                  <ColumnItem label="chop(rolling)" desc={COLUMN_DESCRIPTIONS['chop(rolling)']} />
                </ul>

                <h5>Signals</h5>
                <ul>
                  <ColumnItem label="Type1" desc={COLUMN_DESCRIPTIONS['Type1']} />
                  <ColumnItem label="Type2" desc={COLUMN_DESCRIPTIONS['Type2']} />
                </ul>

                <h5>OHLC &amp; Price</h5>
                <ul>
                  <ColumnItem label="open, high, low, close, direction" desc={COLUMN_DESCRIPTIONS['open, high, low, close, direction']} />
                  <ColumnItem label="open1, high1, low1, close1, direction1" desc={COLUMN_DESCRIPTIONS['open1, high1, low1, close1, direction1']} />
                  <ColumnItem label="open2, high2, low2, close2, direction2" desc={COLUMN_DESCRIPTIONS['open2, high2, low2, close2, direction2']} />
                </ul>

                <h5>Moving Averages</h5>
                <ul>
                  <ColumnItem label="EMA_rawDistance(20/50/200)" desc={COLUMN_DESCRIPTIONS['EMA_rawDistance(20/50/200)']} />
                  <ColumnItem label="EMA_adrDistance(20/50/200)" desc={COLUMN_DESCRIPTIONS['EMA_adrDistance(20/50/200)']} />
                  <ColumnItem label="EMA_rrDistance(20/50/200)" desc={COLUMN_DESCRIPTIONS['EMA_rrDistance(20/50/200)']} />
                  <ColumnItem label="MA1, MA2, MA3" desc={COLUMN_DESCRIPTIONS['MA1, MA2, MA3']} />
                  <ColumnItem label="MA1_1, MA2_1, MA3_1" desc={COLUMN_DESCRIPTIONS['MA1_1, MA2_1, MA3_1']} />
                  <ColumnItem label="MA1_2, MA2_2, MA3_2" desc={COLUMN_DESCRIPTIONS['MA1_2, MA2_2, MA3_2']} />
                </ul>

                <h5>SMAE Channel</h5>
                <ul>
                  <ColumnItem label="SMAE1_Upper, SMAE1_Lower" desc={COLUMN_DESCRIPTIONS['SMAE1_Upper, SMAE1_Lower']} />
                  <ColumnItem label="SMAE2_Upper, SMAE2_Lower" desc={COLUMN_DESCRIPTIONS['SMAE2_Upper, SMAE2_Lower']} />
                </ul>

                <h5>PWAP</h5>
                <ul>
                  <ColumnItem label="PWAP_Mean" desc={COLUMN_DESCRIPTIONS['PWAP_Mean']} />
                  <ColumnItem label="PWAP_Upper1, PWAP_Lower1" desc={COLUMN_DESCRIPTIONS['PWAP_Upper1, PWAP_Lower1']} />
                  <ColumnItem label="PWAP_Upper2, PWAP_Lower2" desc={COLUMN_DESCRIPTIONS['PWAP_Upper2, PWAP_Lower2']} />
                  <ColumnItem label="PWAP_Upper3, PWAP_Lower3" desc={COLUMN_DESCRIPTIONS['PWAP_Upper3, PWAP_Lower3']} />
                  <ColumnItem label="PWAP_Upper4, PWAP_Lower4" desc={COLUMN_DESCRIPTIONS['PWAP_Upper4, PWAP_Lower4']} />
                  <ColumnItem label="PWAP_distance_RR" desc={COLUMN_DESCRIPTIONS['PWAP_distance_RR']} />
                  <ColumnItem label="PWAP_distance_ADR" desc={COLUMN_DESCRIPTIONS['PWAP_distance_ADR']} />
                </ul>

                <h5>State &amp; Structure</h5>
                <ul>
                  <ColumnItem label="State" desc={COLUMN_DESCRIPTIONS['State']} />
                  <ColumnItem label="prState" desc={COLUMN_DESCRIPTIONS['prState']} />
                  <ColumnItem label="fromState" desc={COLUMN_DESCRIPTIONS['fromState']} />
                  <ColumnItem label="stateBarCount" desc={COLUMN_DESCRIPTIONS['stateBarCount']} />
                </ul>

                <h5>Consecutive Bars</h5>
                <ul>
                  <ColumnItem label="Con_UP_bars" desc={COLUMN_DESCRIPTIONS['Con_UP_bars']} />
                  <ColumnItem label="Con_DN_bars" desc={COLUMN_DESCRIPTIONS['Con_DN_bars']} />
                  <ColumnItem label="Con_UP_bars(state)" desc={COLUMN_DESCRIPTIONS['Con_UP_bars(state)']} />
                  <ColumnItem label="Con_DN_bars(state)" desc={COLUMN_DESCRIPTIONS['Con_DN_bars(state)']} />
                  <ColumnItem label="priorRunCount" desc={COLUMN_DESCRIPTIONS['priorRunCount']} />
                </ul>

                <h5>Drawdown/Wick</h5>
                <ul>
                  <ColumnItem label="DD" desc={COLUMN_DESCRIPTIONS['DD']} />
                  <ColumnItem label="DD_RR" desc={COLUMN_DESCRIPTIONS['DD_RR']} />
                  <ColumnItem label="DD_ADR" desc={COLUMN_DESCRIPTIONS['DD_ADR']} />
                </ul>

                <h5>Duration</h5>
                <ul>
                  <ColumnItem label="barDuration" desc={COLUMN_DESCRIPTIONS['barDuration']} />
                  <ColumnItem label="stateDuration" desc={COLUMN_DESCRIPTIONS['stateDuration']} />
                </ul>

                <h5>MFE / Outcome Metrics</h5>
                <ul>
                  <ColumnItem label="MFE_clr_Bars" desc={COLUMN_DESCRIPTIONS['MFE_clr_Bars']} />
                  <ColumnItem label="MFE_clr_price" desc={COLUMN_DESCRIPTIONS['MFE_clr_price']} />
                  <ColumnItem label="MFE_clr_ADR" desc={COLUMN_DESCRIPTIONS['MFE_clr_ADR']} />
                  <ColumnItem label="MFE_clr_RR" desc={COLUMN_DESCRIPTIONS['MFE_clr_RR']} />
                  <ColumnItem label="REAL_clr_ADR" desc={COLUMN_DESCRIPTIONS['REAL_clr_ADR']} />
                  <ColumnItem label="REAL_clr_RR" desc={COLUMN_DESCRIPTIONS['REAL_clr_RR']} />
                  <ColumnItem label="REAL_MA1_Price, REAL_MA1_ADR, REAL_MA1_RR" desc={COLUMN_DESCRIPTIONS['REAL_MA1_Price, REAL_MA1_ADR, REAL_MA1_RR']} />
                  <ColumnItem label="REAL_MA2_Price, REAL_MA2_ADR, REAL_MA2_RR" desc={COLUMN_DESCRIPTIONS['REAL_MA2_Price, REAL_MA2_ADR, REAL_MA2_RR']} />
                  <ColumnItem label="REAL_MA3_Price, REAL_MA3_ADR, REAL_MA3_RR" desc={COLUMN_DESCRIPTIONS['REAL_MA3_Price, REAL_MA3_ADR, REAL_MA3_RR']} />
                </ul>

                <h4>Tips</h4>
                <ul>
                  <li>Column names are case-sensitive</li>
                  <li>Use <code>and</code> / <code>or</code> (not <code>&amp;&amp;</code> / <code>||</code>)</li>
                  <li>Group with parentheses: <code>(A or B) and C</code></li>
                  <li>Press Enter in any expression field to evaluate</li>
                </ul>
              </div>
            </div>,
            document.body
          )}

        </div>
      )}

      {/* ==================== Optimizer Tab ==================== */}
      {activeTab === 'optimizer' && (
        <div className="stats-tab-content">

          {/* Config Module */}
          <div className="stats-module module-box optimizer-config-module">
            <div className="optimizer-config-header">
              <span className="module-title-text">OPTIMIZER CONFIG</span>
              <button
                className="backtest-run-btn"
                disabled={optRunning || !filepath}
                onClick={runOptimizer}
              >{optRunning ? 'Running...' : 'Run Optimizer'}</button>
            </div>

            {/* Single MA */}
            <div className="optimizer-section-row">
              <label className="optimizer-section-check">
                <input type="checkbox" checked={optConfig.single_ma.enabled}
                  onChange={e => updateOptSection('single_ma', 'enabled', e.target.checked)} />
                Single MA
              </label>
              {optConfig.single_ma.enabled && (
                <div className="optimizer-section-fields">
                  <select className="backtest-config-select" value={optConfig.single_ma.ma_type}
                    onChange={e => updateOptSection('single_ma', 'ma_type', e.target.value)}>
                    <option value="ema">EMA</option><option value="sma">SMA</option><option value="both">Both</option>
                  </select>
                  <label className="opt-field-label">Start</label>
                  <input type="number" className="backtest-config-input" value={optConfig.single_ma.start_period}
                    onChange={e => updateOptSection('single_ma', 'start_period', parseInt(e.target.value) || 5)} />
                  <label className="opt-field-label">End</label>
                  <input type="number" className="backtest-config-input" value={optConfig.single_ma.end_period}
                    onChange={e => updateOptSection('single_ma', 'end_period', parseInt(e.target.value) || 200)} />
                  <label className="opt-field-label">Step</label>
                  <input type="number" className="backtest-config-input" value={optConfig.single_ma.step}
                    onChange={e => updateOptSection('single_ma', 'step', parseInt(e.target.value) || 5)} />
                </div>
              )}
            </div>

            {/* Two MA */}
            <div className="optimizer-section-row">
              <label className="optimizer-section-check">
                <input type="checkbox" checked={optConfig.two_ma.enabled}
                  onChange={e => updateOptSection('two_ma', 'enabled', e.target.checked)} />
                2-MA Combo
              </label>
              {optConfig.two_ma.enabled && (
                <div className="optimizer-section-fields">
                  <select className="backtest-config-select" value={optConfig.two_ma.ma_type}
                    onChange={e => updateOptSection('two_ma', 'ma_type', e.target.value)}>
                    <option value="ema">EMA</option><option value="sma">SMA</option><option value="both">Both</option>
                  </select>
                  <label className="opt-field-label">Start</label>
                  <input type="number" className="backtest-config-input" value={optConfig.two_ma.start_period}
                    onChange={e => updateOptSection('two_ma', 'start_period', parseInt(e.target.value) || 5)} />
                  <label className="opt-field-label">End</label>
                  <input type="number" className="backtest-config-input" value={optConfig.two_ma.end_period}
                    onChange={e => updateOptSection('two_ma', 'end_period', parseInt(e.target.value) || 200)} />
                  <label className="opt-field-label">Step</label>
                  <input type="number" className="backtest-config-input" value={optConfig.two_ma.step}
                    onChange={e => updateOptSection('two_ma', 'step', parseInt(e.target.value) || 5)} />
                </div>
              )}
            </div>

            {/* Three MA */}
            <div className="optimizer-section-row">
              <label className="optimizer-section-check">
                <input type="checkbox" checked={optConfig.three_ma.enabled}
                  onChange={e => updateOptSection('three_ma', 'enabled', e.target.checked)} />
                3-MA Combo
              </label>
              {optConfig.three_ma.enabled && (
                <div className="optimizer-section-fields">
                  <select className="backtest-config-select" value={optConfig.three_ma.ma_type}
                    onChange={e => updateOptSection('three_ma', 'ma_type', e.target.value)}>
                    <option value="ema">EMA</option><option value="sma">SMA</option><option value="both">Both</option>
                  </select>
                  <label className="opt-field-label">Start</label>
                  <input type="number" className="backtest-config-input" value={optConfig.three_ma.start_period}
                    onChange={e => updateOptSection('three_ma', 'start_period', parseInt(e.target.value) || 5)} />
                  <label className="opt-field-label">End</label>
                  <input type="number" className="backtest-config-input" value={optConfig.three_ma.end_period}
                    onChange={e => updateOptSection('three_ma', 'end_period', parseInt(e.target.value) || 200)} />
                  <label className="opt-field-label">Step</label>
                  <input type="number" className="backtest-config-input" value={optConfig.three_ma.step}
                    onChange={e => updateOptSection('three_ma', 'step', parseInt(e.target.value) || 10)} />
                </div>
              )}
            </div>

            {/* Single SMAE */}
            <div className="optimizer-section-row">
              <label className="optimizer-section-check">
                <input type="checkbox" checked={optConfig.single_smae.enabled}
                  onChange={e => updateOptSection('single_smae', 'enabled', e.target.checked)} />
                Single SMAE
              </label>
              {optConfig.single_smae.enabled && (
                <div className="optimizer-section-fields">
                  <label className="opt-field-label">Start</label>
                  <input type="number" className="backtest-config-input" value={optConfig.single_smae.start_period}
                    onChange={e => updateOptSection('single_smae', 'start_period', parseInt(e.target.value) || 5)} />
                  <label className="opt-field-label">End</label>
                  <input type="number" className="backtest-config-input" value={optConfig.single_smae.end_period}
                    onChange={e => updateOptSection('single_smae', 'end_period', parseInt(e.target.value) || 200)} />
                  <label className="opt-field-label">Step</label>
                  <input type="number" className="backtest-config-input" value={optConfig.single_smae.step}
                    onChange={e => updateOptSection('single_smae', 'step', parseInt(e.target.value) || 5)} />
                  <label className="opt-field-label">Dev</label>
                  <input type="number" className="backtest-config-input" value={optConfig.single_smae.deviation} step="0.1"
                    onChange={e => updateOptSection('single_smae', 'deviation', parseFloat(e.target.value) || 1.0)} />
                </div>
              )}
            </div>

            {/* Two SMAE */}
            <div className="optimizer-section-row">
              <label className="optimizer-section-check">
                <input type="checkbox" checked={optConfig.two_smae.enabled}
                  onChange={e => updateOptSection('two_smae', 'enabled', e.target.checked)} />
                2-SMAE Combo
              </label>
              {optConfig.two_smae.enabled && (
                <div className="optimizer-section-fields">
                  <label className="opt-field-label">Start</label>
                  <input type="number" className="backtest-config-input" value={optConfig.two_smae.start_period}
                    onChange={e => updateOptSection('two_smae', 'start_period', parseInt(e.target.value) || 5)} />
                  <label className="opt-field-label">End</label>
                  <input type="number" className="backtest-config-input" value={optConfig.two_smae.end_period}
                    onChange={e => updateOptSection('two_smae', 'end_period', parseInt(e.target.value) || 200)} />
                  <label className="opt-field-label">Step</label>
                  <input type="number" className="backtest-config-input" value={optConfig.two_smae.step}
                    onChange={e => updateOptSection('two_smae', 'step', parseInt(e.target.value) || 10)} />
                  <label className="opt-field-label">Dev</label>
                  <input type="number" className="backtest-config-input" value={optConfig.two_smae.deviation} step="0.1"
                    onChange={e => updateOptSection('two_smae', 'deviation', parseFloat(e.target.value) || 1.0)} />
                </div>
              )}
            </div>
          </div>

          {/* Progress Module */}
          {optRunning && (
            <div className="stats-module module-box optimizer-progress-module">
              <div className="optimizer-progress-status">{optMessage}</div>
              <div className="optimizer-progress-track">
                <div className="optimizer-progress-fill" style={{ width: `${optProgress}%` }} />
              </div>
              <div className="optimizer-progress-timer">{formatOptTime(optElapsed)}</div>
            </div>
          )}

          {/* Error */}
          {optError && (
            <div className="stats-module module-box" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
              <span style={{ color: '#ef4444', fontSize: '12px' }}>Error: {optError}</span>
            </div>
          )}

          {/* Results: Single MA */}
          {optResults.single_ma && optResults.single_ma.length > 0 && (
            <div className="stats-module module-box optimizer-results-module">
              <div className="module-title-text">Single MA Results ({optResults.single_ma.length} combos)</div>
              <div className="optimizer-table-scroll">
                <table className="stats-table optimizer-table">
                  <thead>
                    <tr>
                      <OptSortTh sectionKey="single_ma" colKey="type" title="EMA or SMA">Type</OptSortTh>
                      <OptSortTh sectionKey="single_ma" colKey="period" title="MA lookback period">Period</OptSortTh>
                      <th title="Total bars analyzed">Bars</th>
                      <OptSortTh sectionKey="single_ma" colKey="above_up_pct" title="% of bars above MA that are UP (green) bars" className="opt-sep">↑ Above</OptSortTh>
                      <OptSortTh sectionKey="single_ma" colKey="above_dn_pct" title="% of bars above MA that are DN (red) bars">↓ Above</OptSortTh>
                      <OptSortTh sectionKey="single_ma" colKey="below_up_pct" title="% of bars below MA that are UP (green) bars" className="opt-sep">↑ Below</OptSortTh>
                      <OptSortTh sectionKey="single_ma" colKey="below_dn_pct" title="% of bars below MA that are DN (red) bars">↓ Below</OptSortTh>
                      <OptSortTh sectionKey="single_ma" colKey="score" title="Avg of Above Up% and Below Dn% — higher = stronger directional bias" className="opt-sep">Score</OptSortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {getSortedOptResults('single_ma').map((r, i) => (
                      <tr key={i}>
                        <td>{r.type}</td>
                        <td>{r.period}</td>
                        <td>{r.above_count + r.below_count}</td>
                        <td className={`up opt-sep${r.above_up_pct > r.above_dn_pct ? ' highlight' : ''}`}>{r.above_up_pct}%</td>
                        <td className={`dn${r.above_dn_pct > r.above_up_pct ? ' highlight' : ''}`}>{r.above_dn_pct}%</td>
                        <td className={`up opt-sep${r.below_up_pct > r.below_dn_pct ? ' highlight' : ''}`}>{r.below_up_pct}%</td>
                        <td className={`dn${r.below_dn_pct > r.below_up_pct ? ' highlight' : ''}`}>{r.below_dn_pct}%</td>
                        <td className="opt-cell-score opt-sep">{r.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Results: 2-MA Combo */}
          {optResults.two_ma && optResults.two_ma.length > 0 && (
            <div className="stats-module module-box optimizer-results-module">
              <div className="module-title-text">2-MA Combo Results ({optResults.two_ma.length} combos)</div>
              <div className="optimizer-table-scroll">
                <table className="stats-table optimizer-table">
                  <thead>
                    <tr>
                      <OptSortTh sectionKey="two_ma" colKey="type1" title="Type of faster MA">T1</OptSortTh>
                      <OptSortTh sectionKey="two_ma" colKey="period1" title="Period of faster MA">P1</OptSortTh>
                      <OptSortTh sectionKey="two_ma" colKey="type2" title="Type of slower MA">T2</OptSortTh>
                      <OptSortTh sectionKey="two_ma" colKey="period2" title="Period of slower MA">P2</OptSortTh>
                      <th title="Total bars analyzed">Bars</th>
                      <OptSortTh sectionKey="two_ma" colKey="above_up_pct" title="% UP bars when close is above both MAs" className="opt-sep">↑ Above</OptSortTh>
                      <OptSortTh sectionKey="two_ma" colKey="above_dn_pct" title="% DN bars when close is above both MAs">↓ Above</OptSortTh>
                      <OptSortTh sectionKey="two_ma" colKey="between_up_pct" title="% UP bars when close is between the two MAs" className="opt-sep">↑ Between</OptSortTh>
                      <OptSortTh sectionKey="two_ma" colKey="between_dn_pct" title="% DN bars when close is between the two MAs">↓ Between</OptSortTh>
                      <OptSortTh sectionKey="two_ma" colKey="below_up_pct" title="% UP bars when close is below both MAs" className="opt-sep">↑ Below</OptSortTh>
                      <OptSortTh sectionKey="two_ma" colKey="below_dn_pct" title="% DN bars when close is below both MAs">↓ Below</OptSortTh>
                      <OptSortTh sectionKey="two_ma" colKey="score" title="Avg of Above Up% and Below Dn% — higher = stronger directional bias" className="opt-sep">Score</OptSortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {getSortedOptResults('two_ma').map((r, i) => (
                      <tr key={i}>
                        <td>{r.type1}</td><td>{r.period1}</td>
                        <td>{r.type2}</td><td>{r.period2}</td>
                        <td>{r.above_count + r.between_count + r.below_count}</td>
                        <td className={`up opt-sep${r.above_up_pct > r.above_dn_pct ? ' highlight' : ''}`}>{r.above_up_pct}%</td>
                        <td className={`dn${r.above_dn_pct > r.above_up_pct ? ' highlight' : ''}`}>{r.above_dn_pct}%</td>
                        <td className={`up opt-sep${r.between_up_pct > r.between_dn_pct ? ' highlight' : ''}`}>{r.between_up_pct}%</td>
                        <td className={`dn${r.between_dn_pct > r.between_up_pct ? ' highlight' : ''}`}>{r.between_dn_pct}%</td>
                        <td className={`up opt-sep${r.below_up_pct > r.below_dn_pct ? ' highlight' : ''}`}>{r.below_up_pct}%</td>
                        <td className={`dn${r.below_dn_pct > r.below_up_pct ? ' highlight' : ''}`}>{r.below_dn_pct}%</td>
                        <td className="opt-cell-score opt-sep">{r.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Results: 3-MA Zone */}
          {optResults.three_ma_zone && optResults.three_ma_zone.length > 0 && (
            <div className="stats-module module-box optimizer-results-module">
              <div className="module-title-text">3-MA Zone Results ({optResults.three_ma_zone.length} combos)</div>
              <div className="optimizer-table-scroll">
                <table className="stats-table optimizer-table">
                  <thead>
                    <tr>
                      <OptSortTh sectionKey="three_ma_zone" colKey="type1" title="Type of fastest MA">T1</OptSortTh>
                      <OptSortTh sectionKey="three_ma_zone" colKey="period1" title="Period of fastest MA">P1</OptSortTh>
                      <OptSortTh sectionKey="three_ma_zone" colKey="type2" title="Type of middle MA">T2</OptSortTh>
                      <OptSortTh sectionKey="three_ma_zone" colKey="period2" title="Period of middle MA">P2</OptSortTh>
                      <OptSortTh sectionKey="three_ma_zone" colKey="type3" title="Type of slowest MA">T3</OptSortTh>
                      <OptSortTh sectionKey="three_ma_zone" colKey="period3" title="Period of slowest MA">P3</OptSortTh>
                      <th title="Total bars analyzed">Bars</th>
                      <OptSortTh sectionKey="three_ma_zone" colKey="above_up_pct" title="% UP bars when close is above all 3 MAs" className="opt-sep">↑ Above</OptSortTh>
                      <OptSortTh sectionKey="three_ma_zone" colKey="above_dn_pct" title="% DN bars when close is above all 3 MAs">↓ Above</OptSortTh>
                      <OptSortTh sectionKey="three_ma_zone" colKey="between_up_pct" title="% UP bars when close is between the MAs (not above all or below all)" className="opt-sep">↑ Between</OptSortTh>
                      <OptSortTh sectionKey="three_ma_zone" colKey="between_dn_pct" title="% DN bars when close is between the MAs (not above all or below all)">↓ Between</OptSortTh>
                      <OptSortTh sectionKey="three_ma_zone" colKey="below_up_pct" title="% UP bars when close is below all 3 MAs" className="opt-sep">↑ Below</OptSortTh>
                      <OptSortTh sectionKey="three_ma_zone" colKey="below_dn_pct" title="% DN bars when close is below all 3 MAs">↓ Below</OptSortTh>
                      <OptSortTh sectionKey="three_ma_zone" colKey="score" title="Avg of Above Up% and Below Dn%" className="opt-sep">Score</OptSortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {getSortedOptResults('three_ma_zone').map((r, i) => (
                      <tr key={i}>
                        <td>{r.type1}</td><td>{r.period1}</td>
                        <td>{r.type2}</td><td>{r.period2}</td>
                        <td>{r.type3}</td><td>{r.period3}</td>
                        <td>{r.above_count + r.between_count + r.below_count}</td>
                        <td className={`up opt-sep${r.above_up_pct > r.above_dn_pct ? ' highlight' : ''}`}>{r.above_up_pct}%</td>
                        <td className={`dn${r.above_dn_pct > r.above_up_pct ? ' highlight' : ''}`}>{r.above_dn_pct}%</td>
                        <td className={`up opt-sep${r.between_up_pct > r.between_dn_pct ? ' highlight' : ''}`}>{r.between_up_pct}%</td>
                        <td className={`dn${r.between_dn_pct > r.between_up_pct ? ' highlight' : ''}`}>{r.between_dn_pct}%</td>
                        <td className={`up opt-sep${r.below_up_pct > r.below_dn_pct ? ' highlight' : ''}`}>{r.below_up_pct}%</td>
                        <td className={`dn${r.below_dn_pct > r.below_up_pct ? ' highlight' : ''}`}>{r.below_dn_pct}%</td>
                        <td className="opt-cell-score opt-sep">{r.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Results: 3-MA State */}
          {optResults.three_ma_state && optResults.three_ma_state.length > 0 && (
            <div className="stats-module module-box optimizer-results-module">
              <div className="module-title-text">3-MA State Results ({optResults.three_ma_state.length} combos)</div>
              <div className="optimizer-table-scroll">
                <table className="stats-table optimizer-table">
                  <thead>
                    <tr>
                      <OptSortTh sectionKey="three_ma_state" colKey="type1" title="Type of fastest MA">T1</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="period1" title="Period of fastest MA">P1</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="type2" title="Type of middle MA">T2</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="period2" title="Period of middle MA">P2</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="type3" title="Type of slowest MA">T3</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="period3" title="Period of slowest MA">P3</OptSortTh>
                      <th title="Total bars analyzed">Bars</th>
                      <OptSortTh sectionKey="three_ma_state" colKey="s+3_up_pct" title="State +3: Fast > Med > Slow (strongest bullish). % UP bars" className="opt-sep">↑ +3</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="s+3_dn_pct" title="State +3: Fast > Med > Slow (strongest bullish). % DN bars">↓ +3</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="s+2_up_pct" title="State +2: Fast > Slow > Med. % UP bars" className="opt-sep">↑ +2</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="s+2_dn_pct" title="State +2: Fast > Slow > Med. % DN bars">↓ +2</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="s+1_up_pct" title="State +1: Slow > Fast > Med (weakest bullish). % UP bars" className="opt-sep">↑ +1</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="s+1_dn_pct" title="State +1: Slow > Fast > Med (weakest bullish). % DN bars">↓ +1</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="s-1_up_pct" title="State -1: Med > Fast > Slow (weakest bearish). % UP bars" className="opt-sep">↑ -1</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="s-1_dn_pct" title="State -1: Med > Fast > Slow (weakest bearish). % DN bars">↓ -1</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="s-2_up_pct" title="State -2: Med > Slow > Fast. % UP bars" className="opt-sep">↑ -2</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="s-2_dn_pct" title="State -2: Med > Slow > Fast. % DN bars">↓ -2</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="s-3_up_pct" title="State -3: Slow > Med > Fast (strongest bearish). % UP bars" className="opt-sep">↑ -3</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="s-3_dn_pct" title="State -3: Slow > Med > Fast (strongest bearish). % DN bars">↓ -3</OptSortTh>
                      <OptSortTh sectionKey="three_ma_state" colKey="score" title="Avg of Up% for positive states and Dn% for negative states" className="opt-sep">Score</OptSortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {getSortedOptResults('three_ma_state').map((r, i) => (
                      <tr key={i}>
                        <td>{r.type1}</td><td>{r.period1}</td>
                        <td>{r.type2}</td><td>{r.period2}</td>
                        <td>{r.type3}</td><td>{r.period3}</td>
                        <td>{r['s+3_count'] + r['s+2_count'] + r['s+1_count'] + r['s-1_count'] + r['s-2_count'] + r['s-3_count']}</td>
                        <td className={`up opt-sep${r['s+3_up_pct'] > r['s+3_dn_pct'] ? ' highlight' : ''}`}>{r['s+3_up_pct']}%</td>
                        <td className={`dn${r['s+3_dn_pct'] > r['s+3_up_pct'] ? ' highlight' : ''}`}>{r['s+3_dn_pct']}%</td>
                        <td className={`up opt-sep${r['s+2_up_pct'] > r['s+2_dn_pct'] ? ' highlight' : ''}`}>{r['s+2_up_pct']}%</td>
                        <td className={`dn${r['s+2_dn_pct'] > r['s+2_up_pct'] ? ' highlight' : ''}`}>{r['s+2_dn_pct']}%</td>
                        <td className={`up opt-sep${r['s+1_up_pct'] > r['s+1_dn_pct'] ? ' highlight' : ''}`}>{r['s+1_up_pct']}%</td>
                        <td className={`dn${r['s+1_dn_pct'] > r['s+1_up_pct'] ? ' highlight' : ''}`}>{r['s+1_dn_pct']}%</td>
                        <td className={`up opt-sep${r['s-1_up_pct'] > r['s-1_dn_pct'] ? ' highlight' : ''}`}>{r['s-1_up_pct']}%</td>
                        <td className={`dn${r['s-1_dn_pct'] > r['s-1_up_pct'] ? ' highlight' : ''}`}>{r['s-1_dn_pct']}%</td>
                        <td className={`up opt-sep${r['s-2_up_pct'] > r['s-2_dn_pct'] ? ' highlight' : ''}`}>{r['s-2_up_pct']}%</td>
                        <td className={`dn${r['s-2_dn_pct'] > r['s-2_up_pct'] ? ' highlight' : ''}`}>{r['s-2_dn_pct']}%</td>
                        <td className={`up opt-sep${r['s-3_up_pct'] > r['s-3_dn_pct'] ? ' highlight' : ''}`}>{r['s-3_up_pct']}%</td>
                        <td className={`dn${r['s-3_dn_pct'] > r['s-3_up_pct'] ? ' highlight' : ''}`}>{r['s-3_dn_pct']}%</td>
                        <td className="opt-cell-score opt-sep">{r.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Results: Single SMAE */}
          {optResults.single_smae && optResults.single_smae.length > 0 && (
            <div className="stats-module module-box optimizer-results-module">
              <div className="module-title-text">Single SMAE Results ({optResults.single_smae.length} combos)</div>
              <div className="optimizer-table-scroll">
                <table className="stats-table optimizer-table">
                  <thead>
                    <tr>
                      <OptSortTh sectionKey="single_smae" colKey="period" title="SMA lookback period for envelope center">Period</OptSortTh>
                      <OptSortTh sectionKey="single_smae" colKey="deviation" title="Envelope deviation % (upper = SMA*(1+dev/100), lower = SMA*(1-dev/100))">Dev</OptSortTh>
                      <th title="Total bars analyzed">Bars</th>
                      <OptSortTh sectionKey="single_smae" colKey="above_up_pct" title="% UP bars when close is above the upper envelope line" className="opt-sep">↑ Above</OptSortTh>
                      <OptSortTh sectionKey="single_smae" colKey="above_dn_pct" title="% DN bars when close is above the upper envelope line">↓ Above</OptSortTh>
                      <OptSortTh sectionKey="single_smae" colKey="between_up_pct" title="% UP bars when close is between upper and lower envelope lines" className="opt-sep">↑ Between</OptSortTh>
                      <OptSortTh sectionKey="single_smae" colKey="between_dn_pct" title="% DN bars when close is between upper and lower envelope lines">↓ Between</OptSortTh>
                      <OptSortTh sectionKey="single_smae" colKey="below_up_pct" title="% UP bars when close is below the lower envelope line" className="opt-sep">↑ Below</OptSortTh>
                      <OptSortTh sectionKey="single_smae" colKey="below_dn_pct" title="% DN bars when close is below the lower envelope line">↓ Below</OptSortTh>
                      <OptSortTh sectionKey="single_smae" colKey="score" title="Avg of Above Up% and Below Dn% — higher = stronger directional bias" className="opt-sep">Score</OptSortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {getSortedOptResults('single_smae').map((r, i) => (
                      <tr key={i}>
                        <td>{r.period}</td>
                        <td>{r.deviation}</td>
                        <td>{r.above_count + r.between_count + r.below_count}</td>
                        <td className={`up opt-sep${r.above_up_pct > r.above_dn_pct ? ' highlight' : ''}`}>{r.above_up_pct}%</td>
                        <td className={`dn${r.above_dn_pct > r.above_up_pct ? ' highlight' : ''}`}>{r.above_dn_pct}%</td>
                        <td className={`up opt-sep${r.between_up_pct > r.between_dn_pct ? ' highlight' : ''}`}>{r.between_up_pct}%</td>
                        <td className={`dn${r.between_dn_pct > r.between_up_pct ? ' highlight' : ''}`}>{r.between_dn_pct}%</td>
                        <td className={`up opt-sep${r.below_up_pct > r.below_dn_pct ? ' highlight' : ''}`}>{r.below_up_pct}%</td>
                        <td className={`dn${r.below_dn_pct > r.below_up_pct ? ' highlight' : ''}`}>{r.below_dn_pct}%</td>
                        <td className="opt-cell-score opt-sep">{r.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Results: 2-SMAE Combo */}
          {optResults.two_smae && optResults.two_smae.length > 0 && (
            <div className="stats-module module-box optimizer-results-module">
              <div className="module-title-text">2-SMAE Combo Results ({optResults.two_smae.length} combos)</div>
              <div className="optimizer-table-scroll">
                <table className="stats-table optimizer-table">
                  <thead>
                    <tr>
                      <OptSortTh sectionKey="two_smae" colKey="period1" title="Period of faster SMAE">P1</OptSortTh>
                      <OptSortTh sectionKey="two_smae" colKey="deviation1" title="Deviation % for envelope 1">Dev1</OptSortTh>
                      <OptSortTh sectionKey="two_smae" colKey="period2" title="Period of slower SMAE">P2</OptSortTh>
                      <OptSortTh sectionKey="two_smae" colKey="deviation2" title="Deviation % for envelope 2">Dev2</OptSortTh>
                      <th title="Total bars analyzed">Bars</th>
                      <OptSortTh sectionKey="two_smae" colKey="above_up_pct" title="% UP bars when close is above both upper envelope lines" className="opt-sep">↑ Above</OptSortTh>
                      <OptSortTh sectionKey="two_smae" colKey="above_dn_pct" title="% DN bars when close is above both upper envelope lines">↓ Above</OptSortTh>
                      <OptSortTh sectionKey="two_smae" colKey="between_up_pct" title="% UP bars when close is not above both uppers and not below both lowers" className="opt-sep">↑ Between</OptSortTh>
                      <OptSortTh sectionKey="two_smae" colKey="between_dn_pct" title="% DN bars when close is not above both uppers and not below both lowers">↓ Between</OptSortTh>
                      <OptSortTh sectionKey="two_smae" colKey="below_up_pct" title="% UP bars when close is below both lower envelope lines" className="opt-sep">↑ Below</OptSortTh>
                      <OptSortTh sectionKey="two_smae" colKey="below_dn_pct" title="% DN bars when close is below both lower envelope lines">↓ Below</OptSortTh>
                      <OptSortTh sectionKey="two_smae" colKey="score" title="Avg of Above Up% and Below Dn% — higher = stronger directional bias" className="opt-sep">Score</OptSortTh>
                    </tr>
                  </thead>
                  <tbody>
                    {getSortedOptResults('two_smae').map((r, i) => (
                      <tr key={i}>
                        <td>{r.period1}</td><td>{r.deviation1}</td>
                        <td>{r.period2}</td><td>{r.deviation2}</td>
                        <td>{r.above_count + r.between_count + r.below_count}</td>
                        <td className={`up opt-sep${r.above_up_pct > r.above_dn_pct ? ' highlight' : ''}`}>{r.above_up_pct}%</td>
                        <td className={`dn${r.above_dn_pct > r.above_up_pct ? ' highlight' : ''}`}>{r.above_dn_pct}%</td>
                        <td className={`up opt-sep${r.between_up_pct > r.between_dn_pct ? ' highlight' : ''}`}>{r.between_up_pct}%</td>
                        <td className={`dn${r.between_dn_pct > r.between_up_pct ? ' highlight' : ''}`}>{r.between_dn_pct}%</td>
                        <td className={`up opt-sep${r.below_up_pct > r.below_dn_pct ? ' highlight' : ''}`}>{r.below_up_pct}%</td>
                        <td className={`dn${r.below_dn_pct > r.below_up_pct ? ' highlight' : ''}`}>{r.below_dn_pct}%</td>
                        <td className="opt-cell-score opt-sep">{r.score}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}

    </div>
  )
}

export default StatsPage
