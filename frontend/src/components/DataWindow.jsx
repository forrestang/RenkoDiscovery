function DataWindow({ chartData, renkoData, chartType, hoveredBarIndex, hoveredM1Index, pricePrecision = 5, wickErrorPct = null }) {
  // Need at least chartData to display anything
  if (!chartData?.data) return null

  const { open: m1Open, high: m1High, low: m1Low, close: m1Close, datetime: m1Datetime } = chartData.data

  // Get M1 bar data (for raw and overlay modes)
  const m1Index = hoveredM1Index !== null && hoveredM1Index >= 0 && hoveredM1Index < m1Close?.length
    ? hoveredM1Index
    : (m1Close?.length - 1) || 0

  const m1Timestamp = m1Datetime?.[m1Index]
  const m1O = m1Open?.[m1Index]
  const m1H = m1High?.[m1Index]
  const m1L = m1Low?.[m1Index]
  const m1C = m1Close?.[m1Index]

  // Get renko data (for renko and overlay modes)
  const renkoDataSource = renkoData?.data
  const renkoIndex = hoveredBarIndex !== null && hoveredBarIndex >= 0 && renkoDataSource?.close && hoveredBarIndex < renkoDataSource.close.length
    ? hoveredBarIndex
    : (renkoDataSource?.close?.length - 1) || 0

  const renkoO = renkoDataSource?.open?.[renkoIndex]
  const renkoH = renkoDataSource?.high?.[renkoIndex]
  const renkoL = renkoDataSource?.low?.[renkoIndex]
  const renkoC = renkoDataSource?.close?.[renkoIndex]
  const renkoDatetime = renkoDataSource?.datetime?.[renkoIndex]

  // Format timestamp for display
  const formatTimestamp = (isoString) => {
    if (!isoString) return '--'
    const date = new Date(isoString)
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day} ${hours}:${minutes}`
  }

  const formatPrice = (value) => {
    if (value === undefined || value === null) return '--'
    return value.toFixed(pricePrecision)
  }

  return (
    <div className="data-window">
      {/* Timestamp - show M1 time in raw/overlay, renko time in renko mode */}
      <div className="data-row">
        <span className="data-label">Time</span>
        <span className="data-value mono">
          {chartType === 'renko' ? formatTimestamp(renkoDatetime) : formatTimestamp(m1Timestamp)}
        </span>
      </div>

      {/* Raw/M1 bar OHLC - show in raw and overlay modes */}
      {(chartType === 'raw' || chartType === 'overlay') && (
        <>
          <div className="data-section-header">M1 Bar</div>
          <div className="data-row">
            <span className="data-label">O</span>
            <span className="data-value mono">{formatPrice(m1O)}</span>
          </div>
          <div className="data-row">
            <span className="data-label">H</span>
            <span className="data-value mono">{formatPrice(m1H)}</span>
          </div>
          <div className="data-row">
            <span className="data-label">L</span>
            <span className="data-value mono">{formatPrice(m1L)}</span>
          </div>
          <div className="data-row">
            <span className="data-label">C</span>
            <span className="data-value mono">{formatPrice(m1C)}</span>
          </div>
        </>
      )}

      {/* Renko bar OHLC - show in renko and overlay modes */}
      {(chartType === 'renko' || chartType === 'overlay') && renkoDataSource && (
        <>
          <div className="data-section-header">Renko</div>
          <div className="data-row">
            <span className="data-label">O</span>
            <span className="data-value mono">{formatPrice(renkoO)}</span>
          </div>
          <div className="data-row">
            <span className="data-label">H</span>
            <span className="data-value mono">{formatPrice(renkoH)}</span>
          </div>
          <div className="data-row">
            <span className="data-label">L</span>
            <span className="data-value mono">{formatPrice(renkoL)}</span>
          </div>
          <div className="data-row">
            <span className="data-label">C</span>
            <span className="data-value mono">{formatPrice(renkoC)}</span>
          </div>
          {renkoData?.adr_period && renkoDataSource?.adr_value && (
            <>
              <div className="data-row">
                <span className="data-label">ADR({renkoData.adr_period})</span>
                <span className="data-value mono">{formatPrice(renkoDataSource.adr_value?.[renkoIndex])}</span>
              </div>
              <div className="data-row">
                <span className="data-label">Brick</span>
                <span className="data-value mono">{formatPrice(renkoDataSource.brick_size?.[renkoIndex])}</span>
              </div>
              <div className="data-row">
                <span className="data-label">Rev</span>
                <span className="data-value mono">{formatPrice(renkoDataSource.reversal_size?.[renkoIndex])}</span>
              </div>
            </>
          )}
          {wickErrorPct !== null && (
            <div className="data-row">
              <span className="data-label">Error</span>
              <span className="data-value mono">~{wickErrorPct}%</span>
            </div>
          )}
          {renkoDataSource?.close?.length > 0 && (
            <div className="data-row">
              <span className="data-label">barCount</span>
              <span className="data-value mono">{renkoDataSource.close.length.toLocaleString()}</span>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default DataWindow
