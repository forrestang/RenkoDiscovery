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

// --- Client-side stat computation helpers for chop filtering ---
function pick(arr, indices) {
  if (!indices) return arr
  return indices.map(i => arr[i])
}

function computeGeneral(bd, indices) {
  const open = pick(bd.open, indices)
  const close = pick(bd.close, indices)
  const total = open.length
  let up = 0, dn = 0
  for (let i = 0; i < total; i++) {
    if (close[i] > open[i]) up++
    else if (close[i] < open[i]) dn++
  }
  return { totalBars: total, upBars: up, dnBars: dn }
}

function computeStateDistribution(bd, indices) {
  const state = pick(bd.state, indices)
  const open = pick(bd.open, indices)
  const close = pick(bd.close, indices)
  const total = state.length
  const states = [3, 2, 1, -1, -2, -3]
  return states.map(s => {
    let count = 0, upCount = 0, dnCount = 0
    for (let i = 0; i < total; i++) {
      if (state[i] === s) {
        count++
        if (close[i] > open[i]) upCount++
        else if (close[i] < open[i]) dnCount++
      }
    }
    return {
      state: s, count,
      pct: total > 0 ? Math.round(count / total * 1000) / 10 : 0,
      upCount, upPct: count > 0 ? Math.round(upCount / count * 100) : 0,
      dnCount, dnPct: count > 0 ? Math.round(dnCount / count * 100) : 0,
    }
  })
}

function computeBarLocation(bd, indices, maPeriods) {
  const open = pick(bd.open, indices)
  const close = pick(bd.close, indices)
  const total = open.length
  const isUp = close.map((c, i) => c > open[i])
  const isDn = close.map((c, i) => c < open[i])

  const maStats = []
  let aboveAllArr = new Array(total).fill(true)
  let belowAllArr = new Array(total).fill(true)

  for (const period of maPeriods) {
    const rawKey = `emaRaw${period}`
    if (!bd[rawKey]) {
      maStats.push({ period, above: 0, below: 0, aboveUp: 0, aboveDown: 0, belowUp: 0, belowDown: 0 })
      continue
    }
    const raw = pick(bd[rawKey], indices)
    let above = 0, below = 0, aboveUp = 0, aboveDown = 0, belowUp = 0, belowDown = 0
    for (let i = 0; i < total; i++) {
      if (raw[i] == null) { aboveAllArr[i] = false; belowAllArr[i] = false; continue }
      const isAbove = raw[i] > 0
      const isBelow = raw[i] < 0
      if (isAbove) { above++; if (isUp[i]) aboveUp++; if (isDn[i]) aboveDown++ }
      if (isBelow) { below++; if (isUp[i]) belowUp++; if (isDn[i]) belowDown++ }
      if (!isAbove) aboveAllArr[i] = false
      if (!isBelow) belowAllArr[i] = false
    }
    maStats.push({ period, above, below, aboveUp, aboveDown, belowUp, belowDown })
  }

  let aboveAll = 0, belowAll = 0, aboveAllUp = 0, aboveAllDown = 0, belowAllUp = 0, belowAllDown = 0
  for (let i = 0; i < total; i++) {
    if (aboveAllArr[i]) { aboveAll++; if (isUp[i]) aboveAllUp++; if (isDn[i]) aboveAllDown++ }
    if (belowAllArr[i]) { belowAll++; if (isUp[i]) belowAllUp++; if (isDn[i]) belowAllDown++ }
  }
  return {
    maStats,
    allMaStats: { aboveAll, belowAll, aboveAllUp, aboveAllDown, belowAllUp, belowAllDown }
  }
}

