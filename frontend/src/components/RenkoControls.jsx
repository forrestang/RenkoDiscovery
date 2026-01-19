import { useState, useEffect } from 'react'

const BRICK_METHODS = [
  { value: 'fixed_pip', label: 'Fixed Pips' },
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
    const value = parseFloat(e.target.value) || 2
    setLocalSettings(prev => ({ ...prev, reversalMultiplier: value }))
  }

  const handleReversalBlur = () => {
    if (localSettings.reversalMultiplier >= 1) {
      onChange(localSettings)
    }
  }

  const handleReversalKeyDown = (e) => {
    if (e.key === 'Enter' && localSettings.reversalMultiplier >= 1) {
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
      case 'fixed_pip':
        return 'Pips'
      case 'percentage':
        return '%'
      case 'atr':
        return 'ATR x'
      default:
        return 'Size'
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
          min="0.1"
          step={localSettings.brickMethod === 'percentage' ? '0.1' : '1'}
        />
        <span className="input-suffix">{getBrickSizeLabel()}</span>
      </div>
      <div className="renko-reversal-input">
        <input
          type="number"
          className="mono"
          value={localSettings.reversalMultiplier || 2}
          onChange={handleReversalChange}
          onBlur={handleReversalBlur}
          onKeyDown={handleReversalKeyDown}
          min="1"
          max="10"
          step="0.5"
        />
        <span className="input-suffix">x Rev</span>
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
