import { useState, useRef, useEffect } from 'react'
import ReactDOM from 'react-dom'
import SessionControls from './SessionControls'
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
  onCustomNameChange,
  // Session schedule (for import)
  sessionSettings,
  onSessionSettingsChange,
  // Data cleaning/adjustment
  cleanHolidays,
  onCleanHolidaysChange,
  cleanThresholdPct,
  onCleanThresholdPctChange,
  backAdjust,
  onBackAdjustChange,
  // Stats generation
  onRunStats,
  isRunningStats,
  renkoSettings,
  maSettings,
  // Stats files
  statsFiles,
  selectedStatsFile,
  onStatsFileSelect,
  onShowStats,
  onShowParquet,
  onExportCSV,
  isLoadingStats,
  isLoadingParquet,
  isExportingCSV,
  onDeleteStatsFile,
  onDeleteAllStatsFiles,
  isLoading,
  // ML props
  mlColumns,
  mlSelectedFeatures,
  onMlSelectedFeaturesChange,
  mlTargetColumn,
  onMlTargetColumnChange,
  mlWinThreshold,
  onMlWinThresholdChange,
  mlFilterExpr,
  onMlFilterExprChange,
  mlModelName,
  onMlModelNameChange,
  mlSourceParquet,
  onMlSourceParquetChange,
  onFetchMLColumns,
  onMLTrain,
  isTrainingML,
  mlModels,
  onLoadMLReport,
  onDeleteMLModel,
  onDeleteAllMLModels,
  mlError
}) {
  const [isEditingDir, setIsEditingDir] = useState(false)
  const [dirInput, setDirInput] = useState(workingDir)
  const [adrPeriod, setAdrPeriod] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}adrPeriod`)
    return saved ? parseInt(saved) : 14
  })
  const [chopPeriod, setChopPeriod] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}chopPeriod`)
    return saved ? parseInt(saved) : 20
  })
  const [statsFilename, setStatsFilename] = useState('')
  const [showFilterHelp, setShowFilterHelp] = useState(false)
  const [helpPos, setHelpPos] = useState({ x: 200, y: 100 })
  const [dragging, setDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const [workingDirCollapsed, setWorkingDirCollapsed] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}workingDirCollapsed`)
    return saved === 'true'
  })

  const toggleWorkingDirCollapsed = () => {
    const newValue = !workingDirCollapsed
    setWorkingDirCollapsed(newValue)
    localStorage.setItem(`${STORAGE_PREFIX}workingDirCollapsed`, newValue.toString())
  }

  useEffect(() => {
    if (!dragging) return
    const onMouseMove = (e) => {
      setHelpPos({ x: e.clientX - dragOffset.current.x, y: e.clientY - dragOffset.current.y })
    }
    const onMouseUp = () => setDragging(false)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [dragging])

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
                  onClick={async (e) => {
                    e.stopPropagation()
                    if (window.electronAPI) {
                      const dir = await window.electronAPI.selectFolder()
                      if (dir) onWorkingDirChange(dir)
                    } else {
                      setDirInput(workingDir)
                      setIsEditingDir(true)
                    }
                  }}
                  title="Change working directory"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
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

              {/* Session Schedule */}
              <div className="import-subsection">
                <label className="option-label">Session Schedule</label>
                <SessionControls settings={sessionSettings} onChange={onSessionSettingsChange} inline />
              </div>

              {/* Data Cleaning Options */}
              <div className="import-subsection">
                <label className="option-label">Data Processing</label>
                <div className="checkbox-row">
                  <label className="checkbox-label" title="Remove sessions with abnormally low bar counts (holidays, half-days, bad data). The threshold sets the minimum % of the median session bar count — sessions below this are dropped.">
                    <input
                      type="checkbox"
                      checked={cleanHolidays}
                      onChange={(e) => onCleanHolidaysChange(e.target.checked)}
                    />
                    Clean holidays
                  </label>
                  {cleanHolidays && (
                    <div className="threshold-input">
                      <input
                        type="number"
                        className="compact-input mono"
                        value={cleanThresholdPct}
                        onChange={(e) => onCleanThresholdPctChange(parseFloat(e.target.value) || 50)}
                        min={10}
                        max={90}
                        step={5}
                      />
                      <span className="input-suffix">%</span>
                    </div>
                  )}
                </div>
                <div className="checkbox-row">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={backAdjust}
                      onChange={(e) => onBackAdjustChange(e.target.checked)}
                    />
                    Back-adjust gaps
                  </label>
                </div>
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
                          <span className="cache-instrument mono">
                          {item.instrument}
                          {activeInstrument === item.instrument && isLoading && (
                            <span className="spinner cache-spinner" />
                          )}
                        </span>
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
              <span className="section-title">User Settings</span>
            </div>
            <div className="stats-input-group">
              <label className="option-label">ADR Period</label>
              <input
                type="number"
                className="stats-input mono"
                value={adrPeriod}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 1
                  setAdrPeriod(value)
                  localStorage.setItem(`${STORAGE_PREFIX}adrPeriod`, value.toString())
                }}
                min="1"
                max="100"
              />
            </div>
            <div className="stats-input-group">
              <label className="option-label">Chop Period</label>
              <input
                type="number"
                className="stats-input mono"
                value={chopPeriod}
                onChange={(e) => {
                  const value = parseInt(e.target.value) || 2
                  setChopPeriod(value)
                  localStorage.setItem(`${STORAGE_PREFIX}chopPeriod`, value.toString())
                }}
                min="2"
                max="200"
              />
            </div>
          </div>

          <div className="stats-spacer" />

          <div className="stats-actions">
            <div className="stats-input-group">
              <label className="option-label">Output Filename</label>
              <input
                type="text"
                className="stats-input mono"
                value={statsFilename}
                onChange={(e) => setStatsFilename(e.target.value)}
                placeholder="stats_output"
              />
              <span className="stats-file-hint">.parquet</span>
            </div>
            <button
              className="run-stats-btn"
              onClick={() => onRunStats?.({
                filename: statsFilename || 'stats_output',
                adrPeriod,
                chopPeriod,
                brickSize: renkoSettings?.brickSize,
                reversalSize: renkoSettings?.reversalSize,
                wickMode: renkoSettings?.wickMode,
                ma1Period: maSettings?.ma1?.period,
                ma2Period: maSettings?.ma2?.period,
                ma3Period: maSettings?.ma3?.period
              })}
              disabled={isRunningStats}
            >
              {isRunningStats ? (
                <>
                  <span className="spinner" />
                  Generating...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polygon points="5 3 19 12 5 21 5 3" />
                  </svg>
                  Generate Parquet
                </>
              )}
            </button>
          </div>

        {/* Stats Files Section */}
        <div className="section stats-files-section">
          <div className="section-header">
            <span className="section-title">Parquet Files</span>
            <span className="file-count">{statsFiles?.length || 0} files</span>
            {statsFiles?.length > 0 && (
              <button
                className="delete-all-btn"
                onClick={() => {
                  if (window.confirm(`Delete all ${statsFiles.length} parquet files?`)) {
                    onDeleteAllStatsFiles?.()
                  }
                }}
                title="Delete all parquet files"
              >
                Delete All
              </button>
            )}
          </div>
          <div className="scrollable-content">
            <div className="file-list">
              {statsFiles?.length > 0 ? (
                statsFiles.map(file => (
                  <div
                    key={file.filepath}
                    className={`file-item stats-file-item ${selectedStatsFile === file.filepath ? 'selected' : ''}`}
                  >
                    <div
                      className="stats-file-main"
                      onClick={() => onStatsFileSelect(file.filepath)}
                    >
                      <span className={`radio ${selectedStatsFile === file.filepath ? 'checked' : ''}`}>
                        {selectedStatsFile === file.filepath && (
                          <span className="radio-dot" />
                        )}
                      </span>
                      <span className="file-name mono truncate" title={file.filename}>
                        {file.filename}
                      </span>
                      <span className="file-size mono">
                        {(file.size_bytes / 1024 / 1024).toFixed(1)}MB
                      </span>
                    </div>
                    <button
                      className="stats-file-delete-btn"
                      onClick={(e) => {
                        e.stopPropagation()
                        if (window.confirm(`Delete ${file.filename}?`)) {
                          onDeleteStatsFile?.(file.filepath)
                        }
                      }}
                      title={`Delete ${file.filename}`}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))
              ) : (
                <div className="empty-state">
                  <span className="empty-text">No parquet files in Stats folder</span>
                </div>
              )}
            </div>
          </div>
          {selectedStatsFile && (
            <button
              className="show-stats-btn"
              onClick={() => onShowStats?.(selectedStatsFile)}
              disabled={isLoadingStats}
            >
              {isLoadingStats ? (
                <>
                  <span className="spinner" />
                  Loading...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 20V10" />
                    <path d="M12 20V4" />
                    <path d="M6 20v-6" />
                  </svg>
                  Show Stats
                </>
              )}
            </button>
          )}
          {selectedStatsFile && (
            <button
              className="show-stats-btn"
              onClick={() => onShowParquet?.(selectedStatsFile)}
              disabled={isLoadingParquet}
            >
              {isLoadingParquet ? (
                <>
                  <span className="spinner" />
                  Loading...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <polyline points="14 2 14 8 20 8" />
                    <line x1="16" y1="13" x2="8" y2="13" />
                    <line x1="16" y1="17" x2="8" y2="17" />
                    <polyline points="10 9 9 9 8 9" />
                  </svg>
                  Show Parquet
                </>
              )}
            </button>
          )}
          {selectedStatsFile && (
            <button
              className="show-stats-btn"
              onClick={() => onExportCSV?.(selectedStatsFile)}
              disabled={isExportingCSV}
            >
              {isExportingCSV ? (
                <>
                  <span className="spinner" />
                  Exporting...
                </>
              ) : (
                <>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                  Export CSV
                </>
              )}
            </button>
          )}
        </div>
      </div>
      )}

      {activeTab === 'ml' && (
        <div className="tab-content ml-tab">
          {/* Source Data */}
          <div className="section">
            <div className="section-header">
              <span className="section-title">Source Data</span>
            </div>
            <div className="ml-source-list">
              {statsFiles.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-text">No stats files</span>
                </div>
              ) : (
                statsFiles.map(file => (
                  <label key={file.filepath} className={`ml-radio-item ${mlSourceParquet === file.filepath ? 'selected' : ''}`}>
                    <input
                      type="radio"
                      name="ml-source"
                      checked={mlSourceParquet === file.filepath}
                      onChange={() => onMlSourceParquetChange(file.filepath)}
                    />
                    <span className="ml-radio-name">{file.filename}</span>
                  </label>
                ))
              )}
            </div>
            {mlSourceParquet && (
              <button
                className="ml-load-cols-btn"
                onClick={() => onFetchMLColumns(mlSourceParquet)}
              >
                Load Columns
              </button>
            )}
          </div>

          {/* Features */}
          {mlColumns && (
            <div className="section ml-features-section">
              <div className="section-header">
                <span className="section-title">
                  Features
                  <span className="ml-count-badge">
                    {mlSelectedFeatures.length}/{mlColumns.features.length}
                  </span>
                </span>
                <button
                  className="ml-toggle-all-btn"
                  onClick={() => {
                    if (mlSelectedFeatures.length === mlColumns.features.length) {
                      onMlSelectedFeaturesChange([])
                    } else {
                      onMlSelectedFeaturesChange([...mlColumns.features])
                    }
                  }}
                >
                  {mlSelectedFeatures.length === mlColumns.features.length ? 'None' : 'All'}
                </button>
              </div>
              <div className="ml-features-list">
                {mlColumns.features.map(col => (
                  <label key={col} className="ml-checkbox-item">
                    <input
                      type="checkbox"
                      checked={mlSelectedFeatures.includes(col)}
                      onChange={() => {
                        if (mlSelectedFeatures.includes(col)) {
                          onMlSelectedFeaturesChange(mlSelectedFeatures.filter(f => f !== col))
                        } else {
                          onMlSelectedFeaturesChange([...mlSelectedFeatures, col])
                        }
                      }}
                    />
                    <span className="ml-checkbox-name">{col}</span>
                  </label>
                ))}
              </div>
              <div className="ml-feature-tip">
                Tip: Keep at least 20 rows per feature to avoid the model finding coincidental patterns. Including extras is fine — unused features are ignored automatically.
              </div>
            </div>
          )}

          {/* Target */}
          {mlColumns && (
            <div className="section">
              <div className="section-header">
                <span className="section-title">Target</span>
              </div>
              <div className="ml-target-group">
                <select
                  className="form-select"
                  value={mlTargetColumn}
                  onChange={e => onMlTargetColumnChange(e.target.value)}
                >
                  <option value="">Select target...</option>
                  {mlColumns.targets.map(col => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
                <div className="ml-threshold-row">
                  <label className="form-label">Win threshold</label>
                  <input
                    type="number"
                    className="stats-input"
                    value={mlWinThreshold}
                    onChange={e => onMlWinThresholdChange(parseFloat(e.target.value) || 0)}
                    step="0.1"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Row Filter */}
          {mlColumns && (
            <div className="section">
              <div className="section-header">
                <span className="section-title">Row Filter</span>
                <button className="filter-help-btn" onClick={() => setShowFilterHelp(v => !v)} title="Query syntax help">?</button>
              </div>
              <input
                type="text"
                className="stats-input"
                placeholder="e.g. Type1 == 1"
                value={mlFilterExpr}
                onChange={e => onMlFilterExprChange(e.target.value)}
              />
            </div>
          )}

          {/* Filter Help Panel - rendered via portal */}
          {showFilterHelp && ReactDOM.createPortal(
            <div className="filter-help-panel" style={{ left: helpPos.x, top: helpPos.y }}>
              <div
                className={`filter-help-panel-header ${dragging ? 'grabbing' : ''}`}
                onMouseDown={(e) => {
                  dragOffset.current = { x: e.clientX - helpPos.x, y: e.clientY - helpPos.y }
                  setDragging(true)
                }}
              >
                <span className="filter-help-panel-title">Row Filter — Pandas Query Syntax</span>
                <button className="filter-help-close" onClick={() => setShowFilterHelp(false)}>&times;</button>
              </div>
              <div className="filter-help-panel-body">
                <p>The row filter accepts a <strong>pandas query expression</strong> to select which rows from the parquet file are included in training. Only matching rows will be used.</p>

                <h4>Operators</h4>
                <table className="filter-help-table">
                  <thead>
                    <tr><th>Operator</th><th>Meaning</th><th>Example</th></tr>
                  </thead>
                  <tbody>
                    <tr><td><code>==</code></td><td>equals</td><td><code>Type1 == 1</code></td></tr>
                    <tr><td><code>!=</code></td><td>not equal</td><td><code>State != 0</code></td></tr>
                    <tr><td><code>&gt;</code> <code>&gt;=</code></td><td>greater than</td><td><code>State &gt;= 2</code></td></tr>
                    <tr><td><code>&lt;</code> <code>&lt;=</code></td><td>less than</td><td><code>DD_RR &lt; 0.5</code></td></tr>
                    <tr><td><code>and</code></td><td>both conditions</td><td><code>Type1 == 1 and State &gt; 0</code></td></tr>
                    <tr><td><code>or</code></td><td>either condition</td><td><code>Type1 == 1 or Type2 == 1</code></td></tr>
                    <tr><td><code>in</code></td><td>matches any in list</td><td><code>State in [2, 3]</code></td></tr>
                    <tr><td><code>not in</code></td><td>excludes list</td><td><code>State not in [-1, 0, 1]</code></td></tr>
                  </tbody>
                </table>

                <h4>Examples</h4>
                <ul>
                  <li><code>Type1 == 1</code> — only Type1 signals</li>
                  <li><code>Type1 == 1 and State &gt;= 2</code> — Type1 in strong bullish alignment</li>
                  <li><code>(Type1 == 1 or Type2 == 1) and State &gt; 0</code> — either signal type, bullish only</li>
                  <li><code>State in [2, 3] and DD_RR &lt; 0.5</code> — strong trend with small wicks</li>
                </ul>

                <h4>Tips</h4>
                <ul>
                  <li>Column names are case-sensitive and must match exactly</li>
                  <li>Use <code>and</code> / <code>or</code> (not <code>&amp;&amp;</code> / <code>||</code>)</li>
                  <li>Group conditions with parentheses when mixing <code>and</code> and <code>or</code></li>
                  <li>Leave the filter blank to train on all rows</li>
                </ul>
              </div>
            </div>,
            document.body
          )}

          {/* Model Name */}
          {mlColumns && (
            <div className="section">
              <div className="section-header">
                <span className="section-title">Model Name</span>
              </div>
              <input
                type="text"
                className="stats-input"
                placeholder="my_model"
                value={mlModelName}
                onChange={e => onMlModelNameChange(e.target.value)}
              />
            </div>
          )}

          {/* Error display */}
          {mlError && (
            <div className="ml-error-banner">{mlError}</div>
          )}

          {/* Train Button */}
          {mlColumns && (
            <div className="ml-train-bar">
              <button
                className="ml-train-btn"
                disabled={isTrainingML || !mlTargetColumn || mlSelectedFeatures.length === 0 || !mlModelName}
                onClick={onMLTrain}
              >
                {isTrainingML ? (
                  <>
                    <span className="ml-btn-spinner" />
                    Training...
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Train Model
                  </>
                )}
              </button>
            </div>
          )}

          {/* Trained Models */}
          {mlModels.length > 0 && (
            <div className="section ml-models-section">
              <div className="section-header">
                <span className="section-title">Trained Models</span>
                <button
                  className="delete-all-btn"
                  onClick={() => {
                    if (window.confirm(`Delete all ${mlModels.length} trained models?`)) {
                      onDeleteAllMLModels?.()
                    }
                  }}
                  title="Delete all trained models"
                >
                  Delete All
                </button>
              </div>
              <div className="ml-models-list">
                {mlModels.map(model => (
                  <div key={model.name} className="ml-model-item">
                    <div className="ml-model-info">
                      <span className="ml-model-name">{model.name}</span>
                      {model.cv_accuracy != null && (
                        <span className="ml-model-acc">{(model.cv_accuracy * 100).toFixed(1)}%</span>
                      )}
                    </div>
                    {model.report_path && (
                      <button
                        className="ml-view-report-btn"
                        onClick={() => onLoadMLReport(model.report_path)}
                      >
                        View
                      </button>
                    )}
                    <button
                      className="ml-model-delete-btn"
                      onClick={() => {
                        if (window.confirm(`Delete model "${model.name}"?`)) {
                          onDeleteMLModel?.(model.name)
                        }
                      }}
                      title="Delete model"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default Sidebar
