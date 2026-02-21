import { useState } from 'react'
import './BacktestChartControls.css'

const LINE_STYLES = [
  { value: 0, label: 'Solid' },
  { value: 1, label: 'Dashed' },
  { value: 2, label: 'Dotted' },
]

function EMARow({ label, settings, onChange, disabled }) {
  return (
    <div className="bt-ema-row">
      <label className="bt-checkbox">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => onChange({ ...settings, enabled: e.target.checked })}
          disabled={disabled}
        />
        <span className="bt-label">{label}</span>
      </label>

      <input
        type="color"
        className="bt-color-picker"
        value={settings.color}
        onChange={(e) => onChange({ ...settings, color: e.target.value })}
        disabled={disabled || !settings.enabled}
      />

      <select
        className="bt-select"
        value={settings.lineWidth}
        onChange={(e) => onChange({ ...settings, lineWidth: parseInt(e.target.value) })}
        disabled={disabled || !settings.enabled}
      >
        <option value={1}>1px</option>
        <option value={2}>2px</option>
        <option value={3}>3px</option>
        <option value={4}>4px</option>
      </select>

      <select
        className="bt-select"
        value={settings.lineStyle}
        onChange={(e) => onChange({ ...settings, lineStyle: parseInt(e.target.value) })}
        disabled={disabled || !settings.enabled}
      >
        {LINE_STYLES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </div>
  )
}

function SMAERow({ label, settings, onChange, disabled }) {
  return (
    <div className="bt-smae-row">
      <label className="bt-checkbox">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => onChange({ ...settings, enabled: e.target.checked })}
          disabled={disabled}
        />
        <span className="bt-label">{label}</span>
      </label>

      <label className="bt-checkbox bt-center-toggle" title="Show center line">
        <input
          type="checkbox"
          checked={settings.showCenter}
          onChange={(e) => onChange({ ...settings, showCenter: e.target.checked })}
          disabled={disabled || !settings.enabled}
        />
        <span className="bt-label">C</span>
      </label>

      <input
        type="color"
        className="bt-color-picker"
        value={settings.centerColor}
        onChange={(e) => onChange({ ...settings, centerColor: e.target.value })}
        disabled={disabled || !settings.enabled}
        title="Center line color"
      />

      <input
        type="color"
        className="bt-color-picker"
        value={settings.bandColor}
        onChange={(e) => onChange({ ...settings, bandColor: e.target.value })}
        disabled={disabled || !settings.enabled}
        title="Band color"
      />

      <select
        className="bt-select"
        value={settings.lineWidth}
        onChange={(e) => onChange({ ...settings, lineWidth: parseInt(e.target.value) })}
        disabled={disabled || !settings.enabled}
      >
        <option value={1}>1px</option>
        <option value={2}>2px</option>
        <option value={3}>3px</option>
        <option value={4}>4px</option>
      </select>

      <select
        className="bt-select"
        value={settings.bandLineStyle}
        onChange={(e) => onChange({ ...settings, bandLineStyle: parseInt(e.target.value) })}
        disabled={disabled || !settings.enabled}
      >
        {LINE_STYLES.map((s) => (
          <option key={s.value} value={s.value}>{s.label}</option>
        ))}
      </select>
    </div>
  )
}

