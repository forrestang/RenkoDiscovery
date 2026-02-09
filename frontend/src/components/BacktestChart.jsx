import { useRef, useEffect } from 'react'
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts'

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseUTC(dtStr) {
  if (!dtStr.endsWith('Z') && !dtStr.includes('+') && !dtStr.includes('-', 10)) {
    dtStr = dtStr.replace(' ', 'T') + 'Z'
  }
  return new Date(dtStr)
}

function formatTimestamp(isoString) {
  if (!isoString) return null
  const date = parseUTC(isoString)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  const hours = String(date.getUTCHours()).padStart(2, '0')
  const minutes = String(date.getUTCMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

function formatTickMark(isoString) {
  if (!isoString) return null
  const date = parseUTC(isoString)
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${month}-${day}`
}

// ── Custom Primitives ────────────────────────────────────────────────────────

// Type markers ("1" / "2" text) in indicator pane
class TypeMarkersPrimitive {
  constructor() {
    this._markers = []
    this._chart = null
    this._series = null
  }
  setMarkers(markers) { this._markers = markers || [] }
  attached(param) { this._chart = param.chart; this._series = param.series }
  detached() { this._chart = null; this._series = null }
  updateAllViews() {}
  paneViews() { return [new TypeMarkersPaneView(this)] }
}

class TypeMarkersPaneView {
  constructor(source) { this._source = source }
  update() {}
  renderer() { return new TypeMarkersRenderer(this._source) }
  zOrder() { return 'top' }
}

class TypeMarkersRenderer {
  constructor(source) { this._source = source }
  draw(target) {
    const markers = this._source._markers
    const chart = this._source._chart
    const series = this._source._series
    if (!markers.length || !chart || !series) return
    const timeScale = chart.timeScale()
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context
      const hRatio = scope.horizontalPixelRatio
      const vRatio = scope.verticalPixelRatio
      ctx.font = `bold ${Math.round(11 * vRatio)}px "JetBrains Mono", monospace`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      for (const marker of markers) {
        const x = timeScale.logicalToCoordinate(marker.time)
        const y = series.priceToCoordinate(marker.value)
        if (x === null || y === null) continue
        ctx.fillStyle = marker.color
        ctx.fillText(marker.text, Math.round(x * hRatio), Math.round(y * vRatio))
      }
    })
  }
}

// Horizontal grid lines at state levels in indicator pane
class IndicatorHorzGridPrimitive {
  constructor() {
    this._levels = [-3, -2, -1, 1, 2, 3]
    this._chart = null
    this._series = null
  }
  attached(param) { this._chart = param.chart; this._series = param.series }
  detached() { this._chart = null; this._series = null }
  updateAllViews() {}
  paneViews() { return [new IndicatorHorzGridPaneView(this)] }
}

class IndicatorHorzGridPaneView {
  constructor(source) { this._source = source }
  update() {}
  renderer() { return new IndicatorHorzGridRenderer(this._source) }
  zOrder() { return 'bottom' }
}

class IndicatorHorzGridRenderer {
  constructor(source) { this._source = source }
  draw(target) {
    const levels = this._source._levels
    const series = this._source._series
    if (!levels.length || !series) return
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context
      const hRatio = scope.horizontalPixelRatio
      const vRatio = scope.verticalPixelRatio
      const width = scope.bitmapSize.width
      ctx.strokeStyle = '#27272a'
      ctx.lineWidth = 1 * hRatio
      for (const level of levels) {
        const y = series.priceToCoordinate(level)
        if (y === null) continue
        const yPx = Math.round(y * vRatio)
        ctx.beginPath()
        ctx.moveTo(0, yPx)
        ctx.lineTo(width, yPx)
        ctx.stroke()
      }
    })
  }
}

// Lines connecting trade entry to exit
class TradeLinePrimitive {
  constructor() {
    this._trades = []
    this._chart = null
    this._series = null
    this._lineWeight = 1.5
    this._lineStyle = 'dotted'
  }
  setTrades(trades) { this._trades = trades || [] }
  setOptions({ lineWeight, lineStyle }) {
    if (lineWeight !== undefined) this._lineWeight = lineWeight
    if (lineStyle !== undefined) this._lineStyle = lineStyle
  }
  attached(param) { this._chart = param.chart; this._series = param.series }
  detached() { this._chart = null; this._series = null }
  updateAllViews() {}
  paneViews() { return [new TradeLinePaneView(this)] }
}

class TradeLinePaneView {
  constructor(source) { this._source = source }
  update() {}
  renderer() { return new TradeLineRenderer(this._source) }
  zOrder() { return 'top' }
}

class TradeLineRenderer {
  constructor(source) { this._source = source }
  draw(target) {
    const trades = this._source._trades
    const chart = this._source._chart
    const series = this._source._series
    if (!trades.length || !chart || !series) return
    const timeScale = chart.timeScale()
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context
      const hRatio = scope.horizontalPixelRatio
      const vRatio = scope.verticalPixelRatio
      for (const trade of trades) {
        const x1 = timeScale.logicalToCoordinate(trade.entryTime)
        const y1 = series.priceToCoordinate(trade.entryPrice)
        const x2 = timeScale.logicalToCoordinate(trade.exitTime)
        const y2 = series.priceToCoordinate(trade.exitPrice)
        if (x1 === null || y1 === null || x2 === null || y2 === null) continue
        ctx.strokeStyle = trade.isProfit ? '#22c55e' : '#ef4444'
        ctx.lineWidth = this._source._lineWeight * hRatio
        const style = this._source._lineStyle
        if (style === 'dashed') ctx.setLineDash([6 * hRatio, 4 * hRatio])
        else if (style === 'dotted') ctx.setLineDash([2 * hRatio, 2 * hRatio])
        else ctx.setLineDash([])
        ctx.beginPath()
        ctx.moveTo(Math.round(x1 * hRatio), Math.round(y1 * vRatio))
        ctx.lineTo(Math.round(x2 * hRatio), Math.round(y2 * vRatio))
        ctx.stroke()
        ctx.setLineDash([])
      }
    })
  }
}

// Filled circles at exact (time, price) coordinates for trade entry/exit
class TradeMarkerPrimitive {
  constructor() {
    this._markers = []
    this._chart = null
    this._series = null
    this._markerSize = 4
  }
  setMarkers(markers) { this._markers = markers || [] }
  setOptions({ markerSize }) {
    if (markerSize !== undefined) this._markerSize = markerSize
  }
  attached(param) { this._chart = param.chart; this._series = param.series }
  detached() { this._chart = null; this._series = null }
  updateAllViews() {}
  paneViews() { return [new TradeMarkerPaneView(this)] }
}

class TradeMarkerPaneView {
  constructor(source) { this._source = source }
  update() {}
  renderer() { return new TradeMarkerRenderer(this._source) }
  zOrder() { return 'top' }
}

class TradeMarkerRenderer {
  constructor(source) { this._source = source }
  draw(target) {
    const markers = this._source._markers
    const chart = this._source._chart
    const series = this._source._series
    if (!markers.length || !chart || !series) return
    const timeScale = chart.timeScale()
    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context
      const hRatio = scope.horizontalPixelRatio
      const vRatio = scope.verticalPixelRatio
      const radius = this._source._markerSize * hRatio
      for (const marker of markers) {
        const x = timeScale.logicalToCoordinate(marker.time)
        const y = series.priceToCoordinate(marker.price)
        if (x === null || y === null) continue
        ctx.fillStyle = marker.color
        ctx.beginPath()
        ctx.arc(Math.round(x * hRatio), Math.round(y * vRatio), radius, 0, Math.PI * 2)
        ctx.fill()
      }
    })
  }
}

// ── Constants ────────────────────────────────────────────────────────────────

const MA_COLORS = ['#f59e0b', '#3b82f6', '#a855f7']
const STORAGE_PREFIX = 'RenkoDiscovery_'

// ── Component ────────────────────────────────────────────────────────────────

// Custom primitive for drawing vertical grid lines at session boundaries
class DayBoundaryGridPrimitive {
  constructor() {
    this._boundaries = []
    this._chart = null
    this._series = null
  }

  setBoundaries(boundaries) {
    this._boundaries = boundaries || []
  }

  attached(param) {
    this._chart = param.chart
    this._series = param.series
  }

  detached() {
    this._chart = null
    this._series = null
  }

  updateAllViews() {}

  paneViews() {
    return [new DayBoundaryGridPaneView(this)]
  }
}

class DayBoundaryGridPaneView {
  constructor(source) {
    this._source = source
  }

  update() {}

  renderer() {
    return new DayBoundaryGridRenderer(this._source)
  }

  zOrder() {
    return 'bottom'
  }
}

class DayBoundaryGridRenderer {
  constructor(source) {
    this._source = source
  }

  draw(target) {
    const boundaries = this._source._boundaries
    const chart = this._source._chart

    if (!boundaries.length || !chart) return

    const timeScale = chart.timeScale()

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context
      const hRatio = scope.horizontalPixelRatio
      const height = scope.bitmapSize.height

      ctx.strokeStyle = '#27272a'
      ctx.lineWidth = 1 * hRatio

      for (const boundary of boundaries) {
        const x = timeScale.logicalToCoordinate(boundary)
        if (x === null) continue

        const xPx = Math.round(x * hRatio)

        ctx.beginPath()
        ctx.moveTo(xPx, 0)
        ctx.lineTo(xPx, height)
        ctx.stroke()
      }
    })
  }
}

function BacktestChart({ barData, trades, pricePrecision, showIndicator, focusBar, lineWeight, lineStyle, markerSize, sessionBreaks, showEMA, showSMAE, showPWAP }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const maSeriesRefs = useRef([null, null, null])
  const indicatorSeriesRef = useRef(null)
  const typeMarkersPrimRef = useRef(null)
  const tradeLinePrimRef = useRef(null)
  const tradeMarkerPrimRef = useRef(null)
  const indicatorPaneHeightRef = useRef(
    parseInt(localStorage.getItem(`${STORAGE_PREFIX}btIndicatorPaneHeight`), 10) || 120
  )

  // Main chart setup + data
  useEffect(() => {
    if (!containerRef.current || !barData?.open) return

    const { open, close, high, low, datetime } = barData
    const len = open.length
    if (len === 0) return

    // Clean up previous chart
    if (chartRef.current) {
      chartRef.current.remove()
      chartRef.current = null
      seriesRef.current = null
      maSeriesRefs.current = [null, null, null]
      indicatorSeriesRef.current = null
      typeMarkersPrimRef.current = null
      tradeLinePrimRef.current = null
      tradeMarkerPrimRef.current = null
    }

    // Create chart
    const datetimes = datetime || []
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: 'solid', color: '#09090b' },
        textColor: '#a1a1aa',
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: '#27272a', visible: false },
        horzLines: { color: '#27272a', visible: false },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: '#71717a', width: 1, style: 2, labelBackgroundColor: '#27272a' },
        horzLine: { color: '#71717a', width: 1, style: 2, labelBackgroundColor: '#27272a' },
      },
      rightPriceScale: {
        borderColor: '#27272a',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: false,
        secondsVisible: false,
        barSpacing: 6,
        minBarSpacing: 0.5,
        tickMarkFormatter: (time) => {
          const dt = datetimes[time]
          return dt ? formatTickMark(dt) : String(time)
        },
      },
      localization: {
        timeFormatter: (time) => {
          const dt = datetimes[time]
          return dt ? formatTimestamp(dt) : `Bar ${time}`
        },
      },
      handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
    })

    chartRef.current = chart

    // MA line series from parquet (added first so bars render on top)
    if (showEMA !== false) {
      const emaKeys = ['ema1Price', 'ema2Price', 'ema3Price']
      for (let m = 0; m < 3; m++) {
        const emaArr = barData[emaKeys[m]]
        if (!emaArr) continue
        const maData = []
        for (let i = 0; i < len; i++) {
          if (emaArr[i] != null) maData.push({ time: i, value: emaArr[i] })
        }
        if (maData.length === 0) continue
        const maSeries = chart.addSeries(LineSeries, {
          color: MA_COLORS[m],
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
          priceFormat: {
            type: 'price',
            precision: pricePrecision,
            minMove: Math.pow(10, -pricePrecision),
          },
        })
        maSeries.setData(maData)
        maSeriesRefs.current[m] = maSeries
      }
    }

    // SMAE (ENV1/ENV2) overlay series
    if (showSMAE) {
      const envConfigs = [
        { prefix: 'smae1', color: '#22d3ee' },  // ENV1 = cyan
        { prefix: 'smae2', color: '#fb923c' },  // ENV2 = orange
      ]
      for (const { prefix, color } of envConfigs) {
        const centerArr = barData[`${prefix}Center`]
        if (!centerArr) continue
        const upperArr = barData[`${prefix}Upper`]
        const lowerArr = barData[`${prefix}Lower`]
        const priceFormat = { type: 'price', precision: pricePrecision, minMove: Math.pow(10, -pricePrecision) }
        const baseOpts = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat }
        // Center line (solid)
        const centerData = []
        for (let i = 0; i < len; i++) if (centerArr[i] != null) centerData.push({ time: i, value: centerArr[i] })
        if (centerData.length > 0) {
          const s = chart.addSeries(LineSeries, { ...baseOpts, color, lineWidth: 1, lineStyle: 0 })
          s.setData(centerData)
        }
        // Upper band (dashed)
        if (upperArr) {
          const d = []
          for (let i = 0; i < len; i++) if (upperArr[i] != null) d.push({ time: i, value: upperArr[i] })
          if (d.length > 0) {
            const s = chart.addSeries(LineSeries, { ...baseOpts, color, lineWidth: 1, lineStyle: 2 })
            s.setData(d)
          }
        }
        // Lower band (dashed)
        if (lowerArr) {
          const d = []
          for (let i = 0; i < len; i++) if (lowerArr[i] != null) d.push({ time: i, value: lowerArr[i] })
          if (d.length > 0) {
            const s = chart.addSeries(LineSeries, { ...baseOpts, color, lineWidth: 1, lineStyle: 2 })
            s.setData(d)
          }
        }
      }
    }

    // PWAP overlay series
    if (showPWAP) {
      const pwapColor = '#f472b6'
      const priceFormat = { type: 'price', precision: pricePrecision, minMove: Math.pow(10, -pricePrecision) }
      const baseOpts = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, priceFormat }
      // Mean line (solid, thicker)
      const meanArr = barData.pwapMean
      if (meanArr) {
        const d = []
        for (let i = 0; i < len; i++) if (meanArr[i] != null) d.push({ time: i, value: meanArr[i] })
        if (d.length > 0) {
          const s = chart.addSeries(LineSeries, { ...baseOpts, color: pwapColor, lineWidth: 2, lineStyle: 0 })
          s.setData(d)
        }
      }
      // Upper/Lower bands (dashed)
      for (let b = 1; b <= 4; b++) {
        for (const side of ['Upper', 'Lower']) {
          const arr = barData[`pwap${side}${b}`]
          if (!arr) continue
          const d = []
          for (let i = 0; i < len; i++) if (arr[i] != null) d.push({ time: i, value: arr[i] })
          if (d.length > 0) {
            const s = chart.addSeries(LineSeries, { ...baseOpts, color: pwapColor, lineWidth: 1, lineStyle: 2 })
            s.setData(d)
          }
        }
      }
    }

    // Candlestick series (renko: white up, gray down) — added after MAs so bars are on top
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#ffffff',
      downColor: '#888888',
      borderUpColor: '#ffffff',
      borderDownColor: '#888888',
      wickUpColor: '#ffffff',
      wickDownColor: '#888888',
      lastValueVisible: false,
      priceLineVisible: false,
      priceFormat: {
        type: 'price',
        precision: pricePrecision,
        minMove: Math.pow(10, -pricePrecision),
      },
    })

    const candleData = open.map((_, i) => ({
      time: i,
      open: open[i],
      high: high[i],
      low: low[i],
      close: close[i],
    }))
    candleSeries.setData(candleData)
    seriesRef.current = candleSeries

    // Session boundary lines
    const dayBoundPrim = new DayBoundaryGridPrimitive()
    dayBoundPrim.setBoundaries(sessionBreaks)
    candleSeries.attachPrimitive(dayBoundPrim)

    // Trade line primitive (lines connecting entry → exit)
    const tradeLinePrim = new TradeLinePrimitive()
    tradeLinePrim.setOptions({ lineWeight: lineWeight ?? 1.5, lineStyle: lineStyle ?? 'dotted' })
    candleSeries.attachPrimitive(tradeLinePrim)
    tradeLinePrimRef.current = tradeLinePrim

    // Trade marker primitive (filled circles at exact prices)
    const tradeMarkerPrim = new TradeMarkerPrimitive()
    tradeMarkerPrim.setOptions({ markerSize: markerSize ?? 4 })
    candleSeries.attachPrimitive(tradeMarkerPrim)
    tradeMarkerPrimRef.current = tradeMarkerPrim

    // Trade markers + connecting lines
    if (trades && trades.length > 0) {
      const markerData = []
      const lineData = []

      for (const t of trades) {
        // Entry marker at exact entry price
        markerData.push({ time: t.idx, price: t.entry_price, color: t.signalColor || '#71717a' })

        // Exit marker + connecting line (only for closed trades)
        if (t.exit_idx != null) {
          markerData.push({ time: t.exit_idx, price: t.exit_price, color: t.signalColor || '#71717a' })
          lineData.push({
            entryTime: t.idx,
            entryPrice: t.entry_price,
            exitTime: t.exit_idx,
            exitPrice: t.exit_price,
            isProfit: t.result > 0,
          })
        }
      }

      tradeMarkerPrim.setMarkers(markerData)
      tradeLinePrim.setTrades(lineData)
    }

    // Set visible range — show last 200 bars
    const visibleBars = Math.min(200, len)
    chart.timeScale().setVisibleRange({
      from: len - visibleBars,
      to: len - 1,
    })

    // Resize observer
    const resizeObserver = new ResizeObserver(entries => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect
        if (width > 0 && height > 0) chart.resize(width, height)
      }
    })
    resizeObserver.observe(containerRef.current)

    // Save indicator pane height on pointer up
    const handlePointerUp = () => {
      if (!chartRef.current) return
      const panes = chartRef.current.panes()
      if (panes && panes[1]) {
        const h = panes[1].getHeight()
        if (h && h !== indicatorPaneHeightRef.current) {
          indicatorPaneHeightRef.current = h
          localStorage.setItem(`${STORAGE_PREFIX}btIndicatorPaneHeight`, h.toString())
        }
      }
    }
    containerRef.current.addEventListener('pointerup', handlePointerUp)

    return () => {
      resizeObserver.disconnect()
      if (containerRef.current) {
        containerRef.current.removeEventListener('pointerup', handlePointerUp)
      }
      if (chartRef.current) {
        chartRef.current.remove()
        chartRef.current = null
      }
      seriesRef.current = null
      maSeriesRefs.current = [null, null, null]
      indicatorSeriesRef.current = null
      typeMarkersPrimRef.current = null
      tradeLinePrimRef.current = null
      tradeMarkerPrimRef.current = null
    }
  }, [barData, trades, pricePrecision, lineWeight, lineStyle, markerSize, sessionBreaks, showEMA, showSMAE, showPWAP])

  // Indicator pane (togglable)
  useEffect(() => {
    const chart = chartRef.current
    if (!chart || !barData?.open) return

    // Remove existing indicator series
    if (indicatorSeriesRef.current) {
      chart.removeSeries(indicatorSeriesRef.current)
      indicatorSeriesRef.current = null
      typeMarkersPrimRef.current = null
    }

    if (!showIndicator) return

    const { state } = barData
    const type1 = barData.type1
    const type2 = barData.type2
    const len = barData.open.length

    // Build state data + type markers from parquet columns
    const stateData = []
    const typeMarkers = []

    for (let i = 0; i < len; i++) {
      const st = state ? state[i] : null
      if (st == null || st === 0) continue
      stateData.push({ time: i, value: st })

      // Type1 from parquet
      if (type1) {
        if (type1[i] > 0) typeMarkers.push({ time: i, value: -5, text: '1', color: '#10b981' })
        if (type1[i] < 0) typeMarkers.push({ time: i, value: 5, text: '1', color: '#f43f5e' })
      }

      // Type2 from parquet
      if (type2) {
        if (type2[i] > 0) typeMarkers.push({ time: i, value: -4, text: '2', color: '#10b981' })
        if (type2[i] < 0) typeMarkers.push({ time: i, value: 4, text: '2', color: '#f43f5e' })
      }
    }

    if (stateData.length === 0) return

    // Autoscale provider for fixed range
    const autoscaleProvider = () => ({
      priceRange: { minValue: -6, maxValue: 6 },
    })

    // Create state series in pane 1
    const indicatorSeries = chart.addSeries(LineSeries, {
      color: '#71717a',
      lineWidth: 0,
      pointMarkersVisible: true,
      pointMarkersRadius: 3,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
      autoscaleInfoProvider: autoscaleProvider,
    }, 1)
    indicatorSeries.setData(stateData)
    indicatorSeriesRef.current = indicatorSeries

    // Type markers primitive
    const typePrim = new TypeMarkersPrimitive()
    typePrim.setMarkers(typeMarkers)
    indicatorSeries.attachPrimitive(typePrim)
    typeMarkersPrimRef.current = typePrim

    // Session boundary lines for indicator pane
    const indDayBoundPrim = new DayBoundaryGridPrimitive()
    indDayBoundPrim.setBoundaries(sessionBreaks)
    indicatorSeries.attachPrimitive(indDayBoundPrim)

    // Horizontal grid primitive
    const gridPrim = new IndicatorHorzGridPrimitive()
    indicatorSeries.attachPrimitive(gridPrim)

    // Set pane height
    const panes = chart.panes()
    if (panes && panes[1]) {
      panes[1].setHeight(indicatorPaneHeightRef.current)
    }

    // Force redraw
    chart.timeScale().applyOptions({})
  }, [barData, showIndicator, pricePrecision, sessionBreaks])

  // Focus bar (scroll to trade from trade log click)
  useEffect(() => {
    if (!focusBar || focusBar.idx == null || !chartRef.current || !barData?.open) return
    const len = barData.open.length
    const visibleRange = chartRef.current.timeScale().getVisibleRange()
    const visibleBars = visibleRange ? (visibleRange.to - visibleRange.from) : 200
    // scrollToPosition uses negative offset from the right edge
    chartRef.current.timeScale().scrollToPosition(focusBar.idx - len + Math.round(visibleBars / 2), false)
  }, [focusBar, barData])

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}

export default BacktestChart
