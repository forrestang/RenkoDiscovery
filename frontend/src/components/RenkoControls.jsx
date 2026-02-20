import { useState, useEffect } from 'react'

const WICK_MODES = [
  { value: 'all', label: 'All Wicks' },
  { value: 'big', label: 'Big Wicks' },
  { value: 'none', label: 'No Wicks' },
]

function RenkoControls({ settings, onChange, chartType = 'renko' }) {
  const [localSettings, setLocalSettings] = useState(settings)
  const [htfInputValue, setHtfInputValue] = useState(
    settings.htfBrickSize != null ? String(settings.htfBrickSize) : ''
  )

  useEffect(() => {
    setLocalSettings(settings)
    setHtfInputValue(settings.htfBrickSize != null ? String(settings.htfBrickSize) : '')
  }, [settings])

  const renkoDisabled = chartType === 'raw'
  const htfDisabled = chartType !== 'o2'

  const deriveReversal = (s) => ({
    ...s,
    reversalSize: s.reversalMode === 'tv' ? s.brickSize * 2 : s.brickSize,
    reversalPct: s.reversalMode === 'tv' ? s.brickPct * 2 : s.brickPct,
  })

  const handleSizingModeChange = (mode) => {
    if (renkoDisabled) return
    const newSettings = deriveReversal({ ...localSettings, sizingMode: mode })
    setLocalSettings(newSettings)
    onChange(newSettings)
  }

  const handleWickModeChange = (e) => {
    if (renkoDisabled) return
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
      onChange(deriveReversal(localSettings))
    }
  }

  const handleBrickSizeKeyDown = (e) => {
    if (e.key === 'Enter' && localSettings.brickSize > 0) {
      onChange(deriveReversal(localSettings))
    }
  }

  // ADR mode handlers
  const handleBrickPctChange = (e) => {
    const value = parseFloat(e.target.value) || 0
    setLocalSettings(prev => ({ ...prev, brickPct: value }))
  }

  const handleBrickPctBlur = () => {
    if (localSettings.brickPct > 0) {
      onChange(deriveReversal(localSettings))
    }
  }

  const handleBrickPctKeyDown = (e) => {
    if (e.key === 'Enter' && localSettings.brickPct > 0) {
      onChange(deriveReversal(localSettings))
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

  const handleReversalModeChange = (mode) => {
    if (renkoDisabled) return
    const newSettings = deriveReversal({ ...localSettings, reversalMode: mode })
    setLocalSettings(newSettings)
    onChange(newSettings)
  }

  // HTF brick size handlers — store raw string to allow decimal typing
  const handleHtfBrickSizeChange = (e) => {
    setHtfInputValue(e.target.value)
  }

  const commitHtfValue = () => {
    const parsed = parseFloat(htfInputValue)
    const htfVal = isNaN(parsed) || parsed <= 0 ? null : parsed
    const newSettings = { ...localSettings, htfBrickSize: htfVal }
    setLocalSettings(newSettings)
    setHtfInputValue(htfVal != null ? String(htfVal) : '')
    onChange(newSettings)
  }

  const handleHtfBrickSizeBlur = () => commitHtfValue()

  const handleHtfBrickSizeKeyDown = (e) => {
    if (e.key === 'Enter') commitHtfValue()
  }

  return (
    <div className={`renko-controls${renkoDisabled ? ' renko-controls-disabled' : ''}`}>
      <div className="chart-type-toggle" style={{ marginRight: '8px' }}>
        <button
          className={`toggle-btn${sizingMode === 'price' ? ' active' : ''}`}
          onClick={() => handleSizingModeChange('price')}
          disabled={renkoDisabled}
        >
          Price
        </button>
        <button
          className={`toggle-btn${sizingMode === 'adr' ? ' active' : ''}`}
          onClick={() => handleSizingModeChange('adr')}
          disabled={renkoDisabled}
        >
          ADR
        </button>
      </div>

      {sizingMode === 'price' ? (
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
            disabled={renkoDisabled}
          />
          <span className="input-suffix">Brick</span>
        </div>
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
              disabled={renkoDisabled}
            />
            <span className="input-suffix">Brick%</span>
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
              disabled={renkoDisabled}
            />
            <span className="input-suffix">ADR</span>
          </div>
        </>
      )}

      <div className={`renko-size-input${htfDisabled ? ' renko-input-disabled' : ''}`} style={{ marginLeft: '4px' }}>
        <input
          type="text"
          inputMode="decimal"
          className="mono"
          value={htfInputValue}
          onChange={handleHtfBrickSizeChange}
          onBlur={handleHtfBrickSizeBlur}
          onKeyDown={handleHtfBrickSizeKeyDown}
          disabled={htfDisabled}
          style={{ width: '60px' }}
        />
        <span className="input-suffix">HTF</span>
      </div>

      <select
        className="renko-wick-select mono"
        value={localSettings.wickMode || 'all'}
        onChange={handleWickModeChange}
        disabled={renkoDisabled}
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
          disabled={renkoDisabled}
        >
          FP
        </button>
        <button
          className={`toggle-btn${(localSettings.reversalMode || 'fp') === 'tv' ? ' active' : ''}`}
          onClick={() => handleReversalModeChange('tv')}
          disabled={renkoDisabled}
        >
          TV
        </button>
      </div>
    </div>
  )
}

export default RenkoControls