function computeBeyondBarLocation(bd, indices, maPeriods) {
  const open = pick(bd.open, indices)
  const close = pick(bd.close, indices)
  const high = pick(bd.high, indices)
  const low = pick(bd.low, indices)
  const total = open.length
  const isUp = close.map((c, i) => c > open[i])
  const isDn = close.map((c, i) => c < open[i])

  const beyondMaStats = []
  let aboveAllArr = new Array(total).fill(true)
  let belowAllArr = new Array(total).fill(true)

  for (const period of maPeriods) {
    const rawKey = `emaRaw${period}`
    if (!bd[rawKey]) {
      beyondMaStats.push({ period, above: 0, below: 0, aboveUp: 0, aboveDown: 0, belowUp: 0, belowDown: 0 })
      continue
    }
    const raw = pick(bd[rawKey], indices)
    let above = 0, below = 0, aboveUp = 0, aboveDown = 0, belowUp = 0, belowDown = 0
    for (let i = 0; i < total; i++) {
      if (raw[i] == null || close[i] == null) { aboveAllArr[i] = false; belowAllArr[i] = false; continue }
      const ema = close[i] - raw[i]
      const beyondAbove = low[i] > ema
      const beyondBelow = high[i] < ema
      if (beyondAbove) { above++; if (isUp[i]) aboveUp++; if (isDn[i]) aboveDown++ }
      if (beyondBelow) { below++; if (isUp[i]) belowUp++; if (isDn[i]) belowDown++ }
      if (!beyondAbove) aboveAllArr[i] = false
      if (!beyondBelow) belowAllArr[i] = false
    }
    beyondMaStats.push({ period, above, below, aboveUp, aboveDown, belowUp, belowDown })
  }

  let aboveAll = 0, belowAll = 0, aboveAllUp = 0, aboveAllDown = 0, belowAllUp = 0, belowAllDown = 0
  for (let i = 0; i < total; i++) {
    if (aboveAllArr[i]) { aboveAll++; if (isUp[i]) aboveAllUp++; if (isDn[i]) aboveAllDown++ }
    if (belowAllArr[i]) { belowAll++; if (isUp[i]) belowAllUp++; if (isDn[i]) belowAllDown++ }
  }
  return {
    beyondMaStats,
    beyondAllMaStats: { aboveAll, belowAll, aboveAllUp, aboveAllDown, belowAllUp, belowAllDown }
  }
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

function computeWickDist(bd, indices) {
  const open = pick(bd.open, indices)
  const close = pick(bd.close, indices)
  const ddRR = pick(bd.ddRR, indices)

  const upVals = [], dnVals = []
  for (let i = 0; i < open.length; i++) {
    if (ddRR[i] == null) continue
    if (close[i] > open[i]) upVals.push(ddRR[i])
    else if (close[i] < open[i]) dnVals.push(ddRR[i])
  }

  const calcWickDist = (values) => {
    if (values.length === 0) return []
    const total = values.length
    const bins = [
      [0, 0.5, '>0 to <0.5'],
      [0.5, 1, '0.5 to <1'],
      [1, 1.5, '1 to <1.5'],
      [1.5, 2, '1.5 to <2'],
      [2, 3, '2 to <3'],
      [3, 5, '3 to <5'],
      [5, Infinity, '5+'],
    ]
    const dist = []
    const zeroCount = values.filter(v => v === 0).length
    dist.push({ label: '0', count: zeroCount, pct: Math.round(zeroCount / total * 1000) / 10 })
    bins.forEach(([low, high, label], idx) => {
      const count = idx === 0
        ? values.filter(v => v > low && v < high).length
        : values.filter(v => v >= low && v < high).length
      dist.push({ label, count, pct: Math.round(count / total * 1000) / 10 })
    })
    return dist
  }

  return { upDist: calcWickDist(upVals), dnDist: calcWickDist(dnVals) }
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

  // Independent chop regime filters per tab, persisted to localStorage
  const [chopFilterGeneral, setChopFilterGeneral] = useState(() => {
    return localStorage.getItem(`${STORAGE_PREFIX}chopFilterGeneral`) || 'all'
  })
  const [chopFilterSignals, setChopFilterSignals] = useState(() => {
    return localStorage.getItem(`${STORAGE_PREFIX}chopFilterSignals`) || 'all'
  })
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}chopFilterGeneral`, chopFilterGeneral)
  }, [chopFilterGeneral])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}chopFilterSignals`, chopFilterSignals)
  }, [chopFilterSignals])

  // Custom chop range thresholds, persisted to localStorage
  const [chopLowMax, setChopLowMax] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}chopLowMax`)
    return saved ? parseFloat(saved) : 0.2
  })
  const [chopHighMin, setChopHighMin] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}chopHighMin`)
    return saved ? parseFloat(saved) : 0.4
  })
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}chopLowMax`, chopLowMax.toString())
  }, [chopLowMax])
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}chopHighMin`, chopHighMin.toString())
  }, [chopHighMin])

  // Signal Quality Filter state
  const SQF_DEFAULTS = { ema1: { upEnabled: false, dnEnabled: false, upRange: [null, null], dnRange: [null, null] }, ema2: { upEnabled: false, dnEnabled: false, upRange: [null, null], dnRange: [null, null] }, ema3: { upEnabled: false, dnEnabled: false, upRange: [null, null], dnRange: [null, null] }, dd: { upEnabled: false, dnEnabled: false, upRange: [null, null], dnRange: [null, null] } }
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

  // Active chop filter based on current tab
  const chopFilter = activeTab === 'general' ? chopFilterGeneral : chopFilterSignals
  const setChopFilter = activeTab === 'general' ? setChopFilterGeneral : setChopFilterSignals

  // Reset chop filters and SQF filters when a new file is loaded
  useEffect(() => {
    setChopFilterGeneral('all')
    setChopFilterSignals('all')
    setSqfFilters({ t1: SQF_DEFAULTS, t2: SQF_DEFAULTS })
  }, [filepath])

  const handleChopFilterChange = (value) => {
    setChopFilter(value)
  }

  // Chop regime test function using custom thresholds
  const chopTest = (value, regime) => {
    if (regime === 'all') return true
    if (value == null) return false
    if (regime === 'low') return value < chopLowMax
    if (regime === 'mid') return value >= chopLowMax && value <= chopHighMin
    if (regime === 'high') return value > chopHighMin
    return true
  }

  // Client-side chop filtering: compute filtered bar indices (General tab)
  const filteredBarIndices = useMemo(() => {
    if (!stats?.barData || chopFilterGeneral === 'all') return null
    const chop = stats.barData.chop
    if (!chop) return null
    return chop.reduce((acc, v, i) => {
      if (chopTest(v, chopFilterGeneral)) acc.push(i)
      return acc
    }, [])
  }, [stats?.barData, chopFilterGeneral, chopLowMax, chopHighMin])

  // Recompute all General Stats tab data when chop filter is active
  const generalTabData = useMemo(() => {
    if (!stats?.barData || chopFilterGeneral === 'all') return null
    const bd = stats.barData
    const idx = filteredBarIndices
    const maPeriods = stats.maPeriods || []
    return {
      general: computeGeneral(bd, idx),
      stateStats: bd.state ? computeStateDistribution(bd, idx) : [],
      barLocation: computeBarLocation(bd, idx, maPeriods),
      beyondBarLocation: computeBeyondBarLocation(bd, idx, maPeriods),
      wickDist: bd.ddRR ? computeWickDist(bd, idx) : null,
    }
  }, [stats?.barData, stats?.maPeriods, filteredBarIndices, chopFilterGeneral])

  // Compute SQF bounds from raw signal data (not filtered), split by type and UP/DN
  const sqfBounds = useMemo(() => {
    if (!signalData) return null
    const suffix = sqfNormMode === 'adr' ? '_adr' : '_rr'
    const groups = [
      { key: 'ema1', field: 'ema1Dist' },
      { key: 'ema2', field: 'ema2Dist' },
      { key: 'ema3', field: 'ema3Dist' },
      { key: 'dd', field: 'dd' },
    ]
    const result = {}
    for (const [type, upKey, dnKey] of [['t1', 'type1Up', 'type1Dn'], ['t2', 'type2Up', 'type2Dn']]) {
      const bounds = {}
      for (const { key, field } of groups) {
        const fld = field + suffix
        const upVals = (signalData[upKey] || []).map(p => p[fld]).filter(v => v != null)
        const dnVals = (signalData[dnKey] || []).map(p => p[fld]).filter(v => v != null)
        const round1 = v => Math.round(v * 10) / 10
        bounds[key] = {
          up: upVals.length > 0
            ? [round1(Math.min(...upVals) - 0.1), round1(Math.max(...upVals) + 0.1)]
            : [0, 0],
          dn: dnVals.length > 0
            ? [round1(Math.max(...dnVals) + 0.1), round1(Math.min(...dnVals) - 0.1)]
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
    ]
    for (const { key, field } of groups) {
      const cfg = sqfFilters[type][key]
      const enabled = dir === 'up' ? cfg.upEnabled : cfg.dnEnabled
      if (!enabled) continue
      const val = pt[field + suffix]
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

  // Filter signal data by per-type N selections, enabled state, chop regime, and SQF
  const filteredSignalData = useMemo(() => {
    if (!signalData) return {}
    const t1NsSet = new Set(selectedType1Ns)
    const t2NsSet = new Set(selectedType2Ns)
    const passesChop = (pt) => chopTest(pt.chop, chopFilterSignals)
    const result = {}
    for (const [key, arr] of Object.entries(signalData)) {
      const dir = key.endsWith('Up') ? 'up' : 'dn'
      if (key.startsWith('type1')) {
        result[key] = type1Enabled && arr ? arr.filter(pt => t1NsSet.has(pt.n) && passesChop(pt) && passesSqf(pt, dir, 't1')) : []
      } else if (key.startsWith('type2')) {
        result[key] = type2Enabled && arr ? arr.filter(pt => t2NsSet.has(pt.n) && passesChop(pt) && passesSqf(pt, dir, 't2')) : []
      } else {
        result[key] = arr || []
      }
    }
    return result
  }, [signalData, selectedType1Ns, selectedType2Ns, type1Enabled, type2Enabled, chopFilterSignals, chopLowMax, chopHighMin, sqfFilters, sqfNormMode])

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
      { key: 'low', label: `Low (<${chopLowMax})`, test: v => v < chopLowMax },
      { key: 'mid', label: `Mid (${chopLowMax}-${chopHighMin})`, test: v => v >= chopLowMax && v <= chopHighMin },
      { key: 'high', label: `High (>${chopHighMin})`, test: v => v > chopHighMin },
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
  }, [filteredSignalData, selectedRRField, chopLowMax, chopHighMin])

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

  // Use client-side filtered data when chop filter is active, otherwise use backend stats
  const g = generalTabData
  const totalBars = g ? g.general.totalBars : stats.totalBars
  const upBars = g ? g.general.upBars : stats.upBars
  const dnBars = g ? g.general.dnBars : stats.dnBars
  const _maStats = g ? g.barLocation.maStats : stats.maStats
  const _allMaStats = g ? g.barLocation.allMaStats : stats.allMaStats
  const _beyondMaStats = g ? g.beyondBarLocation.beyondMaStats : stats.beyondMaStats
  const _beyondAllMaStats = g ? g.beyondBarLocation.beyondAllMaStats : stats.beyondAllMaStats
  const _chopStats = stats.chopStats
  const _stateStats = g ? g.stateStats : stats.stateStats
  const _wickDist = g ? g.wickDist : stats.wickDist
  const _hemisphere = stats.barData ? computeHemisphere(stats.barData, null, stats.maPeriods || []) : []
  const { settings, chopRegimeStats } = stats

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
            className={`stats-tab ${activeTab === 'conditional' ? 'active' : ''}`}
            onClick={() => setActiveTab('conditional')}
          >Conditional</button>
        </div>
        <div className="stats-file-header">
          <span className="stats-filename">{filename}</span>
          <span className="stats-total">{totalBars.toLocaleString()} bars</span>
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

      {/* Chop Filter Bar — fixed above scroll, shared UI, independent per-tab state */}
      {activeTab !== 'conditional' && <div className="chop-filter-bar">
        <span className="chop-filter-label">Chop:</span>
        {[
          { value: 'all', label: 'All' },
          { value: 'low', label: `Low (<${chopLowMax})` },
          { value: 'mid', label: `Mid (${chopLowMax}-${chopHighMin})` },
          { value: 'high', label: `High (>${chopHighMin})` },
        ].map(opt => (
          <button
            key={opt.value}
            className={`chop-filter-btn${chopFilter === opt.value ? ' active' : ''}`}
            onClick={() => handleChopFilterChange(opt.value)}
          >
            {opt.label}
          </button>
        ))}
        <span className="chop-filter-sep" />
        <span className="chop-range-label">Low&lt;</span>
        <input
          type="number"
          className="chop-range-input"
          value={chopLowMax}
          step="0.05"
          min="0"
          max="1"
          onChange={e => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v)) setChopLowMax(v)
          }}
        />
        <span className="chop-range-label">High&gt;</span>
        <input
          type="number"
          className="chop-range-input"
          value={chopHighMin}
          step="0.05"
          min="0"
          max="1"
          onChange={e => {
            const v = parseFloat(e.target.value)
            if (!isNaN(v)) setChopHighMin(v)
          }}
        />
      </div>}

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
                  {/* Signal Quality Filters — separate T1 and T2 panels */}
                  {[
                    { type: 't1', label: 'Signal Quality-T1', open: sqfPanelOpenT1, setOpen: setSqfPanelOpenT1 },
                    { type: 't2', label: 'Signal Quality-T2', open: sqfPanelOpenT2, setOpen: setSqfPanelOpenT2 },
                  ].filter(({ type }) => sqfBounds?.[type]).map(({ type, label, open, setOpen }) => (
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
                          ].filter(g => sqfBounds[type][g.key]?.available).map(({ key, label: groupLabel, tooltip }) => (
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
                                      step="0.1"
                                      className="sqf-range-input"
                                      disabled={!enabled}
                                      placeholder={bounds[0]?.toFixed(1) ?? ''}
                                      value={cfg[rangeKey][0] ?? ''}
                                      onChange={e => updateSqfRange(type, key, rangeKey, 0, e.target.value)}
                                    />
                                    <span className="sqf-range-sep">to</span>
                                    <input
                                      type="number"
                                      step="0.1"
                                      className="sqf-range-input"
                                      disabled={!enabled}
                                      placeholder={bounds[1]?.toFixed(1) ?? ''}
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
                    <th colSpan="5" className="module-title" data-tooltip="Signal performance summary for Type1 (MA1 touch reversal) and Type2 (wicked bars in +3/-3 state)">SIGNAL PERFORMANCE</th>
                  </tr>
                  <tr>
                    <th></th>
                    <th colSpan="2">Type 1</th>
                    <th colSpan="2">Type 2</th>
                  </tr>
                  <tr>
                    <th></th>
                    <th className="up">UP</th>
                    <th className="dn">DN</th>
                    <th className="up">UP</th>
                    <th className="dn">DN</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Count</td>
                    <td className="up">{type1Stats?.upSummary.count ?? '—'}</td>
                    <td className="dn">{type1Stats?.dnSummary.count ?? '—'}</td>
                    <td className="up">{type2Stats?.upSummary.count ?? '—'}</td>
                    <td className="dn">{type2Stats?.dnSummary.count ?? '—'}</td>
                  </tr>
                  <tr>
                    <td>Avg RR</td>
                    <td className="up">{type1Stats?.upSummary.avgRR ?? '—'}</td>
                    <td className="dn">{type1Stats?.dnSummary.avgRR ?? '—'}</td>
                    <td className="up">{type2Stats?.upSummary.avgRR ?? '—'}</td>
                    <td className="dn">{type2Stats?.dnSummary.avgRR ?? '—'}</td>
                  </tr>
                  <tr>
                    <td>Win Rate</td>
                    <td className="up">{type1Stats ? `${type1Stats.upSummary.winRate}%` : '—'}</td>
                    <td className="dn">{type1Stats ? `${type1Stats.dnSummary.winRate}%` : '—'}</td>
                    <td className="up">{type2Stats ? `${type2Stats.upSummary.winRate}%` : '—'}</td>
                    <td className="dn">{type2Stats ? `${type2Stats.dnSummary.winRate}%` : '—'}</td>
                  </tr>
                </tbody>
                {/* RR Distribution */}
                <thead>
                  <tr className="module-title-row">
                    <th colSpan="5" className="module-title">RR DISTRIBUTION</th>
                  </tr>
                  <tr>
                    <th></th>
                    <th colSpan="2">Type 1</th>
                    <th colSpan="2">Type 2</th>
                  </tr>
                  <tr>
                    <th>RR</th>
                    <th className="up">UP</th>
                    <th className="dn">DN</th>
                    <th className="up">UP</th>
                    <th className="dn">DN</th>
                  </tr>
                </thead>
                <tbody>
                  {RR_BUCKETS.map((bucket, i) => (
                    <tr key={bucket.label}>
                      <td>{bucket.label}</td>
                      <td className="up">{type1Stats ? `${type1Stats.upDist[i].count} (${type1Stats.upDist[i].pct}%)` : '—'}</td>
                      <td className="dn">{type1Stats ? `${type1Stats.dnDist[i].count} (${type1Stats.dnDist[i].pct}%)` : '—'}</td>
                      <td className="up">{type2Stats ? `${type2Stats.upDist[i].count} (${type2Stats.upDist[i].pct}%)` : '—'}</td>
                      <td className="dn">{type2Stats ? `${type2Stats.dnDist[i].count} (${type2Stats.dnDist[i].pct}%)` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Chop Regime Stats — single combined table */}
          {chopRegimeStats && (
            <div className="stats-module">
              <table className="stats-table">
                {/* Section 1: Chop Regime Overview */}
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
                {/* Section 2: State Distribution by Chop */}
                {chopRegimeStats.stateByChop?.length > 0 && (
                  <>
                    <thead>
                      <tr className="module-title-row">
                        <th colSpan="4" className="module-title" data-tooltip="State distribution within each chop regime (all bars)">STATE DISTRIBUTION BY CHOP</th>
                      </tr>
                      <tr>
                        <th>State</th>
                        <th>Low (&lt;{chopLowMax})</th>
                        <th>Mid ({chopLowMax}-{chopHighMin})</th>
                        <th>High (&gt;{chopHighMin})</th>
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
                  </>
                )}
                {/* Section 3: Signal Performance by Chop */}
                {chopSignalPerf && (
                  <>
                    <thead>
                      <tr className="module-title-row">
                        <th colSpan="4" className="module-title" data-tooltip="Signal performance within each chop regime (signal bars only, respects filters)">SIGNAL PERF BY CHOP</th>
                      </tr>
                      <tr>
                        <th></th>
                        <th>Low (&lt;{chopLowMax})</th>
                        <th>Mid ({chopLowMax}-{chopHighMin})</th>
                        <th>High (&gt;{chopHighMin})</th>
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
                  </>
                )}
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

        </div>
      )}

      {/* ==================== Conditional Tab ==================== */}
      {activeTab === 'conditional' && (
        <div className="stats-tab-content">
          {/* State x Consecutive Bars Heatmap */}
          {stats.stateConbarsHeatmap && stats.stateConbarsHeatmap.length > 0 && (() => {
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
            const conBarsRange = stats.stateConbarsHeatmap.map(r => r.conBars);
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
                        {stats.stateConbarsHeatmap.map(row => {
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
                        <th key={s} className={s > 0 ? 'up' : 'dn'}>{stateLabels[s]}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {stats.stateTransitionMatrix.map(row => (
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
    </div>
  )
}

export default StatsPage
