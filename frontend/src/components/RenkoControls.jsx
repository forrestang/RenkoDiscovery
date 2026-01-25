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

  return (
    <div className="renko-controls">
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
