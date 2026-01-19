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

function ChartArea({ chartData, chartType = 'm1', isLoading, activeInstrument, pricePrecision = 5 }) {
  const containerRef = useRef(null)
  const chartRef = useRef(null)
  const seriesRef = useRef(null)
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
        timeVisible: false,
        // Custom formatter to show timestamps
        tickMarkFormatter: (index) => {
          const dt = datetimesRef.current[index]
          return dt ? formatTickMark(dt) : String(index)
        },
      },
      localization: {
        timeFormatter: (index) => {
          const dt = datetimesRef.current[index]
          return dt ? formatTimestamp(dt) : `${label} ${index}`
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

    // Add candlestick series
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderUpColor: '#22c55e',
      borderDownColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
    })

    seriesRef.current = candleSeries

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

    // Transform data using sequential index as "time"
    const data = open.map((_, i) => ({
      time: i,
      open: open[i],
      high: high[i],
      low: low[i],
      close: close[i],
    }))

    seriesRef.current.setData(data)

    // Fit content and show last 200 bars/bricks
    if (chartRef.current && data.length > 0) {
      const visibleBars = Math.min(200, data.length)
      chartRef.current.timeScale().setVisibleRange({
        from: data.length - visibleBars,
        to: data.length - 1,
      })
    }
  }, [chartData, chartType, pricePrecision])

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
