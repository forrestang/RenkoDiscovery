import { useState, useRef, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'
import SessionControls from './SessionControls'
import { COLUMN_DESCRIPTIONS, ColumnItem } from '../utils/columnDescriptions'
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
  pendingInstrument,
  onLoadChart,
  // Cache management
  onDeleteCache,
  onDeleteAllCache,
  // Indicator signal export
  onExportIndicatorSignals,
  canExportIndicatorSignals,
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
  mlError,
  apiBase,
  onDirectGenerate,
  smaeSettings,
  pwapSettings
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
  const [mlSavedSignals, setMlSavedSignals] = useState([])
  const [showMlLoadDropdown, setShowMlLoadDropdown] = useState(false)
  const mlLoadDropdownRef = useRef(null)

  const [workingDirCollapsed, setWorkingDirCollapsed] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}workingDirCollapsed`)
    return saved === 'true'
  })

  const toggleWorkingDirCollapsed = () => {
    const newValue = !workingDirCollapsed
    setWorkingDirCollapsed(newValue)
    localStorage.setItem(`${STORAGE_PREFIX}workingDirCollapsed`, newValue.toString())
  }

  const [bypassJobsCollapsed, setBypassJobsCollapsed] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}bypassJobsCollapsed`)
    return saved === 'true'
  })

  const toggleBypassJobsCollapsed = () => {
    const newValue = !bypassJobsCollapsed
    setBypassJobsCollapsed(newValue)
    localStorage.setItem(`${STORAGE_PREFIX}bypassJobsCollapsed`, newValue.toString())
  }

  // ── Bypass sub-tab state ──────────────────────────────────────────────────
  const [statsMode, setStatsMode] = useState(() => {
    return localStorage.getItem(`${STORAGE_PREFIX}statsMode`) || 'standard'
  })

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}statsMode`, statsMode)
  }, [statsMode])

  const createDefaultBypassJob = useCallback(() => ({
    id: Date.now() + Math.random(),
    instrument: '',
    filename: '',
    filenameManual: false,
    sizingMode: 'price',
    brickSize: 0.0010,
    reversalSize: 0.0010,
    brickPct: 5.0,
    reversalPct: 5.0,
    adrPeriod: 14,
    wickMode: 'all',
    reversalMode: 'fp',
    ma1Period: 20,
    ma2Period: 50,
    ma3Period: 200,
    chopPeriod: 20,
    smae1Period: 20,
    smae1Deviation: 1.0,
    smae2Period: 50,
    smae2Deviation: 1.0,
    pwapSigmas: [1.0, 2.0, 2.5, 3.0],
    htfBrickSize: null,
    htfReversalMultiplier: 2.0,
    htfMa1Period: 20,
    htfMa2Period: 50,
    htfMa3Period: 200,
    htfSmae1Period: 20,
    htfSmae1Deviation: 1.0,
    htfSmae2Period: 50,
    htfSmae2Deviation: 1.0,
    templateName: '',
  }), [])

  const [bypassJobs, setBypassJobs] = useState(() => {
    try {
      const saved = localStorage.getItem(`${STORAGE_PREFIX}bypassJobs`)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed) && parsed.length > 0) return parsed
      }
    } catch {}
    return [{ id: Date.now(), instrument: '', filename: '', filenameManual: false, sizingMode: 'price', brickSize: 0.0010, reversalSize: 0.0010, brickPct: 5.0, reversalPct: 5.0, adrPeriod: 14, wickMode: 'all', reversalMode: 'fp', ma1Period: 20, ma2Period: 50, ma3Period: 200, chopPeriod: 20, smae1Period: 20, smae1Deviation: 1.0, smae2Period: 50, smae2Deviation: 1.0, pwapSigmas: [1.0, 2.0, 2.5, 3.0], htfBrickSize: null, htfReversalMultiplier: 2.0, htfMa1Period: 20, htfMa2Period: 50, htfMa3Period: 200, htfSmae1Period: 20, htfSmae1Deviation: 1.0, htfSmae2Period: 50, htfSmae2Deviation: 1.0 }]
  })
  const [isBypassing, setIsBypassing] = useState(false)
  const [bypassResults, setBypassResults] = useState(null)
  const [bypassTemplates, setBypassTemplates] = useState([])
  const [bypassTemplateName, setBypassTemplateName] = useState('')

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}bypassJobs`, JSON.stringify(bypassJobs))
  }, [bypassJobs])

  const autoBypassFilename = useCallback((job) => {
    if (!job.instrument) return ''
    let base
    if (job.sizingMode === 'adr') {
      base = `${job.instrument}_ADR${job.adrPeriod}_${job.brickPct}pct_${job.reversalMode || 'fp'}`
    } else {
      base = `${job.instrument}_${job.brickSize}_${job.reversalMode || 'fp'}`
    }
    if (job.htfBrickSize) return `${base}_O2`
    return base
  }, [])

  const updateBypassJob = useCallback((id, field, value) => {
    setBypassJobs(prev => prev.map(j => {
      if (j.id !== id) return j
      const updated = { ...j, [field]: value }
      // When O2 is enabled, force price sizing mode
      if (field === 'htfBrickSize' && value) {
        updated.sizingMode = 'price'
      }
      // Always derive reversal from brick + mode
      updated.reversalSize = updated.reversalMode === 'tv' ? updated.brickSize * 2 : updated.brickSize
      updated.reversalPct = updated.reversalMode === 'tv' ? updated.brickPct * 2 : updated.brickPct
      if (field === 'filename') {
        updated.filenameManual = value !== '' && value !== autoBypassFilename(j)
      } else if (['instrument', 'sizingMode', 'brickSize', 'brickPct', 'adrPeriod', 'reversalMode', 'htfBrickSize'].includes(field) && !j.filenameManual) {
        updated.filename = autoBypassFilename(updated)
      }
      return updated
    }))
  }, [autoBypassFilename])

  const addBypassJob = useCallback(() => {
    setBypassJobs(prev => [...prev, createDefaultBypassJob()])
  }, [createDefaultBypassJob])

  const removeBypassJob = useCallback((id) => {
    setBypassJobs(prev => prev.length > 1 ? prev.filter(j => j.id !== id) : prev)
  }, [])

  const duplicateBypassJob = useCallback((id) => {
    setBypassJobs(prev => {
      const src = prev.find(j => j.id === id)
      if (!src) return prev
      return [...prev, { ...src, id: Date.now() + Math.random() }]
    })
  }, [])

  const fetchBypassTemplates = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/bypass-templates?working_dir=${encodeURIComponent(workingDir || '')}`)
      if (res.ok) {
        const data = await res.json()
        setBypassTemplates(data.templates || [])
      }
    } catch {}
  }, [apiBase, workingDir])

  useEffect(() => { fetchBypassTemplates() }, [fetchBypassTemplates])

  const saveBypassTemplate = useCallback(async (name, job) => {
    if (!name.trim()) return
    try {
      await fetch(`${apiBase}/bypass-templates?working_dir=${encodeURIComponent(workingDir || '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          sizing_mode: job.sizingMode,
          brick_size: job.brickSize,
          reversal_size: job.reversalSize,
          brick_pct: job.brickPct,
          reversal_pct: job.reversalPct,
          adr_period: job.adrPeriod,
          wick_mode: job.wickMode,
          reversal_mode: job.reversalMode || 'fp',
          ma1_period: job.ma1Period,
          ma2_period: job.ma2Period,
          ma3_period: job.ma3Period,
          chop_period: job.chopPeriod,
          smae1_period: job.smae1Period,
          smae1_deviation: job.smae1Deviation,
          smae2_period: job.smae2Period,
          smae2_deviation: job.smae2Deviation,
          pwap_sigmas: job.pwapSigmas,
          ...(job.htfBrickSize ? {
            htf_brick_size: job.htfBrickSize,
            htf_reversal_multiplier: job.htfReversalMultiplier || 2.0,
            htf_ma1_period: job.htfMa1Period,
            htf_ma2_period: job.htfMa2Period,
            htf_ma3_period: job.htfMa3Period,
            htf_smae1_period: job.htfSmae1Period,
            htf_smae1_deviation: job.htfSmae1Deviation,
            htf_smae2_period: job.htfSmae2Period,
            htf_smae2_deviation: job.htfSmae2Deviation,
          } : {}),
        })
      })
      fetchBypassTemplates()
    } catch {}
  }, [apiBase, workingDir, fetchBypassTemplates])

  const deleteBypassTemplate = useCallback(async (name) => {
    try {
      await fetch(`${apiBase}/bypass-templates?name=${encodeURIComponent(name)}&working_dir=${encodeURIComponent(workingDir || '')}`, { method: 'DELETE' })
      fetchBypassTemplates()
    } catch {}
  }, [apiBase, workingDir, fetchBypassTemplates])

  const loadBypassTemplate = useCallback((jobId, template) => {
    setBypassJobs(prev => prev.map(j => {
      if (j.id !== jobId) return j
      const rMode = template.reversal_mode || 'fp'
      const brickSize = template.brick_size
      const brickPct = template.brick_pct
      const updated = {
        ...j,
        sizingMode: template.sizing_mode,
        brickSize,
        reversalSize: rMode === 'tv' ? brickSize * 2 : brickSize,
        brickPct,
        reversalPct: rMode === 'tv' ? brickPct * 2 : brickPct,
        adrPeriod: template.adr_period,
        wickMode: template.wick_mode,
        reversalMode: rMode,
        ma1Period: template.ma1_period,
        ma2Period: template.ma2_period,
        ma3Period: template.ma3_period,
        chopPeriod: template.chop_period,
        smae1Period: template.smae1_period ?? 20,
        smae1Deviation: template.smae1_deviation ?? 1.0,
        smae2Period: template.smae2_period ?? 50,
        smae2Deviation: template.smae2_deviation ?? 1.0,
        pwapSigmas: template.pwap_sigmas ?? [1.0, 2.0, 2.5, 3.0],
        htfBrickSize: template.htf_brick_size || null,
        htfReversalMultiplier: template.htf_reversal_multiplier ?? 2.0,
        htfMa1Period: template.htf_ma1_period ?? 20,
        htfMa2Period: template.htf_ma2_period ?? 50,
        htfMa3Period: template.htf_ma3_period ?? 200,
        htfSmae1Period: template.htf_smae1_period ?? 20,
        htfSmae1Deviation: template.htf_smae1_deviation ?? 1.0,
        htfSmae2Period: template.htf_smae2_period ?? 50,
        htfSmae2Deviation: template.htf_smae2_deviation ?? 1.0,
        templateName: template.name,
        filenameManual: false,
      }
      updated.filename = autoBypassFilename(updated)
      return updated
    }))
  }, [autoBypassFilename])

  const handleBypassGenerate = useCallback(async () => {
    const validJobs = bypassJobs.filter(j => j.instrument)
    if (validJobs.length === 0 || !onDirectGenerate) return
    setIsBypassing(true)
    setBypassResults(null)
    try {
      const payload = validJobs.map(j => ({
        instrument: j.instrument,
        filename: j.filename || autoBypassFilename(j),
        sizing_mode: j.sizingMode,
        brick_size: j.brickSize,
        reversal_size: j.reversalSize,
        brick_pct: j.brickPct,
        reversal_pct: j.reversalPct,
        adr_period: j.adrPeriod,
        wick_mode: j.wickMode,
        reversal_mode: j.reversalMode || 'fp',
        ma1_period: j.ma1Period,
        ma2_period: j.ma2Period,
        ma3_period: j.ma3Period,
        chop_period: j.chopPeriod,
        smae1_period: j.smae1Period,
        smae1_deviation: j.smae1Deviation,
        smae2_period: j.smae2Period,
        smae2_deviation: j.smae2Deviation,
        pwap_sigmas: j.pwapSigmas,
        ...(j.htfBrickSize ? {
          htf_brick_size: j.htfBrickSize,
          htf_reversal_multiplier: j.htfReversalMultiplier || 2.0,
          htf_ma1_period: j.htfMa1Period,
          htf_ma2_period: j.htfMa2Period,
          htf_ma3_period: j.htfMa3Period,
          htf_smae1_period: j.htfSmae1Period,
          htf_smae1_deviation: j.htfSmae1Deviation,
          htf_smae2_period: j.htfSmae2Period,
          htf_smae2_deviation: j.htfSmae2Deviation,
        } : {}),
      }))
      const results = await onDirectGenerate(payload)
      setBypassResults(results)
    } finally {
      setIsBypassing(false)
    }
  }, [bypassJobs, onDirectGenerate, autoBypassFilename])

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

  // Fetch saved signals for ML tab when source parquet changes
  useEffect(() => {
    if (!mlSourceParquet || !apiBase) { setMlSavedSignals([]); return }
    fetch(`${apiBase}/playground-saved-signals?filepath=${encodeURIComponent(mlSourceParquet)}`)
      .then(r => r.ok ? r.json() : { signals: [] })
      .then(data => setMlSavedSignals(data.signals || []))
      .catch(() => setMlSavedSignals([]))
  }, [mlSourceParquet, apiBase])

  // Close ML load dropdown on outside click
  useEffect(() => {
    if (!showMlLoadDropdown) return
    const handler = (e) => {
      if (mlLoadDropdownRef.current && !mlLoadDropdownRef.current.contains(e.target)) {
        setShowMlLoadDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showMlLoadDropdown])

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
                      Time
                    </button>
                    <button
                      className={`toggle-option ${intervalType === 'T' ? 'active' : ''}`}
                      onClick={() => onIntervalTypeChange('T')}
                      disabled={dataFormat === 'MT4'}
                      title={dataFormat === 'MT4' ? 'MT4 only supports minute data' : 'Tick data'}
                    >
                      Tick
                    </button>
                    <button
                      className={`toggle-option ${intervalType === 'B' ? 'active' : ''}`}
                      onClick={() => onIntervalTypeChange('B')}
                      disabled={dataFormat === 'MT4'}
                      title={dataFormat === 'MT4' ? 'MT4 only supports minute data' : '3-Tick bar data (OHLC from 3 ticks)'}
                    >
                      3-Tick
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
                      className={`cache-item ${pendingInstrument === item.instrument ? 'pending' : ''} ${activeInstrument === item.instrument && pendingInstrument !== item.instrument ? 'loaded' : ''}`}
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
                          {activeInstrument === item.instrument && !isLoading && (
                            <span className="loaded-tag">LOADED</span>
                          )}
                          <div className="cache-tags">
                            {item.data_format && (
                              <span className={`cache-tag format-tag ${item.data_format.toLowerCase()}`}>
                                {item.data_format}
                              </span>
                            )}
                            {item.interval_type && (
                              <span className={`cache-tag interval-tag ${item.interval_type.toLowerCase()}`}>
                                {item.interval_type === 'M' ? 'Min' : item.interval_type === 'B' ? '3-Tick' : 'Tick'}
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
          {canExportIndicatorSignals && (
            <div className="section">
              <button
                className="show-stats-btn"
                onClick={onExportIndicatorSignals}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 16, height: 16, marginRight: 6, flexShrink: 0 }}>
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                Export Indicator Signals
              </button>
            </div>
          )}
        </div>
      )}

      {activeTab === 'stats' && (
        <div className="tab-content stats-tab">
          {/* Sub-tab selector */}
          <div className="stats-mode-tabs">
            <button className={statsMode === 'standard' ? 'active' : ''} onClick={() => setStatsMode('standard')}>Standard</button>
            <button className={statsMode === 'bypass' ? 'active' : ''} onClick={() => setStatsMode('bypass')}>Bypass</button>
          </div>

          {statsMode === 'standard' && (
            <>
              <div className="section">
                <div className="section-header">
                  <span className="section-title">User Settings</span>
                </div>
                <div className="stats-input-group stats-input-row">
                  <label className="option-label">ADR</label>
                  <input
                    type="number"
                    className="stats-input mono no-spinners"
                    value={adrPeriod}
                    onChange={(e) => {
                      const value = parseInt(e.target.value) || 1
                      setAdrPeriod(value)
                      localStorage.setItem(`${STORAGE_PREFIX}adrPeriod`, value.toString())
                    }}
                    min="1"
                    max="100"
                  />
                  <label className="option-label">Chop</label>
                  <input
                    type="number"
                    className="stats-input mono no-spinners"
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
                    ma3Period: maSettings?.ma3?.period,
                    smae1Period: smaeSettings?.smae1?.period ?? 20,
                    smae1Deviation: smaeSettings?.smae1?.deviation ?? 1.0,
                    smae2Period: smaeSettings?.smae2?.period ?? 50,
                    smae2Deviation: smaeSettings?.smae2?.deviation ?? 1.0,
                    pwapSigmas: pwapSettings?.sigmas ?? [1.0, 2.0, 2.5, 3.0]
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
            </>
          )}

          {statsMode === 'bypass' && (
            <div className="bypass-content">
              {/* Template bar */}
              <div className="section">
                <div className="section-header">
                  <span className="section-title">Templates</span>
                </div>
                <div className="bypass-template-bar">
                  <input
                    type="text"
                    className="stats-input mono"
                    placeholder="Template name..."
                    value={bypassTemplateName}
                    onChange={e => setBypassTemplateName(e.target.value)}
                  />
                  <div className="bypass-template-actions">
                    <button
                      className="bypass-btn"
                      disabled={!bypassTemplateName.trim() || bypassJobs.length === 0}
                      onClick={() => {
                        if (bypassJobs.length > 0) {
                          saveBypassTemplate(bypassTemplateName, bypassJobs[0])
                          setBypassTemplateName('')
                        }
                      }}
                    >Save</button>
                    {bypassTemplates.length > 0 && (
                      <button
                        className="bypass-btn bypass-btn-danger"
                        disabled={!bypassTemplateName.trim()}
                        onClick={() => {
                          if (bypassTemplateName.trim()) {
                            deleteBypassTemplate(bypassTemplateName.trim())
                            setBypassTemplateName('')
                          }
                        }}
                      >Del</button>
                    )}
                  </div>
                </div>
              </div>

              {/* Job cards */}
              <div className="section collapsible-section">
                <div
                  className="section-header clickable"
                  onClick={toggleBypassJobsCollapsed}
                >
                  <div className="section-header-left">
                    <svg
                      className={`collapse-chevron ${bypassJobsCollapsed ? 'collapsed' : ''}`}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M6 9l6 6 6-6" />
                    </svg>
                    <span className="section-title">Jobs</span>
                  </div>
                  <span className="file-count">{bypassJobs.length}</span>
                </div>
                {!bypassJobsCollapsed && bypassJobs.map((job, i) => (
                  <div key={job.id} className="bypass-job-card">
                    <div className="bypass-job-header">
                      <span className="bypass-job-number">#{i + 1}</span>
                      <div className="bypass-job-actions">
                        <button className="bypass-btn bypass-btn-sm" title="Duplicate" onClick={() => duplicateBypassJob(job.id)}>Dup</button>
                        <button className="bypass-btn bypass-btn-sm bypass-btn-danger" title="Remove" onClick={() => removeBypassJob(job.id)} disabled={bypassJobs.length <= 1}>Del</button>
                      </div>
                    </div>
                    {bypassTemplates.length > 0 && (
                      <div className="bypass-job-row">
                        <label className="option-label">Template</label>
                        <select
                          className="stats-input mono"
                          value={job.templateName || ''}
                          onChange={e => {
                            const tmpl = bypassTemplates.find(t => t.name === e.target.value)
                            if (tmpl) loadBypassTemplate(job.id, tmpl)
                          }}
                        >
                          <option value="" disabled>Apply...</option>
                          {bypassTemplates.map(t => (
                            <option key={t.name} value={t.name}>{t.name}</option>
                          ))}
                        </select>
                      </div>
                    )}
                    <div className="bypass-job-row">
                      <label className="option-label">.Feather File</label>
                      <select
                        className="stats-input mono"
                        value={job.instrument}
                        onChange={e => updateBypassJob(job.id, 'instrument', e.target.value)}
                      >
                        <option value="">Select...</option>
                        {(cachedInstruments || []).map(c => (
                          <option key={c.instrument} value={c.instrument}>{c.instrument}</option>
                        ))}
                      </select>
                    </div>
                    <div className="bypass-job-row">
                      <label className="option-label">Sizing</label>
                      {!job.htfBrickSize && (
                        <select
                          className="stats-input mono bypass-half-select"
                          value={job.sizingMode}
                          onChange={e => updateBypassJob(job.id, 'sizingMode', e.target.value)}
                        >
                          <option value="price">Price</option>
                          <option value="adr">ADR</option>
                        </select>
                      )}
                      <select className="stats-input mono bypass-half-select" value={job.wickMode} onChange={e => updateBypassJob(job.id, 'wickMode', e.target.value)}>
                        <option value="all">Wick: All</option>
                        <option value="big">Wick: Big</option>
                        <option value="none">Wick: None</option>
                      </select>
                      <select
                        className="stats-input mono bypass-half-select"
                        value={job.reversalMode || 'fp'}
                        onChange={e => updateBypassJob(job.id, 'reversalMode', e.target.value)}
                      >
                        <option value="fp">Rev: FP</option>
                        <option value="tv">Rev: TV</option>
                      </select>
                      <label className="option-label bypass-o2-label" title="Enable O2 (multi-timeframe)">
                        <input
                          type="checkbox"
                          checked={!!job.htfBrickSize}
                          onChange={e => {
                            if (e.target.checked) {
                              updateBypassJob(job.id, 'htfBrickSize', job.brickSize * 10)
                            } else {
                              updateBypassJob(job.id, 'htfBrickSize', null)
                            }
                          }}
                        />
                        O2
                      </label>
                    </div>
                    {job.sizingMode === 'price' ? (
                      <div className="bypass-job-row">
                        <label className="option-label">Brick</label>
                        <input type="number" className="stats-input mono" step="0.0001" value={job.brickSize} onChange={e => updateBypassJob(job.id, 'brickSize', parseFloat(e.target.value) || 0)} />
                      </div>
                    ) : (
                      <div className="bypass-job-row">
                        <label className="option-label">Brick%</label>
                        <input type="number" className="stats-input mono" step="0.5" value={job.brickPct} onChange={e => updateBypassJob(job.id, 'brickPct', parseFloat(e.target.value) || 0)} />
                      </div>
                    )}
                    {!!job.htfBrickSize && (
                      <div className="bypass-job-row">
                        <label className="option-label">HTF Brick</label>
                        <input type="number" className="stats-input mono" step="0.0001" value={job.htfBrickSize} onChange={e => { const v = parseFloat(e.target.value); if (v > 0) updateBypassJob(job.id, 'htfBrickSize', v) }} />
                      </div>
                    )}
                    <div className="bypass-job-row">
                      <label className="option-label">MA1</label>
                      <input type="number" className="stats-input mono bypass-input-sm" value={job.ma1Period} onChange={e => updateBypassJob(job.id, 'ma1Period', parseInt(e.target.value) || 20)} />
                      <label className="option-label">MA2</label>
                      <input type="number" className="stats-input mono bypass-input-sm" value={job.ma2Period} onChange={e => updateBypassJob(job.id, 'ma2Period', parseInt(e.target.value) || 50)} />
                      <label className="option-label">MA3</label>
                      <input type="number" className="stats-input mono bypass-input-sm" value={job.ma3Period} onChange={e => updateBypassJob(job.id, 'ma3Period', parseInt(e.target.value) || 200)} />
                    </div>
                    {!!job.htfBrickSize && (
                      <div className="bypass-job-row">
                        <label className="option-label">HTF MA1</label>
                        <input type="number" className="stats-input mono bypass-input-sm" value={job.htfMa1Period} onChange={e => updateBypassJob(job.id, 'htfMa1Period', parseInt(e.target.value) || 20)} />
                        <label className="option-label">MA2</label>
                        <input type="number" className="stats-input mono bypass-input-sm" value={job.htfMa2Period} onChange={e => updateBypassJob(job.id, 'htfMa2Period', parseInt(e.target.value) || 50)} />
                        <label className="option-label">MA3</label>
                        <input type="number" className="stats-input mono bypass-input-sm" value={job.htfMa3Period} onChange={e => updateBypassJob(job.id, 'htfMa3Period', parseInt(e.target.value) || 200)} />
                      </div>
                    )}
                    <div className="bypass-job-row">
                      <label className="option-label">ADR</label>
                      <input type="number" className="stats-input mono bypass-input-sm" value={job.adrPeriod} onChange={e => updateBypassJob(job.id, 'adrPeriod', parseInt(e.target.value) || 14)} />
                      <label className="option-label">Chop</label>
                      <input type="number" className="stats-input mono bypass-input-sm" value={job.chopPeriod} onChange={e => updateBypassJob(job.id, 'chopPeriod', parseInt(e.target.value) || 20)} />
                    </div>
                    <div className="bypass-job-row">
                      <label className="option-label">ENV1</label>
                      <input type="number" className="stats-input mono bypass-input-sm" value={job.smae1Period} onChange={e => updateBypassJob(job.id, 'smae1Period', parseInt(e.target.value) || 20)} />
                      <label className="option-label">Dev</label>
                      <input type="number" className="stats-input mono bypass-input-sm" step="0.1" value={job.smae1Deviation} onChange={e => updateBypassJob(job.id, 'smae1Deviation', parseFloat(e.target.value) || 1.0)} />
                      <label className="option-label">ENV2</label>
                      <input type="number" className="stats-input mono bypass-input-sm" value={job.smae2Period} onChange={e => updateBypassJob(job.id, 'smae2Period', parseInt(e.target.value) || 50)} />
                      <label className="option-label">Dev</label>
                      <input type="number" className="stats-input mono bypass-input-sm" step="0.1" value={job.smae2Deviation} onChange={e => updateBypassJob(job.id, 'smae2Deviation', parseFloat(e.target.value) || 1.0)} />
                    </div>
                    {!!job.htfBrickSize && (
                      <div className="bypass-job-row">
                        <label className="option-label">HTF ENV1</label>
                        <input type="number" className="stats-input mono bypass-input-sm" value={job.htfSmae1Period} onChange={e => updateBypassJob(job.id, 'htfSmae1Period', parseInt(e.target.value) || 20)} />
                        <label className="option-label">Dev</label>
                        <input type="number" className="stats-input mono bypass-input-sm" step="0.1" value={job.htfSmae1Deviation} onChange={e => updateBypassJob(job.id, 'htfSmae1Deviation', parseFloat(e.target.value) || 1.0)} />
                        <label className="option-label">ENV2</label>
                        <input type="number" className="stats-input mono bypass-input-sm" value={job.htfSmae2Period} onChange={e => updateBypassJob(job.id, 'htfSmae2Period', parseInt(e.target.value) || 50)} />
                        <label className="option-label">Dev</label>
                        <input type="number" className="stats-input mono bypass-input-sm" step="0.1" value={job.htfSmae2Deviation} onChange={e => updateBypassJob(job.id, 'htfSmae2Deviation', parseFloat(e.target.value) || 1.0)} />
                      </div>
                    )}
                    <div className="bypass-job-row">
                      <label className="option-label">PWAP σ</label>
                      {(job.pwapSigmas || [1.0, 2.0, 2.5, 3.0]).map((sigma, si) => (
                        <input key={si} type="number" className="stats-input mono bypass-input-sm" step="0.1" value={sigma}
                          onChange={e => {
                            const newSigmas = [...(job.pwapSigmas || [1.0, 2.0, 2.5, 3.0])]
                            newSigmas[si] = parseFloat(e.target.value) || 0
                            updateBypassJob(job.id, 'pwapSigmas', newSigmas)
                          }}
                        />
                      ))}
                    </div>
                    <div className="bypass-job-row">
                      <label className="option-label">File</label>
                      <input
                        type="text"
                        className="stats-input mono"
                        value={job.filename}
                        placeholder={autoBypassFilename(job) || 'filename'}
                        onChange={e => updateBypassJob(job.id, 'filename', e.target.value)}
                      />
                      <span className="stats-file-hint">.parquet</span>
                    </div>
                  </div>
                ))}
                {!bypassJobsCollapsed && (
                  <button className="bypass-btn bypass-add-btn" onClick={addBypassJob}>+ Add Job</button>
                )}
              </div>

              {/* Generate button */}
              <button
                className="run-stats-btn"
                disabled={isBypassing || bypassJobs.filter(j => j.instrument).length === 0}
                onClick={handleBypassGenerate}
              >
                {isBypassing ? (
                  <>
                    <span className="spinner" />
                    Generating...
                  </>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="5 3 19 12 5 21 5 3" />
                    </svg>
                    Generate {bypassJobs.filter(j => j.instrument).length} Parquet(s)
                  </>
                )}
              </button>

              {/* Results */}
              {bypassResults && (
                <div className="bypass-results">
                  {bypassResults.map((r, i) => (
                    <div key={i} className={`bypass-result-item ${r.status === 'success' ? 'success' : 'error'}`}>
                      {r.status === 'success'
                        ? `${r.instrument} → ${r.filename}.parquet (${r.rows} rows)`
                        : `${r.instrument || 'Error'}: ${r.error}`
                      }
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Parquet Files section — SHARED, always visible regardless of mode */}
          <div className="section stats-files-section">
            <div className="section-header">
              <span className="section-title">Parquet Files</span>
              <span className="file-count">{statsFiles?.length || 0} files</span>
              {statsFiles?.length > 0 && (
                <button
                  className="delete-all-btn"
                  onClick={() => onDeleteAllStatsFiles?.()}
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
                          onDeleteStatsFile?.(file.filepath)
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
                <div className="playground-load-wrapper" ref={mlLoadDropdownRef}>
                  <button className="filter-action-btn" onClick={() => setShowMlLoadDropdown(v => !v)}>Load ▼</button>
                  {showMlLoadDropdown && (
                    <div className="playground-load-dropdown">
                      {mlSavedSignals.length === 0 ? (
                        <div className="playground-load-empty">No saved signals</div>
                      ) : (
                        mlSavedSignals.map(s => (
                          <div key={s.name} className="playground-load-item"
                            onClick={() => { onMlFilterExprChange(s.expression); setShowMlLoadDropdown(false) }}
                          >
                            <span className="playground-load-name">{s.name}</span>
                            <span className="playground-load-expr">{s.expression}</span>
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
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

                <h4>Available Columns</h4>

                <h5>System</h5>
                <ul>
                  <ColumnItem label="currentADR" desc={COLUMN_DESCRIPTIONS['currentADR']} />
                  <ColumnItem label="chop(rolling)" desc={COLUMN_DESCRIPTIONS['chop(rolling)']} />
                  <ColumnItem label="HTF_chop(rolling)" desc={COLUMN_DESCRIPTIONS['HTF_chop(rolling)']} />
                </ul>

                <h5>Signals</h5>
                <ul>
                  <ColumnItem label="Type1" desc={COLUMN_DESCRIPTIONS['Type1']} />
                  <ColumnItem label="Type2" desc={COLUMN_DESCRIPTIONS['Type2']} />
                </ul>

                <h5>OHLC &amp; Price</h5>
                <ul>
                  <ColumnItem label="open, high, low, close, direction" desc={COLUMN_DESCRIPTIONS['open, high, low, close, direction']} />
                  <ColumnItem label="open1, high1, low1, close1, direction1" desc={COLUMN_DESCRIPTIONS['open1, high1, low1, close1, direction1']} />
                  <ColumnItem label="open2, high2, low2, close2, direction2" desc={COLUMN_DESCRIPTIONS['open2, high2, low2, close2, direction2']} />
                  <ColumnItem label="HTF_open, HTF_high, HTF_low, HTF_close, HTF_direction" desc={COLUMN_DESCRIPTIONS['HTF_open, HTF_high, HTF_low, HTF_close, HTF_direction']} />
                  <ColumnItem label="HTF_open1, HTF_high1, HTF_low1, HTF_close1, HTF_direction1" desc={COLUMN_DESCRIPTIONS['HTF_open1, HTF_high1, HTF_low1, HTF_close1, HTF_direction1']} />
                  <ColumnItem label="HTF_open2, HTF_high2, HTF_low2, HTF_close2, HTF_direction2" desc={COLUMN_DESCRIPTIONS['HTF_open2, HTF_high2, HTF_low2, HTF_close2, HTF_direction2']} />
                </ul>

                <h5>DateTimes</h5>
                <ul>
                  <ColumnItem label="Year, Month, Day, Hour, Minute" desc={COLUMN_DESCRIPTIONS['Year, Month, Day, Hour, Minute']} />
                </ul>

                <h5>Moving Averages</h5>
                <ul>
                  <ColumnItem label="EMA_rawDistance(20/50/200)" desc={COLUMN_DESCRIPTIONS['EMA_rawDistance(20/50/200)']} />
                  <ColumnItem label="EMA_adrDistance(20/50/200)" desc={COLUMN_DESCRIPTIONS['EMA_adrDistance(20/50/200)']} />
                  <ColumnItem label="EMA_rrDistance(20/50/200)" desc={COLUMN_DESCRIPTIONS['EMA_rrDistance(20/50/200)']} />
                  <ColumnItem label="MA1, MA2, MA3" desc={COLUMN_DESCRIPTIONS['MA1, MA2, MA3']} />
                  <ColumnItem label="MA1_1, MA2_1, MA3_1" desc={COLUMN_DESCRIPTIONS['MA1_1, MA2_1, MA3_1']} />
                  <ColumnItem label="MA1_2, MA2_2, MA3_2" desc={COLUMN_DESCRIPTIONS['MA1_2, MA2_2, MA3_2']} />
                  <ColumnItem label="HTF_EMA_rawDistance(period)" desc={COLUMN_DESCRIPTIONS['HTF_EMA_rawDistance(period)']} />
                  <ColumnItem label="HTF_EMA_adrDistance(period)" desc={COLUMN_DESCRIPTIONS['HTF_EMA_adrDistance(period)']} />
                  <ColumnItem label="HTF_EMA_rrDistance(period)" desc={COLUMN_DESCRIPTIONS['HTF_EMA_rrDistance(period)']} />
                  <ColumnItem label="HTF_MA1, HTF_MA2, HTF_MA3" desc={COLUMN_DESCRIPTIONS['HTF_MA1, HTF_MA2, HTF_MA3']} />
                  <ColumnItem label="HTF_MA1_1, HTF_MA2_1, HTF_MA3_1" desc={COLUMN_DESCRIPTIONS['HTF_MA1_1, HTF_MA2_1, HTF_MA3_1']} />
                  <ColumnItem label="HTF_MA1_2, HTF_MA2_2, HTF_MA3_2" desc={COLUMN_DESCRIPTIONS['HTF_MA1_2, HTF_MA2_2, HTF_MA3_2']} />
                </ul>

                <h5>SMAE Channel</h5>
                <ul>
                  <ColumnItem label="SMAE1_Upper, SMAE1_Lower" desc={COLUMN_DESCRIPTIONS['SMAE1_Upper, SMAE1_Lower']} />
                  <ColumnItem label="SMAE2_Upper, SMAE2_Lower" desc={COLUMN_DESCRIPTIONS['SMAE2_Upper, SMAE2_Lower']} />
                  <ColumnItem label="HTF_SMAE1_Upper, HTF_SMAE1_Lower" desc={COLUMN_DESCRIPTIONS['HTF_SMAE1_Upper, HTF_SMAE1_Lower']} />
                  <ColumnItem label="HTF_SMAE2_Upper, HTF_SMAE2_Lower" desc={COLUMN_DESCRIPTIONS['HTF_SMAE2_Upper, HTF_SMAE2_Lower']} />
                </ul>

                <h5>PWAP</h5>
                <ul>
                  <ColumnItem label="PWAP_Mean" desc={COLUMN_DESCRIPTIONS['PWAP_Mean']} />
                  <ColumnItem label="PWAP_Upper1, PWAP_Lower1" desc={COLUMN_DESCRIPTIONS['PWAP_Upper1, PWAP_Lower1']} />
                  <ColumnItem label="PWAP_Upper2, PWAP_Lower2" desc={COLUMN_DESCRIPTIONS['PWAP_Upper2, PWAP_Lower2']} />
                  <ColumnItem label="PWAP_Upper3, PWAP_Lower3" desc={COLUMN_DESCRIPTIONS['PWAP_Upper3, PWAP_Lower3']} />
                  <ColumnItem label="PWAP_Upper4, PWAP_Lower4" desc={COLUMN_DESCRIPTIONS['PWAP_Upper4, PWAP_Lower4']} />
                  <ColumnItem label="PWAP_distance_RR" desc={COLUMN_DESCRIPTIONS['PWAP_distance_RR']} />
                  <ColumnItem label="PWAP_distance_ADR" desc={COLUMN_DESCRIPTIONS['PWAP_distance_ADR']} />
                </ul>

                <h5>State &amp; Structure</h5>
                <ul>
                  <ColumnItem label="State" desc={COLUMN_DESCRIPTIONS['State']} />
                  <ColumnItem label="prState" desc={COLUMN_DESCRIPTIONS['prState']} />
                  <ColumnItem label="fromState" desc={COLUMN_DESCRIPTIONS['fromState']} />
                  <ColumnItem label="stateBarCount" desc={COLUMN_DESCRIPTIONS['stateBarCount']} />
                  <ColumnItem label="HTF_State" desc={COLUMN_DESCRIPTIONS['HTF_State']} />
                  <ColumnItem label="HTF_prState" desc={COLUMN_DESCRIPTIONS['HTF_prState']} />
                  <ColumnItem label="HTF_fromState" desc={COLUMN_DESCRIPTIONS['HTF_fromState']} />
                  <ColumnItem label="HTF_stateBarCount" desc={COLUMN_DESCRIPTIONS['HTF_stateBarCount']} />
                </ul>

                <h5>Consecutive Bars</h5>
                <ul>
                  <ColumnItem label="Con_UP_bars" desc={COLUMN_DESCRIPTIONS['Con_UP_bars']} />
                  <ColumnItem label="Con_DN_bars" desc={COLUMN_DESCRIPTIONS['Con_DN_bars']} />
                  <ColumnItem label="Con_UP_bars(state)" desc={COLUMN_DESCRIPTIONS['Con_UP_bars(state)']} />
                  <ColumnItem label="Con_DN_bars(state)" desc={COLUMN_DESCRIPTIONS['Con_DN_bars(state)']} />
                  <ColumnItem label="priorRunCount" desc={COLUMN_DESCRIPTIONS['priorRunCount']} />
                  <ColumnItem label="HTF_Con_UP_bars" desc={COLUMN_DESCRIPTIONS['HTF_Con_UP_bars']} />
                  <ColumnItem label="HTF_Con_DN_bars" desc={COLUMN_DESCRIPTIONS['HTF_Con_DN_bars']} />
                  <ColumnItem label="HTF_Con_UP_bars(state)" desc={COLUMN_DESCRIPTIONS['HTF_Con_UP_bars(state)']} />
                  <ColumnItem label="HTF_Con_DN_bars(state)" desc={COLUMN_DESCRIPTIONS['HTF_Con_DN_bars(state)']} />
                  <ColumnItem label="HTF_priorRunCount" desc={COLUMN_DESCRIPTIONS['HTF_priorRunCount']} />
                </ul>

                <h5>Drawdown/Wick</h5>
                <ul>
                  <ColumnItem label="DD" desc={COLUMN_DESCRIPTIONS['DD']} />
                  <ColumnItem label="DD_RR" desc={COLUMN_DESCRIPTIONS['DD_RR']} />
                  <ColumnItem label="DD_ADR" desc={COLUMN_DESCRIPTIONS['DD_ADR']} />
                  <ColumnItem label="HTF_DD" desc={COLUMN_DESCRIPTIONS['HTF_DD']} />
                  <ColumnItem label="HTF_DD_RR" desc={COLUMN_DESCRIPTIONS['HTF_DD_RR']} />
                  <ColumnItem label="HTF_DD_ADR" desc={COLUMN_DESCRIPTIONS['HTF_DD_ADR']} />
                </ul>

                <h5>Duration</h5>
                <ul>
                  <ColumnItem label="barDuration" desc={COLUMN_DESCRIPTIONS['barDuration']} />
                  <ColumnItem label="stateDuration" desc={COLUMN_DESCRIPTIONS['stateDuration']} />
                  <ColumnItem label="HTF_barDuration" desc={COLUMN_DESCRIPTIONS['HTF_barDuration']} />
                  <ColumnItem label="HTF_stateDuration" desc={COLUMN_DESCRIPTIONS['HTF_stateDuration']} />
                </ul>

                <h5>MFE / Outcome Metrics</h5>
                <ul>
                  <ColumnItem label="MFE_clr_Bars" desc={COLUMN_DESCRIPTIONS['MFE_clr_Bars']} />
                  <ColumnItem label="MFE_clr_price" desc={COLUMN_DESCRIPTIONS['MFE_clr_price']} />
                  <ColumnItem label="MFE_clr_ADR" desc={COLUMN_DESCRIPTIONS['MFE_clr_ADR']} />
                  <ColumnItem label="MFE_clr_RR" desc={COLUMN_DESCRIPTIONS['MFE_clr_RR']} />
                  <ColumnItem label="REAL_clr_ADR" desc={COLUMN_DESCRIPTIONS['REAL_clr_ADR']} />
                  <ColumnItem label="REAL_clr_RR" desc={COLUMN_DESCRIPTIONS['REAL_clr_RR']} />
                  <ColumnItem label="REAL_MA1_Price, REAL_MA1_ADR, REAL_MA1_RR" desc={COLUMN_DESCRIPTIONS['REAL_MA1_Price, REAL_MA1_ADR, REAL_MA1_RR']} />
                  <ColumnItem label="REAL_MA2_Price, REAL_MA2_ADR, REAL_MA2_RR" desc={COLUMN_DESCRIPTIONS['REAL_MA2_Price, REAL_MA2_ADR, REAL_MA2_RR']} />
                  <ColumnItem label="REAL_MA3_Price, REAL_MA3_ADR, REAL_MA3_RR" desc={COLUMN_DESCRIPTIONS['REAL_MA3_Price, REAL_MA3_ADR, REAL_MA3_RR']} />
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
