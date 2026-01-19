import { useState, useEffect } from 'react'

const BRICK_METHODS = [
  { value: 'ticks', label: 'Ticks' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'atr', label: 'ATR' },
]

function RenkoControls({ settings, onChange }) {
  const [localSettings, setLocalSettings] = useState(settings)

  useEffect(() => {
    setLocalSettings(settings)
  }, [settings])

  const handleMethodChange = (e) => {
    const newSettings = { ...localSettings, brickMethod: e.target.value }
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

  const handleAtrPeriodChange = (e) => {
    const value = parseInt(e.target.value, 10) || 14
    setLocalSettings(prev => ({ ...prev, atrPeriod: value }))
  }

  const handleAtrPeriodBlur = () => {
    if (localSettings.atrPeriod > 0) {
      onChange(localSettings)
    }
  }

  const handleAtrPeriodKeyDown = (e) => {
    if (e.key === 'Enter' && localSettings.atrPeriod > 0) {
      onChange(localSettings)
    }
  }

  const getBrickSizeLabel = () => {
    switch (localSettings.brickMethod) {
      case 'ticks':
        return 'Brick'
      case 'percentage':
        return '%'
      case 'atr':
        return 'ATR x'
      default:
        return 'Size'
    }
  }

  const getReversalLabel = () => {
    switch (localSettings.brickMethod) {
      case 'ticks':
        return 'Rev'
      case 'percentage':
        return '% Rev'
      case 'atr':
        return 'ATR Rev'
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
      {localSettings.brickMethod === 'atr' && (
        <div className="renko-atr-input">
          <input
            type="number"
            className="mono"
            value={localSettings.atrPeriod}
            onChange={handleAtrPeriodChange}
            onBlur={handleAtrPeriodBlur}
            onKeyDown={handleAtrPeriodKeyDown}
            min="1"
            step="1"
          />
          <span className="input-suffix">Period</span>
        </div>
      )}
    </div>
  )
}

export default RenkoControls
