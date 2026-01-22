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

function ChartArea({ chartData, renkoData = null, chartType = 'm1', isLoading, activeInstrument, pricePrecision = 5, maSettings = null, renkoSettings = null }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const primitiveRef = useRef(null)
  const datetimesRef = useRef([])
  const ma1SeriesRef = useRef(null)
  const ma2SeriesRef = useRef(null)
  const ma3SeriesRef = useRef(null)
  const renkoDataRef = useRef(null)
  const [hoveredBarIndex, setHoveredBarIndex] = useState(null)

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
        vertLines: { color: '#27272a' },
        horzLines: { color: '#27272a' },
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
        timeVisible: chartType !== 'renko',  // Enable native time for M1 and overlay
        secondsVisible: false,
        // Only use custom formatter for Renko mode (uses index-based time)
        ...(chartType === 'renko' && {
          tickMarkFormatter: (index) => {
            const dt = datetimesRef.current[index]
            return dt ? formatTickMark(dt) : String(index)
          },
        }),
      },
      localization: {
        // Only use custom time formatter for Renko mode
        ...(chartType === 'renko' && {
          timeFormatter: (index) => {
            const dt = datetimesRef.current[index]
            return dt ? formatTimestamp(dt) : `${label} ${index}`
          },
        }),
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
      upColor: isOverlay ? 'rgba(34, 197, 94, 0.35)' : '#22c55e',
      downColor: isOverlay ? 'rgba(239, 68, 68, 0.35)' : '#ef4444',
      borderUpColor: isOverlay ? 'rgba(34, 197, 94, 0.5)' : '#22c55e',
      borderDownColor: isOverlay ? 'rgba(239, 68, 68, 0.5)' : '#ef4444',
      wickUpColor: isOverlay ? 'rgba(34, 197, 94, 0.5)' : '#22c55e',
      wickDownColor: isOverlay ? 'rgba(239, 68, 68, 0.5)' : '#ef4444',
    })

    seriesRef.current = candleSeries

    // Create Renko primitive for overlay mode
    if (isOverlay) {
      const primitive = new RenkoBricksPrimitive()
      candleSeries.attachPrimitive(primitive)
      primitiveRef.current = primitive
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

    // Subscribe to crosshair move to track which renko bar is hovered
    chart.subscribeCrosshairMove((param) => {
      if (!param.point) {
        setHoveredBarIndex(null)
        return
      }

      // Get logical index from x coordinate
      const logicalIndex = chart.timeScale().coordinateToLogical(param.point.x)
      if (logicalIndex === null) {
        setHoveredBarIndex(null)
        return
      }

      // For renko mode, the index directly maps to bar index
      if (chartType === 'renko') {
        const roundedIndex = Math.round(logicalIndex)
        setHoveredBarIndex(roundedIndex >= 0 ? roundedIndex : null)
        return
      }

      // For overlay mode, find which brick contains this M1 bar
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
              const barTimestamp = Math.floor(new Date(m1Datetimes[i]).getTime() / 1000)
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
    })

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      primitiveRef.current = null
      ma1SeriesRef.current = null
      ma2SeriesRef.current = null
      ma3SeriesRef.current = null
    }
  }, [chartType])

  // Update data when chartData or chartType changes
  useEffect(() => {
    if (!seriesRef.current || !chartData?.data) return

    const { open, high, low, close, datetime } = chartData.data

    // Store datetime array for formatter access
    datetimesRef.current = datetime || []

    // Apply price precision from user setting
    seriesRef.current.applyOptions({
      priceFormat: {
        type: 'price',
        precision: pricePrecision,
        minMove: Math.pow(10, -pricePrecision),
      },
    })

    // For M1 and overlay, use actual timestamps; for Renko, use sequential indices
    const data = open.map((_, i) => {
      if (chartType !== 'renko' && datetime[i]) {
        // Convert to Unix timestamp (seconds) for lightweight-charts
        const timestamp = Math.floor(new Date(datetime[i]).getTime() / 1000)
        return { time: timestamp, open: open[i], high: high[i], low: low[i], close: close[i] }
      }
      return { time: i, open: open[i], high: high[i], low: low[i], close: close[i] }
    })

    seriesRef.current.setData(data)

    // Fit content and show last 200 bars/bricks
    if (chartRef.current && data.length > 0) {
      const visibleBars = Math.min(200, data.length)
      const fromIndex = data.length - visibleBars
      const toIndex = data.length - 1
      // Use actual time values from data (timestamps for M1/overlay, indices for Renko)
      chartRef.current.timeScale().setVisibleRange({
        from: data[fromIndex].time,
        to: data[toIndex].time,
      })
    }
  }, [chartData, chartType, pricePrecision])

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

    // Add the pending brick if it exists
    if (pendingBrick) {
      bricks.push({
        tickOpen: pendingBrick.tick_index_open,
        tickClose: pendingBrick.tick_index_close,
        priceOpen: pendingBrick.open,
        priceClose: pendingBrick.close,
        priceHigh: pendingBrick.high,
        priceLow: pendingBrick.low,
        isUp: pendingBrick.close > pendingBrick.open,
        isPending: true,
      })
    }

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

      // Build MA data with proper time values
      let maData = maValues
        .map((value, i) => {
          if (value === null) return null

          if (chartType === 'm1') {
            // M1 mode: use timestamps from M1 data
            const dt = dataSource.data.datetime[i]
            if (dt) {
              return { time: Math.floor(new Date(dt).getTime() / 1000), value }
            }
            return null
          } else if (chartType === 'overlay') {
            // Overlay mode: MA is based on renko bars, map to M1 timestamps via tick_index_close
            const m1Index = dataSource.data.tick_index_close[i]
            const m1Datetime = chartData.data.datetime[m1Index]
            if (m1Datetime) {
              return { time: Math.floor(new Date(m1Datetime).getTime() / 1000), value }
            }
            return null
          } else {
            // Renko mode: use sequential index
            return { time: i, value }
          }
        })
        .filter(d => d !== null)

      // Deduplicate timestamps (multiple renko bricks can close on same M1 bar)
      // Keep only the last value for each timestamp
      if (chartType === 'overlay' || chartType === 'm1') {
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
  const showDataWindow = (chartType === 'renko' || chartType === 'overlay') &&
    renkoSettings?.brickMethod === 'adr' &&
    renkoDataForWindow?.adr_info

  return (
    <div ref={containerRef} className="chart-container">
      {showDataWindow && (
        <DataWindow
          renkoData={renkoDataForWindow}
          hoveredBarIndex={hoveredBarIndex}
          renkoSettings={renkoSettings}
          pricePrecision={pricePrecision}
          visible={true}
        />
      )}
    </div>
  )
}

export default ChartArea
