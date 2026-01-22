import { useState, useEffect } from 'react'

const BRICK_METHODS = [
  { value: 'price', label: 'Price' },
  { value: 'adr', label: 'ADR' },
]

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

  const handleMethodChange = (e) => {
    const newMethod = e.target.value
    let newSettings = { ...localSettings, brickMethod: newMethod }

    // Set sensible defaults when switching methods
    if (newMethod === 'adr' && localSettings.brickMethod === 'price') {
      // Switching to ADR: use percentage defaults
      newSettings.brickSize = 50   // 50% of ADR
      newSettings.reversalSize = 100  // 100% of ADR
    } else if (newMethod === 'price' && localSettings.brickMethod === 'adr') {
      // Switching to Price: use typical forex pip values
      newSettings.brickSize = 0.0010
      newSettings.reversalSize = 0.0020
    }

    setLocalSettings(newSettings)
    onChange(newSettings)
  }

  const handleWickModeChange = (e) => {
    const newSettings = { ...localSettings, wickMode: e.target.value }
    setLocalSettings(newSettings)
    onChange(newSettings)
  }

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

  const handleAdrLookbackChange = (e) => {
    const value = parseInt(e.target.value, 10) || 5
    setLocalSettings(prev => ({ ...prev, adrLookback: value }))
  }

  const handleAdrLookbackBlur = () => {
    if (localSettings.adrLookback > 0) {
      onChange(localSettings)
    }
  }

  const handleAdrLookbackKeyDown = (e) => {
    if (e.key === 'Enter' && localSettings.adrLookback > 0) {
      onChange(localSettings)
    }
  }

  const getBrickSizeLabel = () => {
    switch (localSettings.brickMethod) {
      case 'price':
        return 'Brick'
      case 'adr':
        return '%'
      default:
        return 'Size'
    }
  }

  const getReversalLabel = () => {
    switch (localSettings.brickMethod) {
      case 'price':
        return 'Rev'
      case 'adr':
        return 'Rev %'
      default:
        return 'Rev'
    }
  }

  return (
    <div className="renko-controls">
      <select
        className="renko-method-select mono"
        value={localSettings.brickMethod}
        onChange={handleMethodChange}
      >
        {BRICK_METHODS.map(method => (
          <option key={method.value} value={method.value}>
            {method.label}
          </option>
        ))}
      </select>
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
        <span className="input-suffix">{getBrickSizeLabel()}</span>
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
        <span className="input-suffix">{getReversalLabel()}</span>
      </div>
      {localSettings.brickMethod === 'adr' && (
        <div className="renko-atr-input">
          <input
            type="number"
            className="mono"
            value={localSettings.adrLookback}
            onChange={handleAdrLookbackChange}
            onBlur={handleAdrLookbackBlur}
            onKeyDown={handleAdrLookbackKeyDown}
            min="1"
            step="1"
          />
          <span className="input-suffix">Sessions</span>
        </div>
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
    </div>
  )
}

export default RenkoControls
