import { useRef, useEffect, useState } from 'react'
import { createChart } from 'lightweight-charts'
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

        // Draw brick body (filled rectangle)
        ctx.fillStyle = fillColor
        ctx.fillRect(left, bTop, width, height)

        // Draw brick border
        ctx.strokeStyle = strokeColor
        ctx.lineWidth = 1.5 * hRatio
        ctx.setLineDash(isPending ? [4 * hRatio, 4 * hRatio] : [])
        ctx.strokeRect(left, bTop, width, height)
      }
      ctx.setLineDash([])
    })
  }
}

function ChartArea({ chartData, renkoData = null, chartType = 'm1', isLoading, activeInstrument, pricePrecision = 5 }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
  const primitiveRef = useRef(null)
  const datetimesRef = useRef([])

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
        timeVisible: chartType === 'm1',  // Enable native time for M1
        secondsVisible: false,
        // Only use custom formatter for non-M1 modes (Renko uses index-based time)
        ...(chartType !== 'm1' && {
          tickMarkFormatter: (index) => {
            const dt = datetimesRef.current[index]
            return dt ? formatTickMark(dt) : String(index)
          },
        }),
      },
      localization: {
        // Only use custom time formatter for non-M1 modes (M1 uses native timestamp display)
        ...(chartType !== 'm1' && {
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

    // Add candlestick series
    // For overlay mode, use semi-transparent colors
    const isOverlay = chartType === 'overlay'
    const candleSeries = chart.addCandlestickSeries({
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

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
      primitiveRef.current = null
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

    // For M1, use actual timestamps; for Renko/overlay, use sequential indices
    const data = open.map((_, i) => {
      if (chartType === 'm1' && datetime[i]) {
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
      // Use actual time values from data (timestamps for M1, indices for Renko/overlay)
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
                <span>Click "Process" to create parquet</span>
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

  return <div ref={containerRef} className="chart-container" />
}

export default ChartArea
