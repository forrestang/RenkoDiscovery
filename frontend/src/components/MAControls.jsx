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

function SMAERow({ label, smae, onChange }) {
  return (
    <div className="ma-smae-row">
      <label className="ma-checkbox">
        <input
          type="checkbox"
          checked={smae.enabled}
          onChange={(e) => onChange({ ...smae, enabled: e.target.checked })}
        />
        <span className="ma-label">{label}</span>
      </label>

      <div className="ma-period-input">
        <input
          type="number"
          value={smae.period}
          onChange={(e) => onChange({ ...smae, period: parseInt(e.target.value) || 1 })}
          min={1}
          max={500}
          disabled={!smae.enabled}
          title="SMA Period"
        />
      </div>

      <div className="ma-period-input ma-deviation-input">
        <input
          type="number"
          value={smae.deviation}
          onChange={(e) => onChange({ ...smae, deviation: parseFloat(e.target.value) || 0 })}
          min={0}
          max={100}
          step={0.1}
          disabled={!smae.enabled}
          title="Deviation %"
        />
      </div>

      <label className="ma-checkbox ma-center-toggle" title="Show center SMA line">
        <input
          type="checkbox"
          checked={smae.showCenter}
          onChange={(e) => onChange({ ...smae, showCenter: e.target.checked })}
          disabled={!smae.enabled}
        />
        <span className="ma-label">C</span>
      </label>

      <input
        type="color"
        className="ma-color-picker"
        value={smae.centerColor}
        onChange={(e) => onChange({ ...smae, centerColor: e.target.value })}
        disabled={!smae.enabled}
        title="Center line color"
      />

      <input
        type="color"
        className="ma-color-picker"
        value={smae.bandColor}
        onChange={(e) => onChange({ ...smae, bandColor: e.target.value })}
        disabled={!smae.enabled}
        title="Band color"
      />

      <select
        className="ma-width-select"
        value={smae.lineWidth}
        onChange={(e) => onChange({ ...smae, lineWidth: parseInt(e.target.value) })}
        disabled={!smae.enabled}
        title="Center line width"
      >
        <option value={1}>1px</option>
        <option value={2}>2px</option>
        <option value={3}>3px</option>
        <option value={4}>4px</option>
      </select>

      <select
        className="ma-style-select"
        value={smae.bandLineStyle}
        onChange={(e) => onChange({ ...smae, bandLineStyle: parseInt(e.target.value) })}
        disabled={!smae.enabled}
        title="Band line style"
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

function MAControls({ settings, onChange, smaeSettings, onSmaeChange, pwapSettings, onPwapChange }) {
  const [isOpen, setIsOpen] = useState(false)

  const handleMAChange = (key, value) => {
    onChange({ ...settings, [key]: value })
  }

  const handleSmaeChange = (key, value) => {
    onSmaeChange({ ...smaeSettings, [key]: value })
  }

  const handlePwapChange = (updates) => {
    onPwapChange({ ...pwapSettings, ...updates })
  }

  const enabledCount =
    [settings.ma1, settings.ma2, settings.ma3].filter((m) => m.enabled).length +
    [smaeSettings?.smae1, smaeSettings?.smae2].filter((s) => s?.enabled).length +
    (pwapSettings?.enabled ? 1 : 0)

  return (
    <div className="ma-controls-wrapper">
      <button className="ma-toggle-btn" onClick={() => setIsOpen(!isOpen)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
        <span>IN</span>
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

            {/* SMAE Section */}
            <div className="ma-section-divider" />
            <div className="ma-section-label">MA Envelope</div>
            <div className="ma-header-row ma-smae-header">
              <span></span>
              <span>Period</span>
              <span>Dev%</span>
              <span></span>
              <span>Ctr</span>
              <span>Band</span>
              <span>Width</span>
              <span>Style</span>
            </div>

            {smaeSettings && (
              <>
                <SMAERow
                  label="E1"
                  smae={smaeSettings.smae1}
                  onChange={(v) => handleSmaeChange('smae1', v)}
                />
                <SMAERow
                  label="E2"
                  smae={smaeSettings.smae2}
                  onChange={(v) => handleSmaeChange('smae2', v)}
                />
              </>
            )}

            {/* PWAP Section */}
            <div className="ma-section-divider" />
            <div className="ma-section-label">PWAP</div>

            {pwapSettings && (
              <div className="ma-pwap-section">
                <div className="ma-pwap-row">
                  <label className="ma-checkbox">
                    <input
                      type="checkbox"
                      checked={pwapSettings.enabled}
                      onChange={(e) => handlePwapChange({ enabled: e.target.checked })}
                    />
                    <span className="ma-label">On</span>
                  </label>

                  <div className="ma-pwap-sigmas">
                    {pwapSettings.sigmas.map((sigma, i) => (
                      <div key={i} className="ma-period-input ma-sigma-input">
                        <input
                          type="number"
                          value={sigma}
                          onChange={(e) => {
                            const newSigmas = [...pwapSettings.sigmas]
                            newSigmas[i] = parseFloat(e.target.value) || 0
                            handlePwapChange({ sigmas: newSigmas })
                          }}
                          min={0}
                          max={10}
                          step={0.1}
                          disabled={!pwapSettings.enabled}
                          title={`Sigma ${i + 1}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="ma-pwap-row ma-pwap-style-row">
                  <span className="ma-label ma-pwap-sublabel">Mean</span>
                  <input
                    type="color"
                    className="ma-color-picker"
                    value={pwapSettings.meanColor}
                    onChange={(e) => handlePwapChange({ meanColor: e.target.value })}
                    disabled={!pwapSettings.enabled}
                  />
                  <select
                    className="ma-width-select"
                    value={pwapSettings.meanWidth}
                    onChange={(e) => handlePwapChange({ meanWidth: parseInt(e.target.value) })}
                    disabled={!pwapSettings.enabled}
                  >
                    <option value={1}>1px</option>
                    <option value={2}>2px</option>
                    <option value={3}>3px</option>
                    <option value={4}>4px</option>
                  </select>
                  <select
                    className="ma-style-select"
                    value={pwapSettings.meanStyle}
                    onChange={(e) => handlePwapChange({ meanStyle: parseInt(e.target.value) })}
                    disabled={!pwapSettings.enabled}
                  >
                    {LINE_STYLES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>

                  <span className="ma-label ma-pwap-sublabel">Band</span>
                  <input
                    type="color"
                    className="ma-color-picker"
                    value={pwapSettings.bandColor}
                    onChange={(e) => handlePwapChange({ bandColor: e.target.value })}
                    disabled={!pwapSettings.enabled}
                  />
                  <select
                    className="ma-width-select"
                    value={pwapSettings.bandWidth}
                    onChange={(e) => handlePwapChange({ bandWidth: parseInt(e.target.value) })}
                    disabled={!pwapSettings.enabled}
                  >
                    <option value={1}>1px</option>
                    <option value={2}>2px</option>
                    <option value={3}>3px</option>
                    <option value={4}>4px</option>
                  </select>
                  <select
                    className="ma-style-select"
                    value={pwapSettings.bandStyle}
                    onChange={(e) => handlePwapChange({ bandStyle: parseInt(e.target.value) })}
                    disabled={!pwapSettings.enabled}
                  >
                    {LINE_STYLES.map((s) => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default MAControls
