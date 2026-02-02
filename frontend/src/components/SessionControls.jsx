import { useState } from 'react'
import './SessionControls.css'

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday']
const DAY_LABELS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const DAY_BEFORE = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu']

function makeSchedule(hour, minute = 0) {
  const s = {}
  for (const d of DAYS) s[d] = { hour, minute }
  return s
}

const DEFAULT_TEMPLATES = {
  'fx-default': { name: 'FX Default', builtin: true, schedule: makeSchedule(22, 0) },
  'utc-midnight': { name: 'UTC Midnight', builtin: true, schedule: makeSchedule(0, 0) },
}

function getDefaultSettings() {
  return {
    activeTemplateId: 'fx-default',
    templates: JSON.parse(JSON.stringify(DEFAULT_TEMPLATES)),
  }
}

function migrateTemplate(tmpl) {
  // Migrate old startHour-only templates to schedule format
  if (tmpl.schedule) return tmpl
  const hour = tmpl.startHour ?? 22
  return { ...tmpl, schedule: makeSchedule(hour, 0) }
}

function generateId() {
  return 'custom-' + Date.now().toString(36)
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function formatTime(h, m) {
  return `${pad2(h)}:${pad2(m)}`
}

// Compute the open time for a given day (it's the previous day's close = previous day's boundary)
function getOpenTime(schedule, dayIndex) {
  // Monday open = previous session close. For Monday, that's the Friday schedule
  // (since there's no Saturday session). But more accurately, Monday's open =
  // the boundary time on Sunday, which uses Monday's close time from the day before.
  // Actually: Monday session opens at the configured time of the PREVIOUS trading day.
  // The boundary between sessions is defined per close-day.
  // Monday session: from Sunday at Monday's start time to Monday at Monday's start time?
  // No — the boundary at each day IS that day's configured time.
  // So Monday session = from previous boundary (Friday's time on Friday) to Monday's time on Monday.
  //
  // Simpler model: the boundary on each day occurs at that day's configured hour:minute.
  // Monday's session = Friday boundary → Monday boundary
  //   Open: Fri HH:MM, Close: Mon HH:MM
  // Tuesday's session = Monday boundary → Tuesday boundary
  //   Open: Mon HH:MM, Close: Tue HH:MM
  // etc.
  const prevDayIndex = dayIndex === 0 ? 4 : dayIndex - 1 // Mon->Fri, Tue->Mon, etc.
  const prevDay = DAYS[prevDayIndex]
  const prevSchedule = schedule[prevDay]
  return { day: DAY_BEFORE[dayIndex], hour: prevSchedule.hour, minute: prevSchedule.minute }
}

function SessionControls({ settings, onChange, inline = false }) {
  const [isOpen, setIsOpen] = useState(false)
  const [renameId, setRenameId] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  const templates = settings.templates
  const activeId = settings.activeTemplateId
  const activeTemplate = migrateTemplate(templates[activeId] || templates['fx-default'])
  const schedule = activeTemplate.schedule

  // Display the Monday start time in the toggle button
  const monStart = schedule.monday

  const handleTemplateChange = (e) => {
    onChange({ ...settings, activeTemplateId: e.target.value })
  }

  const ensureEditable = () => {
    // If editing a builtin template, auto-create a custom copy first
    if (activeTemplate.builtin) {
      const newId = generateId()
      const newTemplates = {
        ...templates,
        [newId]: { name: 'Custom', builtin: false, schedule: JSON.parse(JSON.stringify(schedule)) },
      }
      const newSettings = { ...settings, templates: newTemplates, activeTemplateId: newId }
      onChange(newSettings)
      return { id: newId, templates: newTemplates }
    }
    return { id: activeId, templates }
  }

  const handleDayChange = (day, field, value) => {
    const clamped = field === 'hour'
      ? Math.max(0, Math.min(23, parseInt(value) || 0))
      : Math.max(0, Math.min(59, parseInt(value) || 0))

    const { id, templates: tmpl } = ensureEditable()
    const current = migrateTemplate(tmpl[id] || activeTemplate)
    const newSchedule = { ...current.schedule, [day]: { ...current.schedule[day], [field]: clamped } }
    const newTemplates = {
      ...tmpl,
      [id]: { ...current, schedule: newSchedule },
    }
    onChange({ ...settings, templates: newTemplates, activeTemplateId: id })
  }

  const handleSetAll = (field, value) => {
    const clamped = field === 'hour'
      ? Math.max(0, Math.min(23, parseInt(value) || 0))
      : Math.max(0, Math.min(59, parseInt(value) || 0))

    const { id, templates: tmpl } = ensureEditable()
    const current = migrateTemplate(tmpl[id] || activeTemplate)
    const newSchedule = {}
    for (const d of DAYS) {
      newSchedule[d] = { ...current.schedule[d], [field]: clamped }
    }
    const newTemplates = {
      ...tmpl,
      [id]: { ...current, schedule: newSchedule },
    }
    onChange({ ...settings, templates: newTemplates, activeTemplateId: id })
  }

  const handleSaveAs = () => {
    const name = prompt('Template name:')
    if (!name || !name.trim()) return
    const newId = generateId()
    const newTemplates = {
      ...templates,
      [newId]: { name: name.trim(), builtin: false, schedule: JSON.parse(JSON.stringify(schedule)) },
    }
    onChange({ ...settings, templates: newTemplates, activeTemplateId: newId })
  }

  const handleStartRename = () => {
    if (activeTemplate.builtin) return
    setRenameId(activeId)
    setRenameValue(activeTemplate.name)
  }

  const handleFinishRename = () => {
    if (!renameId || !renameValue.trim()) {
      setRenameId(null)
      return
    }
    const newTemplates = {
      ...templates,
      [renameId]: { ...migrateTemplate(templates[renameId]), name: renameValue.trim() },
    }
    onChange({ ...settings, templates: newTemplates })
    setRenameId(null)
  }

  const handleDelete = () => {
    if (activeTemplate.builtin) return
    const newTemplates = { ...templates }
    delete newTemplates[activeId]
    onChange({ ...settings, templates: newTemplates, activeTemplateId: 'fx-default' })
  }

  const templateIds = Object.keys(templates)

  // Check if all days have the same time (for the "All" row)
  const allSame = DAYS.every(d => schedule[d].hour === schedule[DAYS[0]].hour && schedule[d].minute === schedule[DAYS[0]].minute)

  return (
    <div className={`session-controls-wrapper${inline ? ' inline' : ''}`}>
      <button className="session-toggle-btn" onClick={() => setIsOpen(!isOpen)}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
        </svg>
        <span>{formatTime(monStart.hour, monStart.minute)}</span>
      </button>

      {isOpen && (
        <div className="session-dropdown">
          <div className="session-dropdown-header">
            <span>Session Boundaries</span>
            <button className="session-close-btn" onClick={() => setIsOpen(false)}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="session-dropdown-body">
            <div className="session-field">
              <label className="session-label">Template</label>
              {renameId === activeId ? (
                <input
                  className="session-rename-input"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={handleFinishRename}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleFinishRename() }}
                  autoFocus
                />
              ) : (
                <select
                  className="session-template-select"
                  value={activeId}
                  onChange={handleTemplateChange}
                >
                  {templateIds.map((id) => (
                    <option key={id} value={id}>{migrateTemplate(templates[id]).name}</option>
                  ))}
                </select>
              )}
            </div>

            <div className="session-schedule">
              <div className="session-schedule-header">
                <span>Close Day</span>
                <span>Hour</span>
                <span>Min</span>
                <span>Open</span>
                <span>Close</span>
              </div>

              {/* "All" row for setting all days at once */}
              <div className="session-schedule-row session-schedule-all">
                <span className="session-day-label">All</span>
                <input
                  type="number"
                  className="session-time-input"
                  value={allSame ? schedule[DAYS[0]].hour : ''}
                  placeholder="—"
                  onChange={(e) => handleSetAll('hour', e.target.value)}
                  min={0}
                  max={23}
                />
                <input
                  type="number"
                  className="session-time-input"
                  value={allSame ? schedule[DAYS[0]].minute : ''}
                  placeholder="—"
                  onChange={(e) => handleSetAll('minute', e.target.value)}
                  min={0}
                  max={59}
                />
                <span></span>
                <span></span>
              </div>

              {DAYS.map((day, i) => {
                const s = schedule[day]
                const open = getOpenTime(schedule, i)
                return (
                  <div key={day} className="session-schedule-row">
                    <span className="session-day-label">{DAY_LABELS[i]}</span>
                    <input
                      type="number"
                      className="session-time-input"
                      value={s.hour}
                      onChange={(e) => handleDayChange(day, 'hour', e.target.value)}
                      min={0}
                      max={23}
                    />
                    <input
                      type="number"
                      className="session-time-input"
                      value={s.minute}
                      onChange={(e) => handleDayChange(day, 'minute', e.target.value)}
                      min={0}
                      max={59}
                    />
                    <span className="mono session-computed">{open.day} {formatTime(open.hour, open.minute)}</span>
                    <span className="mono session-computed">{DAY_LABELS[i].slice(0, 3)} {formatTime(s.hour, s.minute)}</span>
                  </div>
                )
              })}
            </div>

            <div className="session-actions">
              <button className="session-action-btn" onClick={handleSaveAs}>Save As</button>
              <button
                className="session-action-btn"
                onClick={handleStartRename}
                disabled={activeTemplate.builtin}
              >
                Rename
              </button>
              <button
                className="session-action-btn session-action-delete"
                onClick={handleDelete}
                disabled={activeTemplate.builtin}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export { getDefaultSettings, migrateTemplate, DAYS }
export default SessionControls
