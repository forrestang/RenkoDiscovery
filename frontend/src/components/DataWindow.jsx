function DataWindow({ renkoData, hoveredBarIndex, renkoSettings, pricePrecision = 5, visible }) {
  if (!visible || !renkoData?.adr_info) return null

  const { adr_info, data } = renkoData
  const barAdr = data.bar_adr
  const barBrickSize = data.bar_brick_size
  const brickSizeActual = data.brick_size_actual

  // Use hovered bar's values, or last bar if not hovering
  const displayIndex = hoveredBarIndex !== null && hoveredBarIndex >= 0 && barAdr && hoveredBarIndex < barAdr.length
    ? hoveredBarIndex
    : (barAdr?.length - 1) || 0

  const adrValue = barAdr?.[displayIndex] || adr_info.adr_value
  // Use actual brick size from data if available (reflects dynamic session-based sizing)
  const actualBrickSize = brickSizeActual?.[displayIndex]
  const brickSize = actualBrickSize || barBrickSize?.[displayIndex] || renkoData.brick_size

  // Calculate reversal size from brick size and the ratio of percentages
  const brickPct = renkoSettings?.brickSize || adr_info.brick_percentage
  const reversalPct = renkoSettings?.reversalSize || adr_info.reversal_percentage
  const reversalSize = brickSize * (reversalPct / brickPct)

  return (
    <div className="data-window">
      <div className="data-row">
        <span className="data-label">ADR</span>
        <span className="data-value mono">{adrValue.toFixed(pricePrecision)}</span>
      </div>
      <div className="data-row">
        <span className="data-label">Brick</span>
        <span className="data-value mono">{brickSize.toFixed(pricePrecision)}</span>
      </div>
      <div className="data-row">
        <span className="data-label">Rev</span>
        <span className="data-value mono">{reversalSize.toFixed(pricePrecision)}</span>
      </div>
    </div>
  )
}

export default DataWindow
