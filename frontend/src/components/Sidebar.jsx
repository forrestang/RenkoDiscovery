import { useState } from 'react'
import './Sidebar.css'

const STORAGE_PREFIX = 'RenkoDiscovery_'

function Sidebar({
  collapsed,
  onToggleCollapse,
  activeTab,
  onTabChange,
  workingDir,
  onWorkingDirChange,
  files,
  selectedFiles,
  onFileSelect,
  onSelectAll,
  onProcess,
  isProcessing,
  processingResults,
  cachedInstruments,
  activeInstrument,
  onLoadChart,
  // Cache management
  onDeleteCache,
  onDeleteAllCache,
  // Data import settings
  dataFormat,
  onDataFormatChange,
  intervalType,
  onIntervalTypeChange,
  customName,
  onCustomNameChange
}) {
  const [isEditingDir, setIsEditingDir] = useState(false)
  const [dirInput, setDirInput] = useState(workingDir)
  const [adrPeriod, setAdrPeriod] = useState(14)
  const [workingDirCollapsed, setWorkingDirCollapsed] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}workingDirCollapsed`)
    return saved === 'true'
  })

  const toggleWorkingDirCollapsed = () => {
    const newValue = !workingDirCollapsed
    setWorkingDirCollapsed(newValue)
    localStorage.setItem(`${STORAGE_PREFIX}workingDirCollapsed`, newValue.toString())
  }

  // Group files by instrument
  const groupedFiles = files.reduce((acc, file) => {
    const instrument = file.instrument || 'Unknown'
    if (!acc[instrument]) acc[instrument] = []
    acc[instrument].push(file)
    return acc
  }, {})

  const selectedCount = selectedFiles.length
  const instruments = Object.keys(groupedFiles).sort()

  // Get detected instrument from selected files
  const detectedInstrument = selectedFiles.length > 0
    ? files.find(f => selectedFiles.includes(f.filepath))?.instrument || 'Unknown'
    : ''

  if (collapsed) {
    return (
      <div className="sidebar-collapsed">
        <button className="collapse-btn" onClick={onToggleCollapse} title="Expand sidebar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <div className="collapsed-tabs">
          <button
            className={`collapsed-tab ${activeTab === 'data' ? 'active' : ''}`}
            onClick={() => { onToggleCollapse(); onTabChange('data') }}
            title="Data"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3z" />
              <path d="M4 12h16" />
              <path d="M12 4v16" />
            </svg>
          </button>
          <button
            className={`collapsed-tab ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => { onToggleCollapse(); onTabChange('stats') }}
            title="Stats"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 20V10" />
              <path d="M12 20V4" />
              <path d="M6 20v-6" />
            </svg>
          </button>
          <button
            className={`collapsed-tab ${activeTab === 'ml' ? 'active' : ''}`}
            onClick={() => { onToggleCollapse(); onTabChange('ml') }}
            title="ML"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4" />
              <path d="M12 18v4" />
              <path d="M4.93 4.93l2.83 2.83" />
              <path d="M16.24 16.24l2.83 2.83" />
              <path d="M2 12h4" />
              <path d="M18 12h4" />
              <path d="M4.93 19.07l2.83-2.83" />
              <path d="M16.24 7.76l2.83-2.83" />
            </svg>
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="sidebar-content">
      <div className="sidebar-header">
        <div className="tabs">
          <button
            className={`tab ${activeTab === 'data' ? 'active' : ''}`}
            onClick={() => onTabChange('data')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3z" />
              <path d="M4 12h16" />
              <path d="M12 4v16" />
            </svg>
            Data
          </button>
          <button
            className={`tab ${activeTab === 'stats' ? 'active' : ''}`}
            onClick={() => onTabChange('stats')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M18 20V10" />
              <path d="M12 20V4" />
              <path d="M6 20v-6" />
            </svg>
            Stats
          </button>
          <button
            className={`tab ${activeTab === 'ml' ? 'active' : ''}`}
            onClick={() => onTabChange('ml')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v4" />
              <path d="M12 18v4" />
              <path d="M4.93 4.93l2.83 2.83" />
              <path d="M16.24 16.24l2.83 2.83" />
              <path d="M2 12h4" />
              <path d="M18 12h4" />
              <path d="M4.93 19.07l2.83-2.83" />
              <path d="M16.24 7.76l2.83-2.83" />
            </svg>
            ML
          </button>
        </div>
        <button className="collapse-btn" onClick={onToggleCollapse} title="Collapse sidebar">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      {activeTab === 'data' && (
        <div className="tab-content">
          {/* Working Directory - Collapsible */}
          <div className="section collapsible-section">
            <div
              className="section-header clickable"
              onClick={toggleWorkingDirCollapsed}
            >
              <div className="section-header-left">
                <svg
                  className={`collapse-chevron ${workingDirCollapsed ? 'collapsed' : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
                <span className="section-title">Working Directory</span>
              </div>
              {!workingDirCollapsed && !isEditingDir && (
                <button
                  className="edit-dir-btn"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDirInput(workingDir)
                    setIsEditingDir(true)
                  }}
                  title="Edit working directory"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
              )}
            </div>
            {!workingDirCollapsed && (
              <>
                {isEditingDir ? (
                  <div className="working-dir-edit">
                    <input
                      type="text"
                      className="working-dir-input mono"
                      value={dirInput}
                      onChange={(e) => setDirInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && dirInput.trim()) {
                          onWorkingDirChange(dirInput.trim())
                          setIsEditingDir(false)
                        } else if (e.key === 'Escape') {
                          setIsEditingDir(false)
                        }
                      }}
                      autoFocus
                    />
                    <div className="working-dir-actions">
                      <button
                        className="dir-action-btn save"
                        onClick={() => {
                          if (dirInput.trim()) {
                            onWorkingDirChange(dirInput.trim())
                            setIsEditingDir(false)
                          }
                        }}
                        title="Save"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M5 12l5 5L20 7" />
                        </svg>
                      </button>
                      <button
                        className="dir-action-btn cancel"
                        onClick={() => setIsEditingDir(false)}
                        title="Cancel"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="working-dir mono" title={workingDir}>
                    {workingDir}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Source Files - Scrollable */}
          <div className="section scrollable-section">
            <div className="section-header">
              <span className="section-title">Source Files</span>
              <span className="file-count">{files.length} files</span>
            </div>
            <div className="scrollable-content">
              <div className="file-list">
                {instruments.map(instrument => {
                  const instrumentFiles = groupedFiles[instrument]
                  const allSelected = instrumentFiles.every(f => selectedFiles.includes(f.filepath))
                  const someSelected = instrumentFiles.some(f => selectedFiles.includes(f.filepath))

                  return (
                    <div key={instrument} className="instrument-group">
                      <div
                        className={`instrument-header ${someSelected ? 'has-selection' : ''}`}
                        onClick={() => onSelectAll(instrument)}
                      >
                        <span className={`checkbox ${allSelected ? 'checked' : someSelected ? 'partial' : ''}`}>
                          {allSelected ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <path d="M5 12l5 5L20 7" />
                            </svg>
                          ) : someSelected ? (
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                              <path d="M5 12h14" />
                            </svg>
                          ) : null}
                        </span>
                        <span className="instrument-name mono">{instrument}</span>
                        <span className="instrument-count">{instrumentFiles.length}</span>
                      </div>
                      <div className="instrument-files">
                        {instrumentFiles.map(file => (
                          <div
                            key={file.filepath}
                            className={`file-item ${selectedFiles.includes(file.filepath) ? 'selected' : ''}`}
                            onClick={() => onFileSelect(file.filepath)}
                          >
                            <span className={`checkbox ${selectedFiles.includes(file.filepath) ? 'checked' : ''}`}>
                              {selectedFiles.includes(file.filepath) && (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                  <path d="M5 12l5 5L20 7" />
                                </svg>
                              )}
                            </span>
                            <span className="file-name mono truncate" title={file.filename}>
                              {file.filename}
                            </span>
                            <span className="file-size mono">
                              {(file.size_bytes / 1024 / 1024).toFixed(1)}MB
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {selectedCount > 0 && (
            <div className="import-settings-section">
              <div className="section-header">
                <span className="section-title">Import Settings</span>
              </div>

              {/* Format and Interval Selection */}
              <div className="import-options">
                <div className="option-group">
                  <label className="option-label">Format</label>
                  <div className="toggle-group">
                    <button
                      className={`toggle-option ${dataFormat === 'MT4' ? 'active' : ''}`}
                      onClick={() => onDataFormatChange('MT4')}
                    >
                      MT4
                    </button>
                    <button
                      className={`toggle-option ${dataFormat === 'J4X' ? 'active' : ''}`}
                      onClick={() => onDataFormatChange('J4X')}
                    >
                      J4X
                    </button>
                  </div>
                </div>

                <div className="option-group">
                  <label className="option-label">Interval</label>
                  <div className="toggle-group">
                    <button
                      className={`toggle-option ${intervalType === 'M' ? 'active' : ''}`}
                      onClick={() => onIntervalTypeChange('M')}
                      disabled={dataFormat === 'MT4'}
                      title={dataFormat === 'MT4' ? 'MT4 only supports minute data' : 'Minute data (M1)'}
                    >
                      Minute
                    </button>
                    <button
                      className={`toggle-option ${intervalType === 'T' ? 'active' : ''}`}
                      onClick={() => onIntervalTypeChange('T')}
                      disabled={dataFormat === 'MT4'}
                      title={dataFormat === 'MT4' ? 'MT4 only supports minute data' : 'Tick data'}
                    >
                      Tick
                    </button>
                  </div>
                </div>
              </div>

              {/* Custom Name Input */}
              <div className="custom-name-group">
                <label className="option-label">Output Name</label>
                <input
                  type="text"
                  className="custom-name-input mono"
                  value={customName}
                  onChange={(e) => onCustomNameChange(e.target.value)}
                  placeholder={detectedInstrument || 'Auto-detect'}
                />
                {detectedInstrument && !customName && (
                  <span className="detected-hint">Detected: {detectedInstrument}</span>
                )}
              </div>

              <div className="process-bar">
                <button
                  className="process-btn"
                  onClick={onProcess}
                  disabled={isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <span className="spinner" />
                      Processing...
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                      </svg>
                      Process {selectedCount} file{selectedCount > 1 ? 's' : ''}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {processingResults && (
            <div className="section results-section">
              <div className="section-header">
                <span className="section-title">Results</span>
              </div>
              <div className="results-list">
                {processingResults.map((result, i) => (
                  <div key={i} className={`result-item ${result.status}`}>
                    <span className="result-icon">
                      {result.status === 'success' ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M8 12l3 3 5-6" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10" />
                          <path d="M15 9l-6 6M9 9l6 6" />
                        </svg>
                      )}
                    </span>
                    <div className="result-info">
                      <span className="result-instrument mono">{result.instrument}</span>
                      {result.status === 'success' && (
                        <span className="result-rows">{result.rows.toLocaleString()} rows</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Cached Data - Scrollable */}
          {cachedInstruments.length > 0 && (
            <div className="section scrollable-section cache-section">
              <div className="section-header">
                <span className="section-title">Cached Data</span>
                <button
                  className="delete-all-btn"
                  onClick={onDeleteAllCache}
                  title="Delete all cached data"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                  </svg>
                  Clear All
                </button>
              </div>
              <div className="scrollable-content">
                <div className="cache-list">
                  {cachedInstruments.map(item => (
                    <div
                      key={item.instrument}
                      className={`cache-item ${activeInstrument === item.instrument ? 'active' : ''}`}
                    >
                      <button
                        className="cache-item-main"
                        onClick={() => onLoadChart(item.instrument)}
                        title={item.date_range ? `${item.date_range.start?.split('T')[0]} to ${item.date_range.end?.split('T')[0]}` : ''}
                      >
                        <div className="cache-item-info">
                          <span className="cache-instrument mono">{item.instrument}</span>
                          <div className="cache-tags">
                            {item.data_format && (
                              <span className={`cache-tag format-tag ${item.data_format.toLowerCase()}`}>
                                {item.data_format}
                              </span>
                            )}
                            {item.interval_type && (
                              <span className={`cache-tag interval-tag ${item.interval_type.toLowerCase()}`}>
                                {item.interval_type === 'M' ? 'Min' : 'Tick'}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="cache-meta">
                          {item.rows && (
                            <span className="cache-rows mono">{item.rows.toLocaleString()} rows</span>
                          )}
                          <span className="cache-size mono">
                            {(item.size_bytes / 1024 / 1024).toFixed(1)}MB
                          </span>
                        </div>
                      </button>
                      <button
                        className="cache-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDeleteCache(item.instrument)
                        }}
                        title={`Delete ${item.instrument}`}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'stats' && (
        <div className="tab-content stats-tab">
          <div className="section">
            <div className="section-header">
              <span className="section-title">ADR Settings</span>
            </div>
            <div className="stats-input-group">
              <label className="option-label">ADR Period</label>
              <input
                type="number"
                className="stats-input mono"
                value={adrPeriod}
                onChange={(e) => setAdrPeriod(parseInt(e.target.value) || 1)}
                min="1"
                max="100"
              />
            </div>
          </div>

          <div className="stats-spacer" />

          <div className="stats-actions">
            <button className="run-stats-btn">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              Run Stats
            </button>
          </div>
        </div>
      )}

      {activeTab === 'ml' && (
        <div className="tab-content ml-tab">
          <div className="section">
            <div className="section-header">
              <span className="section-title">Machine Learning</span>
            </div>
            <div className="ml-placeholder">
              <span className="placeholder-text">ML features coming soon</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Sidebar
