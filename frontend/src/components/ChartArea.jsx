import { useRef, useEffect, useState } from 'react'
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts'
import DataWindow from './DataWindow'
import './ChartArea.css'

// Format timestamp for crosshair label (includes year)
function formatTimestamp(isoString) {
  if (!isoString) return null
  const date = new Date(isoString)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const hours = String(date.getHours()).padStart(2, '0')
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${year}-${month}-${day} ${hours}:${minutes}`
}

// Short format for tick marks
function formatTickMark(isoString) {
  if (!isoString) return null
  const date = new Date(isoString)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${month}-${day}`
}

// Parse a datetime string as UTC
function parseUTC(dtStr) {
  if (!dtStr.endsWith('Z') && !dtStr.includes('+') && !dtStr.includes('-', 10)) {
    dtStr = dtStr.replace(' ', 'T') + 'Z'
  }
  return new Date(dtStr)
}

// Day-of-week keys matching the schedule object (0=Sun..6=Sat)
const DOW_TO_KEY = [null, 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', null]

// Get the session boundary time (in minutes since midnight UTC) for a given weekday
function getBoundaryMinutes(schedule, dow) {
  // dow: 0=Sun..6=Sat. Trading days are Mon(1)-Fri(5).
  const key = DOW_TO_KEY[dow]
  if (!key || !schedule[key]) return null
  return schedule[key].hour * 60 + schedule[key].minute
}

// Determine the session identifier for a given UTC timestamp using per-day schedule.
// Returns a string like "2024-01-15" (the close-date of the session this bar belongs to).
// The boundary for each trading day occurs at that day's configured hour:minute UTC.
// A bar at or after Monday's boundary but before Tuesday's boundary belongs to Tuesday's session.
function getSessionId(dt, schedule) {
  const dow = dt.getUTCDay() // 0=Sun..6=Sat
  const minuteOfDay = dt.getUTCHours() * 60 + dt.getUTCMinutes()

  // Weekend bars (Sat/Sun): assign to Monday session
  if (dow === 0 || dow === 6) {
    // Find next Monday
    const daysToMon = dow === 0 ? 1 : 2
    const mon = new Date(dt.getTime())
    mon.setUTCDate(mon.getUTCDate() + daysToMon)
    return mon.toISOString().split('T')[0]
  }

  // Trading day (Mon-Fri)
  const boundaryMin = getBoundaryMinutes(schedule, dow)
  if (boundaryMin === null) return dt.toISOString().split('T')[0]

  if (minuteOfDay < boundaryMin) {
    // Before today's boundary → belongs to today's session (today is the close day)
    return dt.toISOString().split('T')[0]
  } else {
    // At or after today's boundary → belongs to next trading day's session
    let nextDate = new Date(dt.getTime())
    nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    // Skip weekend
    if (nextDate.getUTCDay() === 6) nextDate.setUTCDate(nextDate.getUTCDate() + 2)
    if (nextDate.getUTCDay() === 0) nextDate.setUTCDate(nextDate.getUTCDate() + 1)
    return nextDate.toISOString().split('T')[0]
  }
}

// Find indices where session changes (index-based, for renko mode)
function findSessionBoundaryIndices(datetimes, schedule) {
  const boundaries = []
  let lastSessionId = null
  for (let i = 0; i < datetimes.length; i++) {
    const dt = parseUTC(datetimes[i])
    const sid = getSessionId(dt, schedule)
    if (lastSessionId !== null && sid !== lastSessionId) {
      boundaries.push(i)
    }
    lastSessionId = sid
  }
  return boundaries
}

// Find timestamps where session changes (for raw/overlay modes using time-based x-axis)
function findSessionBoundaryTimestamps(datetimes, schedule) {
  const boundaries = []
  let lastSessionId = null
  for (let i = 0; i < datetimes.length; i++) {
    const dt = parseUTC(datetimes[i])
    const sid = getSessionId(dt, schedule)
    if (lastSessionId !== null && sid !== lastSessionId) {
      boundaries.push(Math.floor(dt.getTime() / 1000))
    }
    lastSessionId = sid
  }
  return boundaries
}

// Custom primitive for drawing Renko brick overlays
class RenkoBricksPrimitive {
  constructor() {
    this._bricks = []
    this._chart = null
    this._series = null
  }

  setBricks(bricks) {
    this._bricks = bricks || []
  }

  attached(param) {
    this._chart = param.chart
    this._series = param.series
  }

  detached() {
    this._chart = null
    this._series = null
  }

  updateAllViews() {
    // Request redraw
  }

  paneViews() {
    return [new RenkoBricksPaneView(this)]
  }
}

class RenkoBricksPaneView {
  constructor(source) {
    this._source = source
  }

  update() {}

  renderer() {
    return new RenkoBricksRenderer(this._source)
  }

  zOrder() {
    return 'top'
  }
}

class RenkoBricksRenderer {
  constructor(source) {
    this._source = source
  }

  draw(target, priceConverter) {
    const bricks = this._source._bricks
    const chart = this._source._chart
    const series = this._source._series

    if (!bricks.length || !chart || !series) return

    const timeScale = chart.timeScale()

    // Precompute brick coordinates
    const bricksToDraw = []
    for (const brick of bricks) {
      const { tickOpen, tickClose, priceOpen, priceClose, priceHigh, priceLow, isUp, isPending } = brick

      const x1 = timeScale.logicalToCoordinate(tickOpen)
      const x2 = timeScale.logicalToCoordinate(tickClose)

      if (x1 === null || x2 === null) continue

      // Body coordinates (open/close)
      const bodyTop = series.priceToCoordinate(Math.max(priceOpen, priceClose))
      const bodyBottom = series.priceToCoordinate(Math.min(priceOpen, priceClose))

      // Wick coordinates (high/low) - use body bounds if no wick data
      const wickTop = priceHigh ? series.priceToCoordinate(priceHigh) : bodyTop
      const wickBottom = priceLow ? series.priceToCoordinate(priceLow) : bodyBottom

      if (bodyTop === null || bodyBottom === null) continue

      bricksToDraw.push({ x1, x2, bodyTop, bodyBottom, wickTop, wickBottom, isUp, isPending })
    }

    if (!bricksToDraw.length) return

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context
      const hRatio = scope.horizontalPixelRatio
      const vRatio = scope.verticalPixelRatio

      for (const { x1, x2, bodyTop, bodyBottom, wickTop, wickBottom, isUp, isPending } of bricksToDraw) {
        const left = Math.round(Math.min(x1, x2) * hRatio)
        const right = Math.round(Math.max(x1, x2) * hRatio)
        const xCenter = Math.round((left + right) / 2)

        const bTop = Math.round(Math.min(bodyTop, bodyBottom) * vRatio)
        const bBottom = Math.round(Math.max(bodyTop, bodyBottom) * vRatio)
        const wTop = Math.round(Math.min(wickTop, wickBottom) * vRatio)
        const wBottom = Math.round(Math.max(wickTop, wickBottom) * vRatio)

        const width = Math.max(right - left, 2)
        const height = Math.max(bBottom - bTop, 2)

        // Colors
        const fillAlpha = isPending ? 0.15 : 0.25
        const fillColor = isUp ? `rgba(16, 185, 129, ${fillAlpha})` : `rgba(244, 63, 94, ${fillAlpha})`
        const strokeColor = isUp ? '#059669' : '#e11d48'

        // Draw wick lines (only the portions extending beyond the brick body)
        ctx.strokeStyle = strokeColor
        ctx.lineWidth = 1 * hRatio
        ctx.setLineDash(isPending ? [4 * hRatio, 4 * hRatio] : [])

        // Upper wick (from body top to wick top)
        if (wTop < bTop) {
          ctx.beginPath()
          ctx.moveTo(xCenter, wTop)
          ctx.lineTo(xCenter, bTop)
          ctx.stroke()
        }

        // Lower wick (from body bottom to wick bottom)
        if (wBottom > bBottom) {
          ctx.beginPath()
          ctx.moveTo(xCenter, bBottom)
          ctx.lineTo(xCenter, wBottom)
          ctx.stroke()
        }

        // Draw brick body (filled rectangle, no border)
        ctx.fillStyle = fillColor
        ctx.fillRect(left, bTop, width, height)
      }
      ctx.setLineDash([])
    })
  }
}