function IndicatorDropdown({ settings, onChange, hasHTF, hasSMAE, hasPWAP }) {
  const [isOpen, setIsOpen] = useState(false)

  const update = (key, value) => {
    onChange({ ...settings, [key]: value })
  }

  const enabledCount =
    [settings.ema1, settings.ema2, settings.ema3].filter((s) => s.enabled).length +
    [settings.smae1, settings.smae2].filter((s) => s.enabled).length +
    (settings.pwap?.enabled ? 1 : 0) +
    (settings.htfBars?.enabled ? 1 : 0) +
    [settings.htfEma1, settings.htfEma2, settings.htfEma3].filter((s) => s?.enabled).length +
    [settings.htfSmae1, settings.htfSmae2].filter((s) => s?.enabled).length

  return (
    <div className="bt-controls-wrapper">
      <button className="bt-toggle-btn" onClick={() => setIsOpen(!isOpen)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
        <span>IN</span>
        {enabledCount > 0 && <span className="bt-badge">{enabledCount}</span>}
      </button>

      {isOpen && (
        <div className="bt-dropdown">
          <div className="bt-dropdown-header">
            <span>Indicators</span>
            <button className="bt-close-btn" onClick={() => setIsOpen(false)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="bt-dropdown-body">
            {/* EMA Section */}
            <div className="bt-section-label">EMA</div>
            <div className="bt-ema-header">
              <span></span>
              <span>Color</span>
              <span>Width</span>
              <span>Style</span>
            </div>
            <EMARow label="1" settings={settings.ema1} onChange={(v) => update('ema1', v)} />
            <EMARow label="2" settings={settings.ema2} onChange={(v) => update('ema2', v)} />
            <EMARow label="3" settings={settings.ema3} onChange={(v) => update('ema3', v)} />

            {/* Envelope Section */}
            <div className="bt-section-divider" />
            <div className="bt-section-label">Envelope</div>
            <div className="bt-smae-header">
              <span></span>
              <span></span>
              <span>Ctr</span>
              <span>Band</span>
              <span>Width</span>
              <span>Style</span>
            </div>
            <SMAERow label="1" settings={settings.smae1} onChange={(v) => update('smae1', v)} disabled={!hasSMAE} />
            <SMAERow label="2" settings={settings.smae2} onChange={(v) => update('smae2', v)} disabled={!hasSMAE} />

            {/* PWAP Section */}
            <div className="bt-section-divider" />
            <div className="bt-section-label">PWAP</div>
            <div className="bt-pwap-section">
              <div className="bt-pwap-row">
                <label className="bt-checkbox">
                  <input
                    type="checkbox"
                    checked={settings.pwap?.enabled || false}
                    onChange={(e) => update('pwap', { ...settings.pwap, enabled: e.target.checked })}
                    disabled={!hasPWAP}
                  />
                  <span className="bt-label">On</span>
                </label>
              </div>
              <div className="bt-pwap-row bt-pwap-style-row">
                <label className="bt-checkbox bt-pwap-sublabel">
                  <input
                    type="checkbox"
                    checked={settings.pwap?.showMean !== false}
                    onChange={(e) => update('pwap', { ...settings.pwap, showMean: e.target.checked })}
                    disabled={!hasPWAP || !settings.pwap?.enabled}
                  />
                  <span className="bt-label">Mean</span>
                </label>
                <input
                  type="color"
                  className="bt-color-picker"
                  value={settings.pwap?.meanColor || '#f472b6'}
                  onChange={(e) => update('pwap', { ...settings.pwap, meanColor: e.target.value })}
                  disabled={!hasPWAP || !settings.pwap?.enabled || settings.pwap?.showMean === false}
                />
                <select
                  className="bt-select"
                  value={settings.pwap?.meanWidth || 2}
                  onChange={(e) => update('pwap', { ...settings.pwap, meanWidth: parseInt(e.target.value) })}
                  disabled={!hasPWAP || !settings.pwap?.enabled || settings.pwap?.showMean === false}
                >
                  <option value={1}>1px</option>
                  <option value={2}>2px</option>
                  <option value={3}>3px</option>
                  <option value={4}>4px</option>
                </select>
                <select
                  className="bt-select"
                  value={settings.pwap?.meanStyle ?? 0}
                  onChange={(e) => update('pwap', { ...settings.pwap, meanStyle: parseInt(e.target.value) })}
                  disabled={!hasPWAP || !settings.pwap?.enabled || settings.pwap?.showMean === false}
                >
                  {LINE_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div className="bt-pwap-row bt-pwap-style-row">
                <label className="bt-checkbox bt-pwap-sublabel">
                  <input
                    type="checkbox"
                    checked={settings.pwap?.showBands !== false}
                    onChange={(e) => update('pwap', { ...settings.pwap, showBands: e.target.checked })}
                    disabled={!hasPWAP || !settings.pwap?.enabled}
                  />
                  <span className="bt-label">Band</span>
                </label>
                <input
                  type="color"
                  className="bt-color-picker"
                  value={settings.pwap?.bandColor || '#f472b6'}
                  onChange={(e) => update('pwap', { ...settings.pwap, bandColor: e.target.value })}
                  disabled={!hasPWAP || !settings.pwap?.enabled || settings.pwap?.showBands === false}
                />
                <select
                  className="bt-select"
                  value={settings.pwap?.bandWidth || 1}
                  onChange={(e) => update('pwap', { ...settings.pwap, bandWidth: parseInt(e.target.value) })}
                  disabled={!hasPWAP || !settings.pwap?.enabled || settings.pwap?.showBands === false}
                >
                  <option value={1}>1px</option>
                  <option value={2}>2px</option>
                  <option value={3}>3px</option>
                  <option value={4}>4px</option>
                </select>
                <select
                  className="bt-select"
                  value={settings.pwap?.bandStyle ?? 2}
                  onChange={(e) => update('pwap', { ...settings.pwap, bandStyle: parseInt(e.target.value) })}
                  disabled={!hasPWAP || !settings.pwap?.enabled || settings.pwap?.showBands === false}
                >
                  {LINE_STYLES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* HTF Bars Section */}
            {hasHTF && (
              <>
                <div className="bt-section-divider" />
                <div className="bt-section-label">HTF Bars</div>
                <div className="bt-htf-bars-row">
                  <label className="bt-checkbox">
                    <input
                      type="checkbox"
                      checked={settings.htfBars?.enabled || false}
                      onChange={(e) => update('htfBars', { ...settings.htfBars, enabled: e.target.checked })}
                    />
                    <span className="bt-label">On</span>
                  </label>
                  <div className="bt-htf-bars-colors">
                    <span className="bt-color-label">Up</span>
                    <input
                      type="color"
                      className="bt-color-picker"
                      value={settings.htfBars?.upColor || '#3b82f6'}
                      onChange={(e) => update('htfBars', { ...settings.htfBars, upColor: e.target.value })}
                      disabled={!settings.htfBars?.enabled}
                    />
                    <span className="bt-color-label">Dn</span>
                    <input
                      type="color"
                      className="bt-color-picker"
                      value={settings.htfBars?.downColor || '#fb923c'}
                      onChange={(e) => update('htfBars', { ...settings.htfBars, downColor: e.target.value })}
                      disabled={!settings.htfBars?.enabled}
                    />
                  </div>
                </div>
              </>
            )}

            {/* HTF EMA Section */}
            {hasHTF && (
              <>
                <div className="bt-section-divider" />
                <div className="bt-section-label">HTF EMA</div>
                <div className="bt-ema-header">
                  <span></span>
                  <span>Color</span>
                  <span>Width</span>
                  <span>Style</span>
                </div>
                <EMARow label="1" settings={settings.htfEma1} onChange={(v) => update('htfEma1', v)} />
                <EMARow label="2" settings={settings.htfEma2} onChange={(v) => update('htfEma2', v)} />
                <EMARow label="3" settings={settings.htfEma3} onChange={(v) => update('htfEma3', v)} />
              </>
            )}

            {/* HTF Envelope Section */}
            {hasHTF && (
              <>
                <div className="bt-section-divider" />
                <div className="bt-section-label">HTF Envelope</div>
                <div className="bt-smae-header">
                  <span></span>
                  <span></span>
                  <span>Ctr</span>
                  <span>Band</span>
                  <span>Width</span>
                  <span>Style</span>
                </div>
                <SMAERow label="1" settings={settings.htfSmae1} onChange={(v) => update('htfSmae1', v)} disabled={!hasSMAE} />
                <SMAERow label="2" settings={settings.htfSmae2} onChange={(v) => update('htfSmae2', v)} disabled={!hasSMAE} />
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function TradeMarkerDropdown({ lineWeight, lineStyle, markerSize, onLineWeightChange, onLineStyleChange, onMarkerSizeChange }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="bt-controls-wrapper">
      <button className="bt-toggle-btn" onClick={() => setIsOpen(!isOpen)}>
        <span>TM</span>
      </button>

      {isOpen && (
        <div className="bt-dropdown" style={{ minWidth: '220px' }}>
          <div className="bt-dropdown-header">
            <span>Trade Markers</span>
            <button className="bt-close-btn" onClick={() => setIsOpen(false)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="bt-dropdown-body">
            <div className="bt-tm-row">
              <span className="bt-tm-label">Line Weight</span>
              <select className="bt-select" value={lineWeight} onChange={(e) => onLineWeightChange(parseFloat(e.target.value))}>
                <option value={1}>1</option>
                <option value={1.5}>1.5</option>
                <option value={2}>2</option>
                <option value={3}>3</option>
              </select>
            </div>

            <div className="bt-tm-row">
              <span className="bt-tm-label">Line Style</span>
              <select className="bt-select" value={lineStyle} onChange={(e) => onLineStyleChange(e.target.value)}>
                <option value="solid">Solid</option>
                <option value="dashed">Dashed</option>
                <option value="dotted">Dotted</option>
              </select>
            </div>

            <div className="bt-tm-row">
              <span className="bt-tm-label">Marker Size</span>
              <select className="bt-select" value={markerSize} onChange={(e) => onMarkerSizeChange(parseInt(e.target.value))}>
                <option value={2}>2</option>
                <option value={3}>3</option>
                <option value={4}>4</option>
                <option value={5}>5</option>
                <option value={6}>6</option>
              </select>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { IndicatorDropdown, TradeMarkerDropdown }
