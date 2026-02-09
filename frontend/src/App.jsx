import { useState, useCallback, useEffect, useMemo } from 'react'
import Sidebar from './components/Sidebar'
import ChartArea from './components/ChartArea'
import RenkoControls from './components/RenkoControls'
import MAControls from './components/MAControls'
import { getDefaultSettings as getDefaultSessionSettings, migrateTemplate } from './components/SessionControls'
import StatsPage from './components/StatsPage'
import ParquetPage from './components/ParquetPage'
import MLResultsPage from './components/MLResultsPage'
import { computeIndicatorSignals } from './utils/indicatorSignals'
import './styles/App.css'

const DEFAULT_API_BASE = 'http://localhost:8000'
const STORAGE_PREFIX = 'RenkoDiscovery_'

const PRICE_PRECISION_OPTIONS = [
  { value: 2, label: '2 decimals' },
  { value: 3, label: '3 decimals' },
  { value: 4, label: '4 decimals' },
  { value: 5, label: '5 decimals' },
  { value: 6, label: '6 decimals' },
]

const COMPRESSION_OPTIONS = [
  { value: 0.001, label: '0.001x' },
  { value: 0.01, label: '0.01x' },
  { value: 0.05, label: '0.05x' },
  { value: 0.1, label: '0.1x' },
  { value: 0.25, label: '0.25x' },
  { value: 0.5, label: '0.5x' },
  { value: 1.0, label: '1.0x (Default)' },
  { value: 2.0, label: '2.0x' },
  { value: 4.0, label: '4.0x' },
]