// Custom primitive for drawing Type markers (text "1" and "2") in the indicator pane
class TypeMarkersPrimitive {
  constructor() {
    this._markers = []  // Array of { time, value, text, color }
    this._chart = null
    this._series = null
  }

  setMarkers(markers) {
    this._markers = markers || []
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
    return [new TypeMarkersPaneView(this)]
  }
}

class TypeMarkersPaneView {
  constructor(source) {
    this._source = source
  }

  update() {}

  renderer() {
    return new TypeMarkersRenderer(this._source)
  }

  zOrder() {
    return 'top'
  }
}

class TypeMarkersRenderer {
  constructor(source) {
    this._source = source
  }

  draw(target, priceConverter) {
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

        const xPx = Math.round(x * hRatio)
        const yPx = Math.round(y * vRatio)

        ctx.fillStyle = marker.color
        ctx.fillText(marker.text, xPx, yPx)
      }
    })
  }
}

// Custom primitive for drawing vertical grid lines at session boundaries
class DayBoundaryGridPrimitive {
  constructor(useTimestamps = false) {
    this._boundaries = []  // Array of bar indices or timestamps where session changes
    this._chart = null
    this._series = null
    this._useTimestamps = useTimestamps
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

  draw(target, priceConverter) {
    const boundaries = this._source._boundaries
    const chart = this._source._chart
    const useTimestamps = this._source._useTimestamps

    if (!boundaries.length || !chart) return

    const timeScale = chart.timeScale()

    target.useBitmapCoordinateSpace(scope => {
      const ctx = scope.context
      const hRatio = scope.horizontalPixelRatio
      const vRatio = scope.verticalPixelRatio
      const height = scope.bitmapSize.height

      ctx.strokeStyle = '#27272a'
      ctx.lineWidth = 1 * hRatio

      for (const boundary of boundaries) {
        const x = useTimestamps
          ? timeScale.timeToCoordinate(boundary)
          : timeScale.logicalToCoordinate(boundary)
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

// Custom primitive for drawing horizontal grid lines at fixed levels in indicator pane
class IndicatorHorzGridPrimitive {
  constructor() {
    this._levels = [-3, -2, -1, 1, 2, 3]  // No 0, only state levels
    this._chart = null
    this._series = null
  }

  setLevels(levels) {
    this._levels = levels || [-3, -2, -1, 1, 2, 3]
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
    return [new IndicatorHorzGridPaneView(this)]
  }
}

class IndicatorHorzGridPaneView {
  constructor(source) {
    this._source = source
  }

  update() {}

  renderer() {
    return new IndicatorHorzGridRenderer(this._source)
  }

  zOrder() {
    return 'bottom'
  }
}

class IndicatorHorzGridRenderer {
  constructor(source) {
    this._source = source
  }

  draw(target, priceConverter) {
    const levels = this._source._levels
    const chart = this._source._chart
    const series = this._source._series

    if (!levels.length || !chart || !series) return

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

function calculateSMA(data, period) {
  const result = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else {
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += data[i - j]
      }
      result.push(sum / period)
    }
  }
  return result
}

function calculateEMA(data, period) {
  const result = []
  const multiplier = 2 / (period + 1)
  let ema = null

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else if (i === period - 1) {
      // First EMA is SMA
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += data[i - j]
      }
      ema = sum / period
      result.push(ema)
    } else {
      ema = (data[i] - ema) * multiplier + ema
      result.push(ema)
    }
  }
  return result
}

const STORAGE_PREFIX = 'RenkoDiscovery_'

function ChartArea({ chartData, renkoData = null, chartType = 'raw', isLoading, activeInstrument, pricePrecision = 5, maSettings = null, compressionFactor = 1.0, showIndicatorPane = false, brickSize = 0.001, reversalSize = 0.002, renkoPerBrickSizes = null, renkoPerReversalSizes = null, sessionSchedule = null }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const indicatorPaneHeightRef = useRef(
    parseInt(localStorage.getItem(`${STORAGE_PREFIX}indicatorPaneHeight`), 10) || 120
  )
  const seriesRef = useRef(null)  // Candlestick series for OHLC data
  const tickLineSeriesRef = useRef(null)  // Line series for tick data
  const primitiveRef = useRef(null)
  const datetimesRef = useRef([])
  const ma1SeriesRef = useRef(null)
  const ma2SeriesRef = useRef(null)
  const ma3SeriesRef = useRef(null)
  const renkoDataRef = useRef(null)
  const indicatorStateSeriesRef = useRef(null)  // Line series for State dots (-3 to +3)
  const typeMarkersPrimitiveRef = useRef(null)  // Custom primitive for Type1/Type2 text markers
  const dayBoundaryPrimitiveRef = useRef(null)  // Day boundary vertical lines on main chart
  const indicatorDayBoundaryPrimitiveRef = useRef(null)  // Day boundary vertical lines on indicator pane
  const indicatorHorzGridPrimitiveRef = useRef(null)  // Horizontal grid lines on indicator pane
  const isTickDataRef = useRef(false)
  const [hoveredBarIndex, setHoveredBarIndex] = useState(null)  // Renko bar index
  const [hoveredM1Index, setHoveredM1Index] = useState(null)    // M1/raw bar index

  // Keep renkoDataRef in sync with renkoData prop
  useEffect(() => {
    renkoDataRef.current = renkoData
  }, [renkoData])

  // Keep chartData ref for overlay mode timestamp mapping
  const chartDataRef = useRef(null)
  useEffect(() => {
    chartDataRef.current = chartData
  }, [chartData])

  // Create chart on mount or when chartType changes
  useEffect(() => {
    if (!containerRef.current) return

    const label = chartType === 'renko' ? 'Brick' : 'Bar'

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: 'solid', color: '#09090b' },
        textColor: '#a1a1aa',
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: '#27272a', visible: false },  // Use custom session boundary lines instead
        horzLines: { color: '#27272a', visible: chartType !== 'renko' },  // Disable in Renko mode for indicator pane
      },
      crosshair: {
        mode: 0, // Normal crosshair
        vertLine: {
          color: '#71717a',
          width: 1,
          style: 2,
          labelBackgroundColor: '#27272a',
        },
        horzLine: {
          color: '#71717a',
          width: 1,
          style: 2,
          labelBackgroundColor: '#27272a',
        },
      },
      rightPriceScale: {
        borderColor: '#27272a',
        scaleMargins: {
          top: 0.1,
          bottom: 0.1,
        },
      },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: chartType !== 'renko',  // Enable native time for Raw and overlay
        secondsVisible: false,
        barSpacing: 6 * compressionFactor,
        minBarSpacing: Math.min(0.5, 6 * compressionFactor),  // Dynamic: lower only when compression requires it
        // Custom formatter for Renko mode and tick data (both use index-based time)
        tickMarkFormatter: (time, tickMarkType, locale) => {
          if (chartType === 'renko' || isTickDataRef.current) {
            const dt = datetimesRef.current[time]
            return dt ? formatTickMark(dt) : String(time)
          }
          // Timestamp-based data: format Unix timestamp as UTC
          const date = new Date(time * 1000)
          const month = String(date.getUTCMonth() + 1).padStart(2, '0')
          const day = String(date.getUTCDate()).padStart(2, '0')
          return `${month}-${day}`
        },
      },
      localization: {
        // Custom time formatter for Renko mode and tick data
        timeFormatter: (time) => {
          if (chartType === 'renko' || isTickDataRef.current) {
            const dt = datetimesRef.current[time]
            return dt ? formatTimestamp(dt) : `${label} ${time}`
          }
          // Timestamp-based data: format Unix timestamp as UTC
          const date = new Date(time * 1000)
          const year = date.getUTCFullYear()
          const month = String(date.getUTCMonth() + 1).padStart(2, '0')
          const day = String(date.getUTCDate()).padStart(2, '0')
          const hours = String(date.getUTCHours()).padStart(2, '0')
          const minutes = String(date.getUTCMinutes()).padStart(2, '0')
          return `${year}-${month}-${day} ${hours}:${minutes}`
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    })

    chartRef.current = chart

    // Add candlestick series using v5 API
    // For overlay mode, use semi-transparent colors
    const isOverlay = chartType === 'overlay'
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: isOverlay ? 'rgba(255, 255, 255, 0.5)' : '#ffffff',
      downColor: isOverlay ? 'rgba(136, 136, 136, 0.5)' : '#888888',
      borderUpColor: isOverlay ? 'rgba(255, 255, 255, 0.7)' : '#ffffff',
      borderDownColor: isOverlay ? 'rgba(136, 136, 136, 0.7)' : '#888888',
      wickUpColor: isOverlay ? 'rgba(255, 255, 255, 0.7)' : '#ffffff',
      wickDownColor: isOverlay ? 'rgba(136, 136, 136, 0.7)' : '#888888',
      lastValueVisible: false,
      priceLineVisible: false,
      visible: true,  // Will be hidden for tick data
    })

