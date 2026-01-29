import { useState, useCallback, useEffect } from 'react'
import Sidebar from './components/Sidebar'
import ChartArea from './components/ChartArea'
import RenkoControls from './components/RenkoControls'
import MAControls from './components/MAControls'
import StatsPage from './components/StatsPage'
import ParquetPage from './components/ParquetPage'
import './styles/App.css'

const API_BASE = 'http://localhost:8000'
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
    return localStorage.getItem(`${STORAGE_PREFIX}workingDir`) || 'C:\\Users\\lawfp\\Desktop\\Data_renko'
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
      return {
        brickSize: parsed.brickSize,
        reversalSize: parsed.reversalSize,
        wickMode: parsed.wickMode
      }
    }
    return {
      brickSize: 0.0010,
      reversalSize: 0.0020,
      wickMode: 'all'
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
  const [compressionFactor, setCompressionFactor] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}compressionFactor`)
    return saved ? parseFloat(saved) : 1.0
  })
  const [showIndicatorPane, setShowIndicatorPane] = useState(() => {
    const saved = localStorage.getItem(`${STORAGE_PREFIX}showIndicatorPane`)
    return saved === 'true'
  })

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
    localStorage.setItem(`${STORAGE_PREFIX}compressionFactor`, compressionFactor.toString())
  }, [compressionFactor])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}showIndicatorPane`, showIndicatorPane.toString())
  }, [showIndicatorPane])

  useEffect(() => {
    localStorage.setItem(`${STORAGE_PREFIX}workingDir`, workingDir)
  }, [workingDir])

  // Refetch files and cache when working directory changes
  useEffect(() => {
    fetchFiles()
    fetchCache()
    fetchStatsFiles()
    // Clear current data when directory changes
    setActiveInstrument(null)
    setChartData(null)
    setRenkoData(null)
  }, [workingDir])

  const fetchFiles = async () => {
    try {
      const res = await fetch(`${API_BASE}/files?working_dir=${encodeURIComponent(workingDir)}`)
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
      const res = await fetch(`${API_BASE}/cache?working_dir=${encodeURIComponent(workingDir)}`)
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
      const res = await fetch(`${API_BASE}/stats-files?working_dir=${encodeURIComponent(workingDir)}`)
      if (res.ok) {
        const data = await res.json()
        setStatsFiles(data)
      }
    } catch (err) {
      console.error('Failed to fetch stats files:', err)
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
      const res = await fetch(`${API_BASE}/parquet-stats?filepath=${encodeURIComponent(filepath)}`)
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
      const res = await fetch(`${API_BASE}/parquet-data?filepath=${encodeURIComponent(filepath)}`)
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

  const handleDeleteStatsFile = async (filepath) => {
    try {
      const res = await fetch(`${API_BASE}/stats-file?filepath=${encodeURIComponent(filepath)}`, {
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
      const res = await fetch(`${API_BASE}/stats-files?working_dir=${encodeURIComponent(workingDir)}`, {
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
      const res = await fetch(`${API_BASE}/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          files: selectedFiles,
          working_dir: workingDir,
          data_format: dataFormat,
          interval_type: intervalType,
          custom_name: customName || null
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
      const res = await fetch(`${API_BASE}/stats/${activeInstrument}`, {
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
          renko_data: renkoData.data
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

  const loadChart = async (instrument) => {
    if (instrument === activeInstrument && chartData) return;  // already loaded
    setActiveInstrument(instrument)
    setRenkoData(null) // Clear renko data when loading new instrument
    setIsLoading(true)

    try {
      const res = await fetch(`${API_BASE}/chart/${instrument}?working_dir=${encodeURIComponent(workingDir)}`)
      if (res.ok) {
        const data = await res.json()
        setChartData(data)
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
      const res = await fetch(`${API_BASE}/renko/${instrument}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          brick_size: settings.brickSize,
          reversal_size: settings.reversalSize,
          wick_mode: settings.wickMode || 'all',
          working_dir: workingDir
        })
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
      const res = await fetch(`${API_BASE}/cache/${instrument}?working_dir=${encodeURIComponent(workingDir)}`, {
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
      const res = await fetch(`${API_BASE}/cache?working_dir=${encodeURIComponent(workingDir)}`, {
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
              Ind
            </button>
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
          {activeInstrument && (
            <MAControls settings={maSettings} onChange={setMASettings} />
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
            // Data import settings
            dataFormat={dataFormat}
            onDataFormatChange={setDataFormat}
            intervalType={intervalType}
            onIntervalTypeChange={setIntervalType}
            customName={customName}
            onCustomNameChange={setCustomName}
            // Stats generation
            onRunStats={handleRunStats}
            isRunningStats={isRunningStats}
            renkoSettings={renkoSettings}
            maSettings={maSettings}
            // Stats files
            statsFiles={statsFiles}
            selectedStatsFile={selectedStatsFile}
            onStatsFileSelect={handleStatsFileSelect}
            onShowStats={handleShowStats}
            onShowParquet={handleShowParquet}
            isLoadingStats={isLoadingStats}
            isLoadingParquet={isLoadingParquet}
            onDeleteStatsFile={handleDeleteStatsFile}
            onDeleteAllStatsFiles={handleDeleteAllStatsFiles}
            isLoading={isLoading}
          />

          {!sidebarCollapsed && (
            <div className="resize-handle" onMouseDown={handleResizeStart} />
          )}
        </aside>

        <main className="main-content">
          {activeTab === 'stats' && statsView === 'parquet' ? (
            <ParquetPage
              data={parquetData}
              filename={parquetFilename}
              isLoading={isLoadingParquet}
              onBack={() => setStatsView('stats')}
            />
          ) : activeTab === 'stats' ? (
            <StatsPage
              stats={statsData}
              filename={statsFilename}
              filepath={statsFilepath}
              isLoading={isLoadingStats}
              onDelete={handleDeleteStatsFile}
            />
          ) : (
            <ChartArea
              chartData={chartType === 'renko' ? renkoData : chartData}
              renkoData={chartType === 'overlay' ? renkoData : null}
              chartType={chartType}
              isLoading={isLoading}
              activeInstrument={activeInstrument}
              pricePrecision={pricePrecision}
              maSettings={maSettings}
              compressionFactor={compressionFactor}
              showIndicatorPane={showIndicatorPane}
              brickSize={renkoSettings.brickSize}
              reversalSize={renkoSettings.reversalSize}
            />
          )}
        </main>
      </div>
    </div>
  )
}

export default App