function App() {
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}sidebarWidth`)
    return saved ? parseInt(saved, 10) : 320
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}sidebarCollapsed`)
    return saved === 'true'
  })
  const [activeTab, setActiveTab] = useState(() => {
    return localStorage.getItem(`${STORAGE_PREFIX}activeTab`) || 'data'
  })
  const [workingDir, setWorkingDir] = useState(() => {
    return localStorage.getItem(`${STORAGE_PREFIX}workingDir`) || ''
  })
  const [files, setFiles] = useState([])
  const [selectedFiles, setSelectedFiles] = useState([])
  const [cachedInstruments, setCachedInstruments] = useState([])
  const [activeInstrument, setActiveInstrument] = useState(null)
  const [chartData, setChartData] = useState(null)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingResults, setProcessingResults] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isRunningStats, setIsRunningStats] = useState(false)
  const [statsFiles, setStatsFiles] = useState([])
  const [selectedStatsFile, setSelectedStatsFile] = useState(null)
  const [statsData, setStatsData] = useState(null)
  const [isLoadingStats, setIsLoadingStats] = useState(false)
  const [statsFilename, setStatsFilename] = useState('')
  const [statsFilepath, setStatsFilepath] = useState('')
  const [parquetData, setParquetData] = useState(null)
  const [isLoadingParquet, setIsLoadingParquet] = useState(false)
  const [parquetFilename, setParquetFilename] = useState('')
  const [statsView, setStatsView] = useState('stats') // 'stats' | 'parquet'
  // Data import settings
  const [dataFormat, setDataFormat] = useState('MT4')  // 'MT4' or 'J4X'
  const [intervalType, setIntervalType] = useState('M')  // 'M' for minute, 'T' for tick
  const [customName, setCustomName] = useState('')
  const [pricePrecision, setPricePrecision] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}pricePrecision`)
    return saved ? parseInt(saved, 10) : 5
  })
  const [chartType, setChartType] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}chartType`)
    if (saved === 'm1') return 'raw'
    return saved || 'raw'
  }) // 'raw' | 'renko' | 'overlay'
  const [renkoSettings, setRenkoSettings] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}renkoSettings`)
    if (saved) {
      const parsed = JSON.parse(saved)
      // Validate brickSize - must be a valid price value
      if (!parsed.brickSize || parsed.brickSize <= 0) {
        parsed.brickSize = 0.0010
      }
      // Migrate from reversalMultiplier to reversalSize
      if (parsed.reversalMultiplier && !parsed.reversalSize) {
        parsed.reversalSize = parsed.brickSize * parsed.reversalMultiplier
        delete parsed.reversalMultiplier
      }
      if (!parsed.reversalSize || parsed.reversalSize <= 0) {
        parsed.reversalSize = 0.0020
      }
      // Default wickMode if not present
      if (!parsed.wickMode) {
        parsed.wickMode = 'all'
      }
      // Migrate: add ADR fields if missing
      if (!parsed.sizingMode) parsed.sizingMode = 'price'
      if (!parsed.brickPct || parsed.brickPct <= 0) parsed.brickPct = 5
      if (!parsed.reversalPct || parsed.reversalPct <= 0) parsed.reversalPct = 10
      if (!parsed.adrPeriod || parsed.adrPeriod <= 0) parsed.adrPeriod = 14
      return {
        brickSize: parsed.brickSize,
        reversalSize: parsed.reversalSize,
        wickMode: parsed.wickMode,
        sizingMode: parsed.sizingMode,
        brickPct: parsed.brickPct,
        reversalPct: parsed.reversalPct,
        adrPeriod: parsed.adrPeriod
      }
    }
    return {
      brickSize: 0.0010,
      reversalSize: 0.0020,
      wickMode: 'all',
      sizingMode: 'price',
      brickPct: 5,
      reversalPct: 10,
      adrPeriod: 14
    }
  })
  const [renkoData, setRenkoData] = useState(null)
  const [maSettings, setMASettings] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}maSettings`)
    if (saved) return JSON.parse(saved)
    return {
      ma1: { enabled: false, type: 'sma', period: 20, color: '#f59e0b', lineWidth: 2, lineStyle: 0 },
      ma2: { enabled: false, type: 'sma', period: 50, color: '#3b82f6', lineWidth: 2, lineStyle: 0 },
      ma3: { enabled: false, type: 'sma', period: 200, color: '#a855f7', lineWidth: 2, lineStyle: 0 }
    }
  })
  const [smaeSettings, setSmaeSettings] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}smaeSettings`)
    if (saved) return JSON.parse(saved)
    return {
      smae1: { enabled: false, period: 20, deviation: 1.0, showCenter: true,
               centerColor: '#22d3ee', bandColor: '#22d3ee',
               lineWidth: 1, lineStyle: 0, bandLineWidth: 1, bandLineStyle: 1 },
      smae2: { enabled: false, period: 50, deviation: 1.0, showCenter: true,
               centerColor: '#fb923c', bandColor: '#fb923c',
               lineWidth: 1, lineStyle: 0, bandLineWidth: 1, bandLineStyle: 1 },
    }
  })
  const [pwapSettings, setPwapSettings] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}pwapSettings`)
    if (saved) return JSON.parse(saved)
    return {
      enabled: false,
      sigmas: [1.0, 2.0, 2.5, 3.0],
      meanColor: '#f472b6', meanWidth: 2, meanStyle: 0,
      bandColor: '#f472b6', bandWidth: 1, bandStyle: 1,
    }
  })
  const [compressionFactor, setCompressionFactor] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}compressionFactor`)
    return saved ? parseFloat(saved) : 1.0
  })
  const [showIndicatorPane, setShowIndicatorPane] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}showIndicatorPane`)
    return saved === 'true'
  })
  const [sessionSettings, setSessionSettings] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}sessionSettings`)
    if (saved) {
      const parsed = JSON.parse(saved)
      // Ensure builtin templates always exist
      const defaults = getDefaultSessionSettings()
      return {
        ...parsed,
        templates: { ...defaults.templates, ...parsed.templates },
      }
    }
    return getDefaultSessionSettings()
  })

  // Data cleaning/adjustment state
  const [cleanHolidays, setCleanHolidays] = useState(false)
  const [cleanThresholdPct, setCleanThresholdPct] = useState(50)
  const [backAdjust, setBackAdjust] = useState(false)
  // Session schedule loaded from chart metadata (set when chart data is loaded)
  const [chartSessionSchedule, setChartSessionSchedule] = useState(null)

  // ML state
  const [mlColumns, setMlColumns] = useState(null)
  const [mlSelectedFeatures, setMlSelectedFeatures] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}mlSelectedFeatures`)
    return saved ? JSON.parse(saved) : []
  })
  const [mlTargetColumn, setMlTargetColumn] = useState(() => {
    return localStorage.getItem(`${STORAGE_PREFIX}mlTargetColumn`) || ''
  })
  const [mlWinThreshold, setMlWinThreshold] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}mlWinThreshold`)
    return saved ? parseFloat(saved) : 1.0
  })
  const [mlFilterExpr, setMlFilterExpr] = useState('')
  const [mlModelName, setMlModelName] = useState('')
  const [mlSourceParquet, setMlSourceParquet] = useState('')
  const [isTrainingML, setIsTrainingML] = useState(false)
  const [mlReport, setMlReport] = useState(null)
  const [mlModels, setMlModels] = useState([])
  const [mlError, setMlError] = useState('')
  const [mlTrainProgress, setMlTrainProgress] = useState(null)

  // Dynamic API base for Electron support
  const [apiBase, setApiBase] = useState(DEFAULT_API_BASE)
  const [apiReady, setApiReady] = useState(!window.electronAPI)

  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getBackendPort().then((port) => {
        setApiBase(`http://localhost:${port}`)
        setApiReady(true)
      })
    }
  }, [])

  // Auto-prompt folder selection on first launch in Electron
  useEffect(() => {
    if (apiReady && !workingDir && window.electronAPI) {
      window.electronAPI.selectFolder().then((dir) => {
        if (dir) setWorkingDir(dir)
      })
    }
  }, [apiReady])

  // Persist UI settings to localStorage
  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}sidebarWidth`, sidebarWidth.toString())
  }, [sidebarWidth])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}sidebarCollapsed`, sidebarCollapsed.toString())
  }, [sidebarCollapsed])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}activeTab`, activeTab)
  }, [activeTab])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}chartType`, chartType)
  }, [chartType])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}maSettings`, JSON.stringify(maSettings))
  }, [maSettings])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}smaeSettings`, JSON.stringify(smaeSettings))
  }, [smaeSettings])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}pwapSettings`, JSON.stringify(pwapSettings))
  }, [pwapSettings])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}compressionFactor`, compressionFactor.toString())
  }, [compressionFactor])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}showIndicatorPane`, showIndicatorPane.toString())
  }, [showIndicatorPane])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}sessionSettings`, JSON.stringify(sessionSettings))
  }, [sessionSettings])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}mlSelectedFeatures`, JSON.stringify(mlSelectedFeatures))
  }, [mlSelectedFeatures])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}mlTargetColumn`, mlTargetColumn)
  }, [mlTargetColumn])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}mlWinThreshold`, mlWinThreshold.toString())
  }, [mlWinThreshold])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}workingDir`, workingDir)
  }, [workingDir])

  // Refetch files and cache when working directory changes
  useEffect(() => {
    if (!apiReady) return
    fetchFiles()
    fetchCache()
    fetchStatsFiles()
    fetchMLModels()
    // Clear current data when directory changes
    setActiveInstrument(null)
    setChartData(null)
    setRenkoData(null)
  }, [workingDir, apiReady])

  const fetchFiles = async () => {
    try {
      const res = await fetch(`${apiBase}/files?working_dir=${encodeURIComponent(workingDir)}`)
      if (res.ok) {
        const data = await res.json()
        setFiles(data)
      }
    } catch (err) {
      console.error('Failed to fetch files:', err)
    }
  }

  const fetchCache = async () => {
    try {
      const res = await fetch(`${apiBase}/cache?working_dir=${encodeURIComponent(workingDir)}`)
      if (res.ok) {
        const data = await res.json()
        setCachedInstruments(data)
      }
    } catch (err) {
      console.error('Failed to fetch cache:', err)
    }
  }

  const fetchStatsFiles = async () => {
    try {
      const res = await fetch(`${apiBase}/stats-files?working_dir=${encodeURIComponent(workingDir)}`)
      if (res.ok) {
        const data = await res.json()
        setStatsFiles(data)
      }
    } catch (err) {
      console.error('Failed to fetch stats files:', err)
    }
  }

  const fetchMLColumns = async (filepath) => {
    setMlError('')
    try {
      const res = await fetch(`${apiBase}/ml/columns?filepath=${encodeURIComponent(filepath)}`)
      if (res.ok) {
        const data = await res.json()
        setMlColumns(data)
        // Restore saved selection if it overlaps with available features, otherwise select all
        const saved = mlSelectedFeatures.filter(f => data.features.includes(f))
        setMlSelectedFeatures(saved.length > 0 ? saved : data.features)
        if (data.targets.length > 0 && !mlTargetColumn) {
          setMlTargetColumn(data.targets[0])
        }
      } else {
        const error = await res.json()
        setMlError(error.detail || 'Failed to load columns')
      }
    } catch (err) {
      setMlError('Failed to load columns: ' + err.message)
    }
  }

  const handleMLTrain = async () => {
    if (!mlSourceParquet || mlSelectedFeatures.length === 0 || !mlTargetColumn || !mlModelName) return
    setIsTrainingML(true)
    setMlError('')
    setMlReport(null)
    setMlTrainProgress(null)

    try {
      const res = await fetch(`${apiBase}/ml/train`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          working_dir: workingDir,
          source_parquet: mlSourceParquet,
          features: mlSelectedFeatures,
          target_column: mlTargetColumn,
          win_threshold: mlWinThreshold,
          filter_expr: mlFilterExpr || null,
          model_name: mlModelName,
          n_splits: 5,
        })
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const lines = buffer.split('\n\n')
        buffer = lines.pop()

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6))
              setMlTrainProgress(event)

              if (event.phase === 'done') {
                setMlReport(event.report)
                fetchMLModels()
              } else if (event.phase === 'error') {
                setMlError(event.message)
              }
            } catch (e) {
              console.error('Failed to parse SSE event:', e)
            }
          }
        }
      }
    } catch (err) {
      setMlError('Training failed: ' + err.message)
    } finally {
      setIsTrainingML(false)
      setMlTrainProgress(null)
    }
  }

  const fetchMLModels = async () => {
    try {
      const res = await fetch(`${apiBase}/ml/models?working_dir=${encodeURIComponent(workingDir)}`)
      if (res.ok) {
        const data = await res.json()
        setMlModels(data)
      }
    } catch (err) {
      console.error('Failed to fetch ML models:', err)
    }
  }

  const loadMLReport = async (filepath) => {
    setMlError('')
    try {
      const res = await fetch(`${apiBase}/ml/report?filepath=${encodeURIComponent(filepath)}`)
      if (res.ok) {
        const data = await res.json()
        setMlReport(data)
      } else {
        const error = await res.json()
        setMlError(error.detail || 'Failed to load report')
      }
    } catch (err) {
      setMlError('Failed to load report: ' + err.message)
    }
  }

  const handleDeleteMLModel = async (name) => {
    try {
      const res = await fetch(
        `${apiBase}/ml/model?name=${encodeURIComponent(name)}&working_dir=${encodeURIComponent(workingDir)}`,
        { method: 'DELETE' }
      )
      if (res.ok) {
        fetchMLModels()
        if (mlReport && mlReport.model_name === name) {
          setMlReport(null)
        }
      }
    } catch (err) {
      console.error('Failed to delete ML model:', err)
    }
  }

  const handleDeleteAllMLModels = async () => {
    try {
      const res = await fetch(
        `${apiBase}/ml/models?working_dir=${encodeURIComponent(workingDir)}`,
        { method: 'DELETE' }
      )
      if (res.ok) {
        fetchMLModels()
        setMlReport(null)
      }
    } catch (err) {
      console.error('Failed to delete ML models:', err)
    }
  }

  const handleFileSelect = useCallback((filepath) => {
    setSelectedFiles(prev => {
      if (prev.includes(filepath)) {
        return prev.filter(f => f !== filepath)
      }
      return [...prev, filepath]
    })
  }, [])

  const handleStatsFileSelect = useCallback((filepath) => {
    setSelectedStatsFile(prev => prev === filepath ? null : filepath)
  }, [])

  const handleShowStats = async (filepath) => {
    setStatsView('stats')
    setIsLoadingStats(true)
    setStatsFilepath(filepath)

    // Extract filename from filepath
    const filename = filepath.split(/[/\\]/).pop()
    setStatsFilename(filename)

    try {
      const res = await fetch(`${apiBase}/parquet-stats?filepath=${encodeURIComponent(filepath)}`)
      if (res.ok) {
        const data = await res.json()
        setStatsData(data)
      } else {
        const error = await res.json()
        console.error('Failed to load stats:', error.detail)
        setStatsData(null)
      }
    } catch (err) {
      console.error('Failed to load stats:', err)
      setStatsData(null)
    } finally {
      setIsLoadingStats(false)
    }
  }

  const handleShowParquet = async (filepath) => {
    setStatsView('parquet')
    setIsLoadingParquet(true)
    const filename = filepath.split(/[/\\]/).pop()
    setParquetFilename(filename)

    try {
      const res = await fetch(`${apiBase}/parquet-data?filepath=${encodeURIComponent(filepath)}`)
      if (res.ok) {
        const data = await res.json()
        setParquetData(data)
      } else {
        const error = await res.json()
        console.error('Failed to load parquet:', error.detail)
        setParquetData(null)
      }
    } catch (err) {
      console.error('Failed to load parquet:', err)
      setParquetData(null)
    } finally {
      setIsLoadingParquet(false)
    }
  }

  const [isExportingCSV, setIsExportingCSV] = useState(false)

  const handleExportCSV = async (filepath) => {
    setIsExportingCSV(true)
    try {
      const res = await fetch(`${apiBase}/export-csv?filepath=${encodeURIComponent(filepath)}&working_dir=${encodeURIComponent(workingDir)}`)
      const data = await res.json()
      if (res.ok) {
        alert(`Exported to: ${data.path}`)
      } else {
        alert(`Export failed: ${data.detail}`)
      }
    } catch (err) {
      alert(`Export failed: ${err.message}`)
    } finally {
      setIsExportingCSV(false)
    }
  }

  const handleExportIndicatorSignals = () => {
    if (!renkoData?.data?.close || !maSettings) return
    const rows = computeIndicatorSignals(renkoData, maSettings, renkoSettings, pricePrecision)
    const csv = 'datetime,State,Type1,Type2\n' + rows.map(r => `${r.datetime},${r.state},${r.type1},${r.type2}`).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${activeInstrument || 'signals'}_indicator_signals.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const handleDeleteStatsFile = async (filepath) => {
    try {
      const res = await fetch(`${apiBase}/stats-file?filepath=${encodeURIComponent(filepath)}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        // Clear current stats if we deleted the displayed file
        if (statsFilepath === filepath) {
          setStatsData(null)
          setStatsFilename('')
          setStatsFilepath('')
          setSelectedStatsFile(null)
        }
        // Refresh the stats files list
        fetchStatsFiles()
      } else {
        const error = await res.json()
        console.error('Failed to delete stats file:', error.detail)
      }
    } catch (err) {
      console.error('Failed to delete stats file:', err)
    }
  }

  const handleDeleteAllStatsFiles = async () => {
    try {
      const res = await fetch(`${apiBase}/stats-files?working_dir=${encodeURIComponent(workingDir)}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        // Clear current stats display
        setStatsData(null)
        setStatsFilename('')
        setStatsFilepath('')
        setSelectedStatsFile(null)
        // Refresh the stats files list
        fetchStatsFiles()
      } else {
        const error = await res.json()
        console.error('Failed to delete all stats files:', error.detail)
      }
    } catch (err) {
      console.error('Failed to delete all stats files:', err)
    }
  }

  const handleSelectAll = useCallback((instrument) => {
    const instrumentFiles = files.filter(f => f.instrument === instrument)
    const allSelected = instrumentFiles.every(f => selectedFiles.includes(f.filepath))

    if (allSelected) {
      setSelectedFiles(prev => prev.filter(fp => !instrumentFiles.some(f => f.filepath === fp)))
    } else {
      setSelectedFiles(prev => {
        const newSelection = [...prev]
        instrumentFiles.forEach(f => {
          if (!newSelection.includes(f.filepath)) {
            newSelection.push(f.filepath)
          }
        })
        return newSelection
      })
    }
  }, [files, selectedFiles])

  const handleProcess = async () => {
    if (selectedFiles.length === 0) return

    setIsProcessing(true)
    setProcessingResults(null)

    try {
      const res = await fetch(`${apiBase}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: selectedFiles,
          working_dir: workingDir,
          data_format: dataFormat,
          interval_type: intervalType,
          custom_name: customName || null,
          clean_holidays: cleanHolidays,
          clean_threshold_pct: cleanThresholdPct,
          back_adjust: backAdjust,
          session_schedule: templateSessionSchedule,
        })
      })

      if (res.ok) {
        const data = await res.json()
        setProcessingResults(data.results)
        setSelectedFiles([])
        setCustomName('')  // Clear custom name after processing
        fetchCache()
      }
    } catch (err) {
      console.error('Processing failed:', err)
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRunStats = async (statsConfig) => {
    if (!activeInstrument || !renkoData) {
      console.error('No chart data loaded')
      return
    }

    setIsRunningStats(true)

    try {
      const res = await fetch(`${apiBase}/stats/${activeInstrument}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: statsConfig.filename,
          working_dir: workingDir,
          adr_period: statsConfig.adrPeriod,
          chop_period: statsConfig.chopPeriod,
          brick_size: statsConfig.brickSize,
          reversal_size: statsConfig.reversalSize,
          wick_mode: statsConfig.wickMode,
          ma1_period: statsConfig.ma1Period,
          ma2_period: statsConfig.ma2Period,
          ma3_period: statsConfig.ma3Period,
          smae1_period: statsConfig.smae1Period ?? 20,
          smae1_deviation: statsConfig.smae1Deviation ?? 1.0,
          smae2_period: statsConfig.smae2Period ?? 50,
          smae2_deviation: statsConfig.smae2Deviation ?? 1.0,
          pwap_sigmas: statsConfig.pwapSigmas ?? [1.0, 2.0, 2.5, 3.0],
          renko_data: renkoData.data,
          session_schedule: sessionSchedule
        })
      })

      if (res.ok) {
        const data = await res.json()
        console.log('Stats generated:', data.filepath)
        fetchStatsFiles()  // Refresh the stats files list
      } else {
        const error = await res.json()
        console.error('Stats generation failed:', error.detail)
      }
    } catch (err) {
      console.error('Stats generation failed:', err)
    } finally {
      setIsRunningStats(false)
    }
  }

  const handleDirectGenerate = async (jobs) => {
    try {
      const res = await fetch(`${apiBase}/direct-generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobs, working_dir: workingDir })
      })
      if (res.ok) {
        const data = await res.json()
        fetchStatsFiles()
        return data.results
      } else {
        const error = await res.json()
        console.error('Direct generate failed:', error.detail)
        return [{ status: 'error', error: error.detail }]
      }
    } catch (err) {
      console.error('Direct generate failed:', err)
      return [{ status: 'error', error: err.message }]
    }
  }

  const loadChart = async (instrument) => {
    if (instrument === activeInstrument && chartData) return;  // already loaded
    setActiveInstrument(instrument)
    setRenkoData(null) // Clear renko data when loading new instrument
    setIsLoading(true)

    try {
      const res = await fetch(`${apiBase}/chart/${instrument}?working_dir=${encodeURIComponent(workingDir)}`)
      if (res.ok) {
        const data = await res.json()
        setChartData(data)
        // Use session schedule from chart metadata if available
        if (data.session_schedule) {
          setChartSessionSchedule(data.session_schedule)
        } else {
          setChartSessionSchedule(null)
        }
        // If renko or overlay mode is active, also load renko data
        if (chartType === 'renko' || chartType === 'overlay') {
          loadRenko(instrument)
        }
      } else {
        const error = await res.json()
        console.error('Failed to load chart:', error.detail)
      }
    } catch (err) {
      console.error('Failed to load chart:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handlePricePrecisionChange = (e) => {
    const newPrecision = parseInt(e.target.value, 10)
    setPricePrecision(newPrecision)
    localStorage.setItem(`${STORAGE_PREFIX}pricePrecision`, newPrecision.toString())
  }

  const handleCompressionChange = (e) => {
    const newCompression = parseFloat(e.target.value)
    setCompressionFactor(newCompression)
  }

  const loadRenko = async (instrument, settings = renkoSettings) => {
    if (!instrument) return

    setIsLoading(true)
    try {
      const body = {
        sizing_mode: settings.sizingMode || 'price',
        wick_mode: settings.wickMode || 'all',
        working_dir: workingDir,
        session_schedule: sessionSchedule
      }
      if (settings.sizingMode === 'adr') {
        body.brick_pct = settings.brickPct
        body.reversal_pct = settings.reversalPct
        body.adr_period = settings.adrPeriod
      } else {
        body.brick_size = settings.brickSize
        body.reversal_size = settings.reversalSize
      }
      const res = await fetch(`${apiBase}/renko/${instrument}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
      if (res.ok) {
        const data = await res.json()
        setRenkoData(data)
      } else {
        const error = await res.json()
        console.error('Failed to load renko:', error.detail)
      }
    } catch (err) {
      console.error('Failed to load renko:', err)
    } finally {
      setIsLoading(false)
    }
  }

  const handleChartTypeChange = (type) => {
    setChartType(type)
    if ((type === 'renko' || type === 'overlay') && activeInstrument && !renkoData) {
      loadRenko(activeInstrument)
    }
  }

  const handleRenkoSettingsChange = (newSettings) => {
    setRenkoSettings(newSettings)
    localStorage.setItem(`${STORAGE_PREFIX}renkoSettings`, JSON.stringify(newSettings))
    if (activeInstrument && (chartType === 'renko' || chartType === 'overlay')) {
      loadRenko(activeInstrument, newSettings)
    }
  }

  const deleteCache = async (instrument) => {
    try {
      const res = await fetch(`${apiBase}/cache/${instrument}?working_dir=${encodeURIComponent(workingDir)}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        fetchCache()
        // Clear chart if we deleted the active instrument
        if (activeInstrument === instrument) {
          setActiveInstrument(null)
          setChartData(null)
        }
      }
    } catch (err) {
      console.error('Failed to delete cache:', err)
    }
  }

  const deleteAllCache = async () => {
    try {
      const res = await fetch(`${apiBase}/cache?working_dir=${encodeURIComponent(workingDir)}`, {
        method: 'DELETE'
      })
      if (res.ok) {
        fetchCache()
        setActiveInstrument(null)
        setChartData(null)
      }
    } catch (err) {
      console.error('Failed to delete all cache:', err)
    }
  }

  // Derive session schedule: use chart metadata schedule when a chart is loaded,
  // otherwise fall back to the user's template-based schedule (used at import time)
  const templateSessionSchedule = useMemo(() => {
    return migrateTemplate(
      sessionSettings.templates[sessionSettings.activeTemplateId]
      || sessionSettings.templates['fx-default']
    ).schedule
  }, [sessionSettings])

  const sessionSchedule = chartSessionSchedule || templateSessionSchedule

  // Resize handling
  const handleResizeStart = useCallback((e) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = sidebarWidth

    const handleMouseMove = (e) => {
      const newWidth = Math.max(240, Math.min(600, startWidth + e.clientX - startX))
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [sidebarWidth])

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-brand">
          <svg className="logo" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 3v18h18" />
            <path d="M7 16l4-8 4 4 6-8" />
          </svg>
          <span className="brand-text">RenkoDiscovery</span>
        </div>
        {activeTab === 'stats' && statsFilename && (
          <span className="header-stats-filename mono">{statsFilename}</span>
        )}
        <div className="header-status">
          {activeInstrument && (
            <span className="active-instrument mono">{activeInstrument}</span>
          )}
          {activeInstrument && (
            <div className="chart-type-toggle">
              <button
                className={`toggle-btn ${chartType === 'raw' ? 'active' : ''}`}
                onClick={() => handleChartTypeChange('raw')}
              >
                Raw
              </button>
              <button
                className={`toggle-btn ${chartType === 'renko' ? 'active' : ''}`}
                onClick={() => handleChartTypeChange('renko')}
              >
                Renko
              </button>
              <button
                className={`toggle-btn ${chartType === 'overlay' ? 'active' : ''}`}
                onClick={() => handleChartTypeChange('overlay')}
              >
                Overlay
              </button>
            </div>
          )}
          {chartType === 'raw' && chartData && (
            <span className="data-count mono">
              {(chartData.displayed_rows || chartData.total_rows || 0).toLocaleString()}
              {chartData.displayed_rows !== chartData.total_rows && (
                <span className="total-hint"> / {(chartData.total_rows || 0).toLocaleString()}</span>
              )}
            </span>
          )}
          {chartType === 'renko' && renkoData && (
            <span className="data-count mono">
              {renkoData.total_bricks.toLocaleString()} bricks
            </span>
          )}
          {chartType === 'overlay' && chartData && renkoData && (
            <span className="data-count mono">
              {(chartData.displayed_rows || chartData.total_rows || 0).toLocaleString()} bars + {renkoData.total_bricks.toLocaleString()} bricks
            </span>
          )}
          {(chartType === 'renko' || chartType === 'overlay') && activeInstrument && (
            <RenkoControls
              settings={renkoSettings}
              onChange={handleRenkoSettingsChange}
            />
          )}
          {chartType === 'renko' && activeInstrument && (
            <button
              className={`indicator-toggle-btn ${showIndicatorPane ? 'active' : ''}`}
              onClick={() => setShowIndicatorPane(!showIndicatorPane)}
              title="Toggle State/Type indicator pane"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 3v18h18" />
                <circle cx="8" cy="14" r="2" />
                <circle cx="12" cy="8" r="2" />
                <circle cx="16" cy="12" r="2" />
              </svg>
              T1/2
            </button>
          )}
          {activeInstrument && (
            <MAControls settings={maSettings} onChange={setMASettings} smaeSettings={smaeSettings} onSmaeChange={setSmaeSettings} pwapSettings={pwapSettings} onPwapChange={setPwapSettings} />
          )}
          {activeInstrument && (
            <select
              className="precision-select mono"
              value={pricePrecision}
              onChange={handlePricePrecisionChange}
            >
              {PRICE_PRECISION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
          {activeInstrument && (
            <select
              className="compression-select mono"
              value={compressionFactor}
              onChange={handleCompressionChange}
              title="Horizontal Compression: Default is 1.0x. Lower values compress the time axis (show more bars), higher values expand it (show fewer bars)."
            >
              {COMPRESSION_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>
      </header>

      <div className="app-body">
        <aside
          className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
          style={{ width: sidebarCollapsed ? 48 : sidebarWidth }}
        >
          <Sidebar
            collapsed={sidebarCollapsed}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            activeTab={activeTab}
            onTabChange={setActiveTab}
            workingDir={workingDir}
            onWorkingDirChange={setWorkingDir}
            files={files}
            selectedFiles={selectedFiles}
            onFileSelect={handleFileSelect}
            onSelectAll={handleSelectAll}
            onProcess={handleProcess}
            isProcessing={isProcessing}
            processingResults={processingResults}
            cachedInstruments={cachedInstruments}
            activeInstrument={activeInstrument}
            onLoadChart={loadChart}
            // Cache management
            onDeleteCache={deleteCache}
            onDeleteAllCache={deleteAllCache}
            // Indicator signal export
            onExportIndicatorSignals={handleExportIndicatorSignals}
            canExportIndicatorSignals={!!renkoData?.data?.close && !!maSettings?.ma1?.enabled && !!maSettings?.ma2?.enabled && !!maSettings?.ma3?.enabled}
            // Data import settings
            dataFormat={dataFormat}
            onDataFormatChange={setDataFormat}
            intervalType={intervalType}
            onIntervalTypeChange={setIntervalType}
            customName={customName}
            onCustomNameChange={setCustomName}
            // Session schedule (for import)
            sessionSettings={sessionSettings}
            onSessionSettingsChange={setSessionSettings}
            // Data cleaning/adjustment
            cleanHolidays={cleanHolidays}
            onCleanHolidaysChange={setCleanHolidays}
            cleanThresholdPct={cleanThresholdPct}
            onCleanThresholdPctChange={setCleanThresholdPct}
            backAdjust={backAdjust}
            onBackAdjustChange={setBackAdjust}
            // Stats generation
            onRunStats={handleRunStats}
            isRunningStats={isRunningStats}
            renkoSettings={renkoSettings}
            maSettings={maSettings}
            smaeSettings={smaeSettings}
            pwapSettings={pwapSettings}
            // Stats files
            statsFiles={statsFiles}
            selectedStatsFile={selectedStatsFile}
            onStatsFileSelect={handleStatsFileSelect}
            onShowStats={handleShowStats}
            onShowParquet={handleShowParquet}
            onExportCSV={handleExportCSV}
            isLoadingStats={isLoadingStats}
            isLoadingParquet={isLoadingParquet}
            isExportingCSV={isExportingCSV}
            onDeleteStatsFile={handleDeleteStatsFile}
            onDeleteAllStatsFiles={handleDeleteAllStatsFiles}
            isLoading={isLoading}
            // ML props
            mlColumns={mlColumns}
            mlSelectedFeatures={mlSelectedFeatures}
            onMlSelectedFeaturesChange={setMlSelectedFeatures}
            mlTargetColumn={mlTargetColumn}
            onMlTargetColumnChange={setMlTargetColumn}
            mlWinThreshold={mlWinThreshold}
            onMlWinThresholdChange={setMlWinThreshold}
            mlFilterExpr={mlFilterExpr}
            onMlFilterExprChange={setMlFilterExpr}
            mlModelName={mlModelName}
            onMlModelNameChange={setMlModelName}
            mlSourceParquet={mlSourceParquet}
            onMlSourceParquetChange={setMlSourceParquet}
            onFetchMLColumns={fetchMLColumns}
            onMLTrain={handleMLTrain}
            isTrainingML={isTrainingML}
            mlModels={mlModels}
            onLoadMLReport={loadMLReport}
            onDeleteMLModel={handleDeleteMLModel}
            onDeleteAllMLModels={handleDeleteAllMLModels}
            mlError={mlError}
            apiBase={apiBase}
            onDirectGenerate={handleDirectGenerate}
          />

          {!sidebarCollapsed && (
            <div className="resize-handle" onMouseDown={handleResizeStart} />
          )}
        </aside>

        <main className="main-content">
          {activeTab === 'ml' ? (
            <MLResultsPage
              report={mlReport}
              isTraining={isTrainingML}
              error={mlError}
              progress={mlTrainProgress}
            />
          ) : activeTab === 'stats' && statsView === 'parquet' ? (
            <ParquetPage
              data={parquetData}
              filename={parquetFilename}
              isLoading={isLoadingParquet}
              onBack={() => setStatsView('stats')}
            />
          ) : activeTab !== 'stats' ? (
            <ChartArea
              chartData={chartType === 'renko' ? renkoData : chartData}
              renkoData={chartType === 'overlay' ? renkoData : null}
              chartType={chartType}
              isLoading={isLoading}
              activeInstrument={activeInstrument}
              pricePrecision={pricePrecision}
              maSettings={maSettings}
              smaeSettings={smaeSettings}
              pwapSettings={pwapSettings}
              compressionFactor={compressionFactor}
              showIndicatorPane={showIndicatorPane}
              brickSize={renkoSettings.brickSize}
              reversalSize={renkoSettings.reversalSize}
              renkoPerBrickSizes={renkoData?.data?.brick_size}
              renkoPerReversalSizes={renkoData?.data?.reversal_size}
              sessionSchedule={sessionSchedule}
            />
          ) : null}
          <div style={{ display: activeTab === 'stats' && statsView !== 'parquet' ? 'flex' : 'none', flexDirection: 'column', flex: 1, minHeight: 0 }}>
            <StatsPage
              stats={statsData}
              filename={statsFilename}
              filepath={statsFilepath}
              isLoading={isLoadingStats}
              onDelete={handleDeleteStatsFile}
              apiBase={apiBase}
            />
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