    seriesRef.current = candleSeries

    // Add line series for tick data (white line)
    const tickLineSeries = chart.addSeries(LineSeries, {
      color: '#ffffff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      visible: false,  // Will be shown for tick data
    })

    tickLineSeriesRef.current = tickLineSeries

    // Create Renko primitive for overlay mode
    if (isOverlay) {
      const primitive = new RenkoBricksPrimitive()
      candleSeries.attachPrimitive(primitive)
      primitiveRef.current = primitive
    }

    // Create session boundary primitive for all chart types
    {
      const useTimestamps = chartType !== 'renko'
      const dayBoundaryPrimitive = new DayBoundaryGridPrimitive(useTimestamps)
      candleSeries.attachPrimitive(dayBoundaryPrimitive)
      dayBoundaryPrimitiveRef.current = dayBoundaryPrimitive
    }

    // Handle resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        const rect = containerRef.current.getBoundingClientRect()
        chartRef.current.resize(rect.width, rect.height)
      }
    }

    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(containerRef.current)

    // Subscribe to crosshair move to track hovered bar indices
    chart.subscribeCrosshairMove((param) => {
      if (!param.point) {
        setHoveredBarIndex(null)
        setHoveredM1Index(null)
        return
      }

      // Get logical index from x coordinate
      const logicalIndex = chart.timeScale().coordinateToLogical(param.point.x)
      if (logicalIndex === null) {
        setHoveredBarIndex(null)
        setHoveredM1Index(null)
        return
      }

      // For raw mode, track M1 bar index directly
      if (chartType === 'raw') {
        const roundedIndex = Math.round(logicalIndex)
        const maxIndex = (chartDataRef.current?.data?.close?.length || 1) - 1
        setHoveredM1Index(roundedIndex >= 0 && roundedIndex <= maxIndex ? roundedIndex : null)
        setHoveredBarIndex(null)
        return
      }

      // For renko mode, the index directly maps to renko bar index
      if (chartType === 'renko') {
        const roundedIndex = Math.round(logicalIndex)
        setHoveredBarIndex(roundedIndex >= 0 ? roundedIndex : null)
        setHoveredM1Index(null)
        return
      }

      // For overlay mode, track both M1 and renko indices
      if (chartType === 'overlay' && renkoDataRef.current?.data && chartDataRef.current?.data) {
        const tickOpens = renkoDataRef.current.data.tick_index_open
        const tickCloses = renkoDataRef.current.data.tick_index_close
        const m1Datetimes = chartDataRef.current.data.datetime

        if (tickOpens && tickCloses && m1Datetimes) {
          // param.time is the timestamp at the crosshair
          const hoverTime = param.time
          if (hoverTime) {
            // Find the M1 bar index that matches this timestamp
            let m1Index = -1
            for (let i = 0; i < m1Datetimes.length; i++) {
              const barTimestamp = Math.floor(parseUTC(m1Datetimes[i]).getTime() / 1000)
              if (barTimestamp === hoverTime) {
                m1Index = i
                break
              }
              // If we've passed the hover time, use the previous bar
              if (barTimestamp > hoverTime && i > 0) {
                m1Index = i - 1
                break
              }
            }

            if (m1Index >= 0) {
              setHoveredM1Index(m1Index)
              // Find brick where m1Index falls between tick_open and tick_close
              for (let i = tickOpens.length - 1; i >= 0; i--) {
                if (m1Index >= tickOpens[i] && m1Index <= tickCloses[i]) {
                  setHoveredBarIndex(i)
                  return
                }
              }
            }
          }
        }
      }

      setHoveredBarIndex(null)
      setHoveredM1Index(null)
    })

    // Persist indicator pane height on resize via drag
    const handlePointerUp = () => {
      const c = chartRef.current
      if (!c) return
      const panes = c.panes()
      if (panes && panes[1]) {
        const h = panes[1].getHeight()
        if (h && h !== indicatorPaneHeightRef.current) {
          indicatorPaneHeightRef.current = h
          localStorage.setItem(`${STORAGE_PREFIX}indicatorPaneHeight`, h.toString())
        }
      }
    }
    containerRef.current.addEventListener('pointerup', handlePointerUp)
    const containerEl = containerRef.current

    return () => {
      containerEl.removeEventListener('pointerup', handlePointerUp)
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      tickLineSeriesRef.current = null
      primitiveRef.current = null
      ma1SeriesRef.current = null
      ma2SeriesRef.current = null
      ma3SeriesRef.current = null
      indicatorStateSeriesRef.current = null
      typeMarkersPrimitiveRef.current = null
      dayBoundaryPrimitiveRef.current = null
      indicatorDayBoundaryPrimitiveRef.current = null
      indicatorHorzGridPrimitiveRef.current = null
    }
  }, [chartType])

  // Update barSpacing when compressionFactor changes (without recreating chart)
  useEffect(() => {
    if (!chartRef.current) return
    const calculatedSpacing = 6 * compressionFactor
    chartRef.current.timeScale().applyOptions({
      barSpacing: calculatedSpacing,
      minBarSpacing: Math.min(0.5, calculatedSpacing),  // Dynamic: lower only when compression requires it
    })
  }, [compressionFactor])

  // Update data when chartData or chartType changes
  useEffect(() => {
    if (!seriesRef.current || !chartData?.data) return

    const { open, high, low, close, datetime } = chartData.data

    // Store datetime array for formatter access
    datetimesRef.current = datetime || []

    // Check if this is tick data (has sub-second timestamps or is_tick_data flag)
    const isTickData = chartData.is_tick_data || false
    isTickDataRef.current = isTickData

    // Apply price precision from user setting
    const priceFormatOptions = {
      priceFormat: {
        type: 'price',
        precision: pricePrecision,
        minMove: Math.pow(10, -pricePrecision),
      },
    }
    seriesRef.current.applyOptions(priceFormatOptions)
    if (tickLineSeriesRef.current) {
      tickLineSeriesRef.current.applyOptions(priceFormatOptions)
    }

    // Update timeScale for tick data (use index-based axis like renko mode)
    if (chartRef.current) {
      chartRef.current.timeScale().applyOptions({
        timeVisible: !isTickData && chartType !== 'renko',
      })
    }

    // Toggle visibility based on tick data
    if (isTickData) {
      // Hide candlestick, show line for tick data
      seriesRef.current.applyOptions({ visible: false })
      if (tickLineSeriesRef.current) {
        tickLineSeriesRef.current.applyOptions({ visible: true })
      }
    } else {
      // Show candlestick, hide line for OHLC data
      seriesRef.current.applyOptions({ visible: true })
      if (tickLineSeriesRef.current) {
        tickLineSeriesRef.current.applyOptions({ visible: false })
      }
    }

    // Build data arrays
    if (isTickData) {
      // For tick data, use line series with mid price (close)
      const lineData = close.map((price, i) => ({ time: i, value: price }))
      if (tickLineSeriesRef.current) {
        tickLineSeriesRef.current.setData(lineData)
      }
      // For overlay mode, keep candlestick data (hidden) for primitive price scaling
      if (chartType === 'overlay') {
        const candleData = open.map((_, i) => ({
          time: i,
          open: open[i],
          high: high[i],
          low: low[i],
          close: close[i]
        }))
        seriesRef.current.setData(candleData)
      } else {
        seriesRef.current.setData([])
      }
    } else {
      // For OHLC data, use candlestick series
      const candleData = open.map((_, i) => {
        if (chartType !== 'renko' && datetime[i]) {
          // Convert to Unix timestamp (seconds) for lightweight-charts
          const timestamp = Math.floor(parseUTC(datetime[i]).getTime() / 1000)
          return { time: timestamp, open: open[i], high: high[i], low: low[i], close: close[i] }
        }
        // Use sequential indices for Renko mode
        return { time: i, open: open[i], high: high[i], low: low[i], close: close[i] }
      })
      seriesRef.current.setData(candleData)
      // Clear line series
      if (tickLineSeriesRef.current) {
        tickLineSeriesRef.current.setData([])
      }
    }

    // Fit content and show last 200 bars/bricks
    if (chartRef.current && close.length > 0) {
      const visibleBars = Math.min(200, close.length)
      const fromIndex = close.length - visibleBars
      const toIndex = close.length - 1

      // For tick data, use indices; for OHLC with timestamps, calculate time range
      if (isTickData || chartType === 'renko') {
        chartRef.current.timeScale().setVisibleRange({
          from: fromIndex,
          to: toIndex,
        })
      } else if (datetime[fromIndex] && datetime[toIndex]) {
        chartRef.current.timeScale().setVisibleRange({
          from: Math.floor(parseUTC(datetime[fromIndex]).getTime() / 1000),
          to: Math.floor(parseUTC(datetime[toIndex]).getTime() / 1000),
        })
      }
    }

    // Update session boundary lines for all modes
    if (dayBoundaryPrimitiveRef.current && datetime && sessionSchedule) {
      if (chartType === 'renko') {
        const boundaries = findSessionBoundaryIndices(datetime, sessionSchedule)
        dayBoundaryPrimitiveRef.current.setBoundaries(boundaries)
      } else {
        const boundaries = findSessionBoundaryTimestamps(datetime, sessionSchedule)
        dayBoundaryPrimitiveRef.current.setBoundaries(boundaries)
      }
    }
  }, [chartData, chartType, pricePrecision, sessionSchedule])

  // Update Renko overlay when renkoData changes
  useEffect(() => {
    if (!primitiveRef.current || !renkoData?.data || chartType !== 'overlay') return

    const { tick_index_open, tick_index_close, open, high, low, close } = renkoData.data
    const pendingBrick = renkoData.pending_brick

    // If tick indices are not available, we can't draw spanning bricks
    if (!tick_index_open || !tick_index_close) {
      primitiveRef.current.setBricks([])
      return
    }

    // Build brick data for the primitive
    // tick indices now directly correspond to chart indices (backend calculates on same limited data)
    const bricks = open.map((_, i) => ({
      tickOpen: tick_index_open[i],
      tickClose: tick_index_close[i],
      priceOpen: open[i],
      priceHigh: high[i],
      priceLow: low[i],
      priceClose: close[i],
      isUp: close[i] > open[i],
    }))

    primitiveRef.current.setBricks(bricks)

    // Force redraw
    if (chartRef.current) {
      chartRef.current.timeScale().applyOptions({})
    }
  }, [renkoData, chartType])

  // Update MA series when data or settings change
  useEffect(() => {
    if (!chartRef.current || !seriesRef.current) return

    const chart = chartRef.current

    // Get the appropriate data source based on chart type
    // - M1 mode: chartData contains M1 data
    // - Renko mode: chartData contains renko data (passed as chartData prop)
    // - Overlay mode: use renkoData for MAs (based on renko bars, not M1)
    const dataSource = chartType === 'overlay' ? renkoData : chartData
    if (!dataSource?.data?.close) return

    // For overlay mode, we also need chartData for timestamp mapping
    if (chartType === 'overlay' && !chartData?.data?.datetime) return

    const { close } = dataSource.data

    // Helper to create/update MA series using v5 API
    const updateMASeries = (maSeriesRef, maConfig) => {
      // Remove existing series if disabled
      if (!maConfig.enabled) {
        if (maSeriesRef.current) {
          chart.removeSeries(maSeriesRef.current)
          maSeriesRef.current = null
        }
        return
      }

      // Calculate MA values
      const maValues = maConfig.type === 'ema'
        ? calculateEMA(close, maConfig.period)
        : calculateSMA(close, maConfig.period)

      // Create series if it doesn't exist (v5 API)
      if (!maSeriesRef.current) {
        maSeriesRef.current = chart.addSeries(LineSeries, {
          color: maConfig.color,
          lineWidth: maConfig.lineWidth,
          lineStyle: maConfig.lineStyle,
          priceLineVisible: false,
          lastValueVisible: false,
          crosshairMarkerVisible: false,
        })
      } else {
        maSeriesRef.current.applyOptions({
          color: maConfig.color,
          lineWidth: maConfig.lineWidth,
          lineStyle: maConfig.lineStyle,
        })
      }

      // Check if this is tick data
      const isTickData = chartData?.is_tick_data || false

      // Build MA data with proper time values
      let maData = maValues
        .map((value, i) => {
          if (value === null) return null

          if (chartType === 'raw') {
            if (isTickData) {
              // Tick data uses sequential indices
              return { time: i, value }
            }
            // M1 mode: use timestamps from M1 data
            const dt = dataSource.data.datetime[i]
            if (dt) {
              return { time: Math.floor(parseUTC(dt).getTime() / 1000), value }
            }
            return null
          } else if (chartType === 'overlay') {
            // Overlay mode: MA is based on renko bars, map to data indices via tick_index_close
            const dataIndex = dataSource.data.tick_index_close[i]
            if (dataIndex === undefined || dataIndex === null) return null

            if (isTickData) {
              // Tick data uses sequential indices
              return { time: dataIndex, value }
            }
            // M1 data uses timestamps
            const m1Datetime = chartData.data.datetime[dataIndex]
            if (m1Datetime) {
              return { time: Math.floor(parseUTC(m1Datetime).getTime() / 1000), value }
            }
            return null
          } else {
            // Renko mode: use sequential index
            return { time: i, value }
          }
        })
        .filter(d => d !== null)

      // Deduplicate time values (multiple renko bricks can close on same bar/tick)
      // Keep only the last value for each time
      if (chartType === 'overlay' || (chartType === 'raw' && !isTickData)) {
        const seenTimes = new Map()
        for (const d of maData) {
          seenTimes.set(d.time, d.value)
        }
        maData = Array.from(seenTimes, ([time, value]) => ({ time, value }))
          .sort((a, b) => a.time - b.time)
      }

      maSeriesRef.current.setData(maData)
    }

    if (maSettings) {
      updateMASeries(ma1SeriesRef, maSettings.ma1)
      updateMASeries(ma2SeriesRef, maSettings.ma2)
      updateMASeries(ma3SeriesRef, maSettings.ma3)
    }
  }, [chartData, renkoData, chartType, maSettings])

  // State & Type Indicator Pane (Renko mode only)
  useEffect(() => {
    if (!chartRef.current) return

    const chart = chartRef.current

    // Helper to remove indicator series and primitives
    const removeIndicatorSeries = () => {
      if (indicatorStateSeriesRef.current) {
        chart.removeSeries(indicatorStateSeriesRef.current)
        indicatorStateSeriesRef.current = null
        typeMarkersPrimitiveRef.current = null
        indicatorHorzGridPrimitiveRef.current = null
        indicatorDayBoundaryPrimitiveRef.current = null
      }
    }

    // Only show indicator pane in Renko mode when enabled
    if (chartType !== 'renko' || !showIndicatorPane) {
      removeIndicatorSeries()
      return
    }

    // Need chartData (which is renkoData in renko mode) and maSettings
    if (!chartData?.data?.close || !maSettings) return

    const { open, high, low, close } = chartData.data
    const round = (v, d) => { const m = Math.pow(10, d); return Math.round(v * m) / m }

    // Calculate MA values (Fast=MA1, Med=MA2, Slow=MA3)
    const ma1Enabled = maSettings.ma1?.enabled
    const ma2Enabled = maSettings.ma2?.enabled
    const ma3Enabled = maSettings.ma3?.enabled

    // Need all 3 MAs enabled for State calculation
    if (!ma1Enabled || !ma2Enabled || !ma3Enabled) {
      removeIndicatorSeries()
      return
    }

    const ma1Values = maSettings.ma1.type === 'ema'
      ? calculateEMA(close, maSettings.ma1.period)
      : calculateSMA(close, maSettings.ma1.period)
    const ma2Values = maSettings.ma2.type === 'ema'
      ? calculateEMA(close, maSettings.ma2.period)
      : calculateSMA(close, maSettings.ma2.period)
    const ma3Values = maSettings.ma3.type === 'ema'
      ? calculateEMA(close, maSettings.ma3.period)
      : calculateSMA(close, maSettings.ma3.period)

    // Calculate State for each bar based on MA ordering
    // Fast=MA1, Med=MA2, Slow=MA3
    // +3: Fast > Med > Slow  (full bullish alignment)
    // +2: Fast > Slow > Med
    // +1: Slow > Fast > Med
    // -1: Med > Fast > Slow
    // -2: Med > Slow > Fast
    // -3: Slow > Med > Fast  (full bearish alignment)
    const stateData = []
    const typeMarkers = []

    for (let i = 0; i < close.length; i++) {
      const fast = ma1Values[i]
      const med = ma2Values[i]
      const slow = ma3Values[i]

      if (fast === null || med === null || slow === null) continue

      let state = 0
      if (fast > med && med > slow) state = 3       // Fast > Med > Slow
      else if (fast > slow && slow > med) state = 2 // Fast > Slow > Med
      else if (slow > fast && fast > med) state = 1 // Slow > Fast > Med
      else if (med > fast && fast > slow) state = -1 // Med > Fast > Slow
      else if (med > slow && slow > fast) state = -2 // Med > Slow > Fast
      else if (slow > med && med > fast) state = -3 // Slow > Med > Fast

      stateData.push({ time: i, value: state })

      // Current bar direction
      const isUp = close[i] > open[i]
      const isDown = close[i] < open[i]

      // Type1 Logic (displayed as "1" at ±5) - always 3-bar pattern
      const use3bar = renkoPerReversalSizes && renkoPerBrickSizes
        ? renkoPerReversalSizes[i] > renkoPerBrickSizes[i]
        : reversalSize > brickSize

      if (i > 1) {
        const priorIsUp = close[i - 1] > open[i - 1]
        const priorIsDown = close[i - 1] < open[i - 1]
        const prior2IsUp = close[i - 2] > open[i - 2]
        const prior2IsDown = close[i - 2] < open[i - 2]

        // Long T1: DOWN -> UP -> UP in state +3
        if (state === 3 && isUp && priorIsUp && prior2IsDown) {
          typeMarkers.push({ time: i, value: -5, text: '1', color: '#10b981' })
        }
        // Short T1: UP -> DOWN -> DOWN in state -3
        if (state === -3 && isDown && priorIsDown && prior2IsUp) {
          typeMarkers.push({ time: i, value: 5, text: '1', color: '#f43f5e' })
        }
      }

      // Type2 Logic (displayed as "2" at ±4) - only when reversal > brick
      // Wick must exceed brick_size
      if (use3bar) {
        const brickSizeAtI = renkoPerBrickSizes ? renkoPerBrickSizes[i] : brickSize
        const priorIsUpT2 = i > 0 ? close[i - 1] > open[i - 1] : false
        if (state === 3 && isUp && round(open[i] - low[i], pricePrecision) > brickSizeAtI) {
          if (priorIsUpT2) {
            typeMarkers.push({ time: i, value: -4, text: '2', color: '#10b981' })
          }
        }
        if (state === -3 && isDown && round(high[i] - open[i], pricePrecision) > brickSizeAtI) {
          if (!priorIsUpT2) {  // prior must be DOWN
            typeMarkers.push({ time: i, value: 4, text: '2', color: '#f43f5e' })
          }
        }
      }
    }

    // Common autoscale provider for fixed -6 to +6 range
    const autoscaleProvider = () => ({
      priceRange: {
        minValue: -6,
        maxValue: 6,
      },
    })

    // Create State series (dots at -3 to +3)
    if (!indicatorStateSeriesRef.current) {
      indicatorStateSeriesRef.current = chart.addSeries(LineSeries, {
        color: '#71717a',
        lineWidth: 0,
        pointMarkersVisible: true,
        pointMarkersRadius: 3,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: autoscaleProvider,
      }, 1)

      // Attach custom primitive for Type markers
      const typeMarkerPrimitive = new TypeMarkersPrimitive()
      indicatorStateSeriesRef.current.attachPrimitive(typeMarkerPrimitive)
      typeMarkersPrimitiveRef.current = typeMarkerPrimitive

      // Attach horizontal grid lines at fixed state levels (-3 to +3)
      const horzGridPrimitive = new IndicatorHorzGridPrimitive()
      indicatorStateSeriesRef.current.attachPrimitive(horzGridPrimitive)
      indicatorHorzGridPrimitiveRef.current = horzGridPrimitive

      // Attach day boundary vertical lines
      const dayBoundaryPrimitive = new DayBoundaryGridPrimitive()
      indicatorStateSeriesRef.current.attachPrimitive(dayBoundaryPrimitive)
      indicatorDayBoundaryPrimitiveRef.current = dayBoundaryPrimitive

      // Set pane height after series is created
      const panes = chart.panes()
      if (panes && panes[1]) {
        panes[1].setHeight(indicatorPaneHeightRef.current)
      }
    }

    // Set State data
    indicatorStateSeriesRef.current.setData(stateData)

    // Set Type markers via primitive
    if (typeMarkersPrimitiveRef.current) {
      typeMarkersPrimitiveRef.current.setMarkers(typeMarkers)
    }

    // Update session boundary lines in indicator pane
    if (indicatorDayBoundaryPrimitiveRef.current && chartData.data.datetime && sessionSchedule) {
      const boundaries = findSessionBoundaryIndices(chartData.data.datetime, sessionSchedule)
      indicatorDayBoundaryPrimitiveRef.current.setBoundaries(boundaries)
    }

    // Force redraw
    chart.timeScale().applyOptions({})

  }, [chartData, chartType, showIndicatorPane, maSettings, sessionSchedule])

  if (!chartData && !isLoading) {
    return (
      <div ref={containerRef} className="chart-container">
        <div className="chart-area empty">
          <div className="empty-state">
            <div className="empty-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M3 3v18h18" />
                <path d="M7 16l4-8 4 4 6-8" />
              </svg>
            </div>
            <h3>No Data Loaded</h3>
            <p>Select files from the Data tab and process them to display a chart.</p>
            <div className="empty-steps">
              <div className="step">
                <span className="step-num">1</span>
                <span>Select source files</span>
              </div>
              <div className="step">
                <span className="step-num">2</span>
                <span>Click "Process" to create cache</span>
              </div>
              <div className="step">
                <span className="step-num">3</span>
                <span>Click a cached instrument to view chart</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div ref={containerRef} className="chart-container">
        <div className="chart-area loading">
          <div className="loading-state">
            <div className="loading-spinner">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            </div>
            <p>Loading {activeInstrument}...</p>
          </div>
        </div>
      </div>
    )
  }

  // Get the renko data source for DataWindow (either passed directly or when chartData is renko)
  const renkoDataForWindow = renkoData || (chartType === 'renko' ? chartData : null)
  // Show data window in all modes when we have chart data
  const showDataWindow = chartData?.data

  return (
    <div ref={containerRef} className="chart-container">
      {showDataWindow && (
        <DataWindow
          chartData={chartData}
          renkoData={renkoDataForWindow}
          chartType={chartType}
          hoveredBarIndex={hoveredBarIndex}
          hoveredM1Index={hoveredM1Index}
          pricePrecision={pricePrecision}
        />
      )}
    </div>
  )
}

export default ChartArea
