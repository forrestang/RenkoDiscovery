function DataWindow({ chartData, renkoData, htfRenkoData = null, chartType, hoveredBarIndex, hoveredM1Index, pricePrecision = 5, wickErrorPct = null }) {
  if (!chartData?.data) return null

  const { open: m1Open, high: m1High, low: m1Low, close: m1Close } = chartData.data

  const m1Index = hoveredM1Index !== null && hoveredM1Index >= 0 && hoveredM1Index < m1Close?.length
    ? hoveredM1Index
    : (m1Close?.length - 1) || 0

  const renkoDataSource = renkoData?.data
  const renkoIndex = hoveredBarIndex !== null && hoveredBarIndex >= 0 && renkoDataSource?.close && hoveredBarIndex < renkoDataSource.close.length
    ? hoveredBarIndex
    : (renkoDataSource?.close?.length - 1) || 0

  const formatPrice = (value) => {
    if (value === undefined || value === null) return '--'
    return value.toFixed(pricePrecision)
  }

  // HTF lookup for O2 mode — default to last brick when cursor is off chart
  let htfIdx = -1
  let htfErrorPct = null
  if (chartType === 'o2' && htfRenkoData && htfRenkoData.open?.length > 0) {
    const ltfTickCloses = chartData?.data?.tick_index_close
    const htfTickOpens = htfRenkoData.tick_index_open
    const htfTickCloses = htfRenkoData.tick_index_close
    if (ltfTickCloses && htfTickOpens && htfTickCloses && renkoIndex < ltfTickCloses.length) {
      const ltfTC = ltfTickCloses[renkoIndex]
      for (let h = 0; h < htfTickOpens.length; h++) {
        if (ltfTC >= htfTickOpens[h] && ltfTC <= htfTickCloses[h]) {
          htfIdx = h
          break
        }
      }
    }
    // Fall back to last HTF brick if lookup didn't match
    if (htfIdx < 0) {
      htfIdx = htfRenkoData.open.length - 1
    }

    if (htfRenkoData.open && htfRenkoData.high && htfRenkoData.low && htfRenkoData.close && htfRenkoData.reversal_size) {
      let errors = 0
      const total = htfRenkoData.open.length
      for (let i = 0; i < total; i++) {
        const isUp = htfRenkoData.close[i] > htfRenkoData.open[i]
        const dd = isUp
          ? htfRenkoData.open[i] - htfRenkoData.low[i]
          : htfRenkoData.high[i] - htfRenkoData.open[i]
        if (dd > htfRenkoData.reversal_size[i]) errors++
      }
      if (total > 0) htfErrorPct = (errors / total * 100).toFixed(1)
    }
  }

  return (
    <div className="data-window">
      {/* LTF row */}
      {(chartType === 'raw' || chartType === 'overlay') && (
        <div className="data-row">
          <span className="data-row-label">LTF</span>
          <span className="data-pair"><span className="data-label">O</span> <span className="data-value mono">{formatPrice(m1Open?.[m1Index])}</span></span>
          <span className="data-pair"><span className="data-label">H</span> <span className="data-value mono">{formatPrice(m1High?.[m1Index])}</span></span>
          <span className="data-pair"><span className="data-label">L</span> <span className="data-value mono">{formatPrice(m1Low?.[m1Index])}</span></span>
          <span className="data-pair"><span className="data-label">C</span> <span className="data-value mono">{formatPrice(m1Close?.[m1Index])}</span></span>
        </div>
      )}

      {(chartType === 'renko' || chartType === 'overlay' || chartType === 'o2') && renkoDataSource && (
        <div className="data-row">
          <span className="data-row-label">LTF</span>
          <span className="data-pair"><span className="data-label">O</span> <span className="data-value mono">{formatPrice(renkoDataSource.open?.[renkoIndex])}</span></span>
          <span className="data-pair"><span className="data-label">H</span> <span className="data-value mono">{formatPrice(renkoDataSource.high?.[renkoIndex])}</span></span>
          <span className="data-pair"><span className="data-label">L</span> <span className="data-value mono">{formatPrice(renkoDataSource.low?.[renkoIndex])}</span></span>
          <span className="data-pair"><span className="data-label">C</span> <span className="data-value mono">{formatPrice(renkoDataSource.close?.[renkoIndex])}</span></span>
          {renkoData?.adr_period && renkoDataSource?.adr_value && (
            <>
              <span className="data-pair"><span className="data-label">ADR({renkoData.adr_period})</span> <span className="data-value mono">{formatPrice(renkoDataSource.adr_value?.[renkoIndex])}</span></span>
              <span className="data-pair"><span className="data-label">Brick</span> <span className="data-value mono">{formatPrice(renkoDataSource.brick_size?.[renkoIndex])}</span></span>
              <span className="data-pair"><span className="data-label">Rev</span> <span className="data-value mono">{formatPrice(renkoDataSource.reversal_size?.[renkoIndex])}</span></span>
            </>
          )}
          {wickErrorPct !== null && (
            <span className="data-pair"><span className="data-label">Error</span> <span className="data-value mono">~{wickErrorPct}%</span></span>
          )}
          {renkoDataSource?.close?.length > 0 && (
            <span className="data-pair"><span className="data-label">barCount</span> <span className="data-value mono">{renkoDataSource.close.length.toLocaleString()}</span></span>
          )}
        </div>
      )}

      {/* HTF row */}
      {chartType === 'o2' && htfRenkoData && htfIdx >= 0 && (
        <div className="data-row">
          <span className="data-row-label">HTF</span>
          <span className="data-pair"><span className="data-label">O</span> <span className="data-value mono">{formatPrice(htfRenkoData.open?.[htfIdx])}</span></span>
          <span className="data-pair"><span className="data-label">H</span> <span className="data-value mono">{formatPrice(htfRenkoData.high?.[htfIdx])}</span></span>
          <span className="data-pair"><span className="data-label">L</span> <span className="data-value mono">{formatPrice(htfRenkoData.low?.[htfIdx])}</span></span>
          <span className="data-pair"><span className="data-label">C</span> <span className="data-value mono">{formatPrice(htfRenkoData.close?.[htfIdx])}</span></span>
          {htfErrorPct !== null && (
            <span className="data-pair"><span className="data-label">Error</span> <span className="data-value mono">~{htfErrorPct}%</span></span>
          )}
          <span className="data-pair"><span className="data-label">barCount</span> <span className="data-value mono">{htfRenkoData.open.length.toLocaleString()}</span></span>
        </div>
      )}
    </div>
  )
}

export default DataWindow
