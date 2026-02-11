import { useState, useEffect } from 'react'

const WICK_MODES = [
  { value: 'all', label: 'All Wicks' },
  { value: 'big', label: 'Big Wicks' },
  { value: 'none', label: 'No Wicks' },
]

function RenkoControls({ settings, onChange }) {
  const [localSettings, setLocalSettings] = useState(settings)

  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])

  const handleSizingModeChange = (mode) => {
    const newSettings = { ...localSettings, sizingMode: mode }
    setLocalSettings(newSettings)
    onChange(newSettings)
  }

  const handleWickModeChange = (e) => {
    const newSettings = { ...localSettings, wickMode: e.target.value }
    setLocalSettings(newSettings)
    onChange(newSettings)
  }

  // Price mode handlers
  const handleBrickSizeChange = (e) => {
    const value = parseFloat(e.target.value) || 0
    setLocalSettings(prev => ({ ...prev, brickSize: value }))
  }

  const handleBrickSizeBlur = () => {
    if (localSettings.brickSize > 0) {
      onChange(localSettings)
    }
  }

  const handleBrickSizeKeyDown = (e) => {
    if (e.key === 'Enter' && localSettings.brickSize > 0) {
      onChange(localSettings)
    }
  }

  const handleReversalChange = (e) => {
    const value = parseFloat(e.target.value) || 0
    setLocalSettings(prev => ({ ...prev, reversalSize: value }))
  }

  const handleReversalBlur = () => {
    if (localSettings.reversalSize > 0) {
      onChange(localSettings)
    }
  }

  const handleReversalKeyDown = (e) => {
    if (e.key === 'Enter' && localSettings.reversalSize > 0) {
      onChange(localSettings)
    }
  }

  // ADR mode handlers
  const handleBrickPctChange = (e) => {
    const value = parseFloat(e.target.value) || 0
    setLocalSettings(prev => ({ ...prev, brickPct: value }))
  }

  const handleBrickPctBlur = () => {
    if (localSettings.brickPct > 0) {
      onChange(localSettings)
    }
  }

  const handleBrickPctKeyDown = (e) => {
    if (e.key === 'Enter' && localSettings.brickPct > 0) {
      onChange(localSettings)
    }
  }

  const handleReversalPctChange = (e) => {
    const value = parseFloat(e.target.value) || 0
    setLocalSettings(prev => ({ ...prev, reversalPct: value }))
  }

  const handleReversalPctBlur = () => {
    if (localSettings.reversalPct > 0) {
      onChange(localSettings)
    }
  }

  const handleReversalPctKeyDown = (e) => {
    if (e.key === 'Enter' && localSettings.reversalPct > 0) {
      onChange(localSettings)
    }
  }

  const handleAdrPeriodChange = (e) => {
    const value = parseInt(e.target.value) || 0
    setLocalSettings(prev => ({ ...prev, adrPeriod: value }))
  }

  const handleAdrPeriodBlur = () => {
    if (localSettings.adrPeriod > 0) {
      onChange(localSettings)
    }
  }

  const handleAdrPeriodKeyDown = (e) => {
    if (e.key === 'Enter' && localSettings.adrPeriod > 0) {
      onChange(localSettings)
    }
  }

  const sizingMode = localSettings.sizingMode || 'price'

  // TV mode only available when reversal > brick
  const reversalExceedsBrick = sizingMode === 'price'
    ? localSettings.reversalSize > localSettings.brickSize
    : localSettings.reversalPct > localSettings.brickPct

  const handleReversalModeChange = (mode) => {
    const newSettings = { ...localSettings, reversalMode: mode }
    setLocalSettings(newSettings)
    onChange(newSettings)
  }

  // Force FP when reversal <= brick
  useEffect(() => {
    if (!reversalExceedsBrick && localSettings.reversalMode === 'tv') {
      const newSettings = { ...localSettings, reversalMode: 'fp' }
      setLocalSettings(newSettings)
      onChange(newSettings)
    }
  }, [reversalExceedsBrick]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="renko-controls">
      <div className="chart-type-toggle" style={{ marginRight: '8px' }}>
        <button
          className={`toggle-btn${sizingMode === 'price' ? ' active' : ''}`}
          onClick={() => handleSizingModeChange('price')}
        >
          Price
        </button>
        <button
          className={`toggle-btn${sizingMode === 'adr' ? ' active' : ''}`}
          onClick={() => handleSizingModeChange('adr')}
        >
          ADR
        </button>
      </div>

      {sizingMode === 'price' ? (
        <>
          <div className="renko-size-input">
            <input
              type="number"
              className="mono"
              value={localSettings.brickSize}
              onChange={handleBrickSizeChange}
              onBlur={handleBrickSizeBlur}
              onKeyDown={handleBrickSizeKeyDown}
              min="0.00001"
              step="0.0001"
            />
            <span className="input-suffix">Brick</span>
          </div>
          <div className="renko-reversal-input">
            <input
              type="number"
              className="mono"
              value={localSettings.reversalSize}
              onChange={handleReversalChange}
              onBlur={handleReversalBlur}
              onKeyDown={handleReversalKeyDown}
              min="0.00001"
              step="0.0001"
            />
            <span className="input-suffix">Rev</span>
          </div>
        </>
      ) : (
        <>
          <div className="renko-size-input">
            <input
              type="number"
              className="mono"
              value={localSettings.brickPct}
              onChange={handleBrickPctChange}
              onBlur={handleBrickPctBlur}
              onKeyDown={handleBrickPctKeyDown}
              min="0.5"
              step="0.5"
            />
            <span className="input-suffix">Brick%</span>
          </div>
          <div className="renko-reversal-input">
            <input
              type="number"
              className="mono"
              value={localSettings.reversalPct}
              onChange={handleReversalPctChange}
              onBlur={handleReversalPctBlur}
              onKeyDown={handleReversalPctKeyDown}
              min="0.5"
              step="0.5"
            />
            <span className="input-suffix">Rev%</span>
          </div>
          <div className="renko-size-input">
            <input
              type="number"
              className="mono"
              value={localSettings.adrPeriod}
              onChange={handleAdrPeriodChange}
              onBlur={handleAdrPeriodBlur}
              onKeyDown={handleAdrPeriodKeyDown}
              min="1"
              step="1"
            />
            <span className="input-suffix">ADR</span>
          </div>
        </>
      )}

      <select
        className="renko-wick-select mono"
        value={localSettings.wickMode || 'all'}
        onChange={handleWickModeChange}
      >
        {WICK_MODES.map(mode => (
          <option key={mode.value} value={mode.value}>
            {mode.label}
          </option>
        ))}
      </select>

      <div className="chart-type-toggle" style={{ marginLeft: '8px' }}>
        <button
          className={`toggle-btn${(localSettings.reversalMode || 'fp') === 'fp' ? ' active' : ''}`}
          onClick={() => handleReversalModeChange('fp')}
        >
          FP
        </button>
        <button
          className={`toggle-btn${(localSettings.reversalMode || 'fp') === 'tv' ? ' active' : ''}${!reversalExceedsBrick ? ' faint' : ''}`}
          onClick={() => reversalExceedsBrick && handleReversalModeChange('tv')}
          style={!reversalExceedsBrick ? { cursor: 'default' } : {}}
        >
          TV
        </button>
      </div>
    </div>
  )
}

export default RenkoControls
