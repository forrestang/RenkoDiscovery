import { useState } from 'react'
import './MAControls.css'

const LINE_STYLES = [
  { value: 0, label: 'Solid' },
  { value: 1, label: 'Dashed' },
  { value: 2, label: 'Dotted' },
]

const MA_TYPES = [
  { value: 'sma', label: 'SMA' },
  { value: 'ema', label: 'EMA' },
]

function MARow({ label, ma, onChange }) {
  return (
    <div className="ma-row">
      <label className="ma-checkbox">
        <input
          type="checkbox"
          checked={ma.enabled}
          onChange={(e) => onChange({ ...ma, enabled: e.target.checked })}
        />
        <span className="ma-label">{label}</span>
      </label>

      <select
        className="ma-type-select"
        value={ma.type}
        onChange={(e) => onChange({ ...ma, type: e.target.value })}
        disabled={!ma.enabled}
      >
        {MA_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <div className="ma-period-input">
        <input
          type="number"
          value={ma.period}
          onChange={(e) => onChange({ ...ma, period: parseInt(e.target.value) || 1 })}
          min={1}
          max={500}
          disabled={!ma.enabled}
        />
      </div>

      <input
        type="color"
        className="ma-color-picker"
        value={ma.color}
        onChange={(e) => onChange({ ...ma, color: e.target.value })}
        disabled={!ma.enabled}
      />

      <select
        className="ma-width-select"
        value={ma.lineWidth}
        onChange={(e) => onChange({ ...ma, lineWidth: parseInt(e.target.value) })}
        disabled={!ma.enabled}
      >
        <option value={1}>1px</option>
        <option value={2}>2px</option>
        <option value={3}>3px</option>
        <option value={4}>4px</option>
      </select>

      <select
        className="ma-style-select"
        value={ma.lineStyle}
        onChange={(e) => onChange({ ...ma, lineStyle: parseInt(e.target.value) })}
        disabled={!ma.enabled}
      >
        {LINE_STYLES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  )
}

function MAControls({ settings, onChange }) {
  const [isOpen, setIsOpen] = useState(false)

  const handleMAChange = (key, value) => {
    onChange({ ...settings, [key]: value })
  }

  const enabledCount = [settings.ma1, settings.ma2, settings.ma3].filter((m) => m.enabled).length

  return (
    <div className="ma-controls-wrapper">
      <button className="ma-toggle-btn" onClick={() => setIsOpen(!isOpen)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
        <span>MA</span>
        {enabledCount > 0 && <span className="ma-badge">{enabledCount}</span>}
      </button>

      {isOpen && (
        <div className="ma-dropdown">
          <div className="ma-dropdown-header">
            <span>Moving Averages</span>
            <button className="ma-close-btn" onClick={() => setIsOpen(false)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="ma-dropdown-body">
            <div className="ma-header-row">
              <span></span>
              <span>Type</span>
              <span>Period</span>
              <span>Color</span>
              <span>Width</span>
              <span>Style</span>
            </div>

            <MARow
              label="MA1"
              ma={settings.ma1}
              onChange={(v) => handleMAChange('ma1', v)}
            />
            <MARow
              label="MA2"
              ma={settings.ma2}
              onChange={(v) => handleMAChange('ma2', v)}
            />
            <MARow
              label="MA3"
              ma={settings.ma3}
              onChange={(v) => handleMAChange('ma3', v)}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default MAControls
