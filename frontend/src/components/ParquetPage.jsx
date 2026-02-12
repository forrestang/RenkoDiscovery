import './ParquetPage.css'

function ParquetPage({ data, filename, isLoading, onBack }) {
  if (isLoading) {
    return (
      <div className="parquet-page">
        <div className="parquet-loading">
          <div className="parquet-loading-spinner" />
          <span>Loading parquet data...</span>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="parquet-page">
        <div className="parquet-empty">
          <span>[···]</span>
          <span>No parquet data loaded</span>
        </div>
      </div>
    )
  }

  const { columns, rows, totalRows } = data

  const columnTooltips = {
    'datetime': 'Timestamp of the bar',
    'open': 'Open price',
    'high': 'High price',
    'low': 'Low price',
    'close': 'Close price',
    'adr_period': 'Average Daily Range lookback period',
    'brick_size': 'Renko brick size in price units',
    'reversal_size': 'Price move required to reverse direction',
    'wick_mode': 'Wick display mode (all, big, none)',
    'ma1_period': 'Moving Average 1 period',
    'ma2_period': 'Moving Average 2 period',
    'ma3_period': 'Moving Average 3 period',
    'chopPeriod': 'Rolling chop index lookback period',
    'currentADR': 'Current Average Daily Range in price units',
    'DD': 'Drawdown/wick size in price units',
    'DD_ADR': 'Drawdown normalized by ADR',
    'DD_RR': 'Drawdown normalized by reversal size',
    'State': 'EMA alignment state (-3 to +3)',
    'prState': 'Prior bar State value',
    'fromState': 'State of the previous run (prior state transition)',
    'Type1': 'Type1 pullback signal counter (FP: 3-bar reversal, TV: 2-bar reversal with DD)',
    'Type2': 'Type2 pullback signal counter (FP: 3-bar bounce, TV: 2-bar continuation with DD + MA1)',
    'Con_UP_bars': 'Consecutive UP bars counter',
    'Con_DN_bars': 'Consecutive DN bars counter',
    'Con_UP_bars(state)': 'Consecutive UP bars within same state',
    'Con_DN_bars(state)': 'Consecutive DN bars within same state',
    'barDuration': 'Time between bars in minutes',
    'stateBarCount': 'Number of bars in current state',
    'stateDuration': 'Total duration in current state',
    'chop(rolling)': 'Rolling chop index',
    'MFE_clr_Bars': 'Forward consecutive same-color bars (0 on immediate reversal)',
    'MFE_clr_price': 'Forward price move during same-color run (always >= 0)',
    'MFE_clr_ADR': 'Forward same-color move normalized by ADR (always >= 0)',
    'MFE_clr_RR': 'Forward same-color move normalized by reversal size (always >= 0)',
    'REAL_clr_ADR': 'MFE minus reversal_size, ADR-normalized (can be negative)',
    'REAL_clr_RR': 'MFE minus reversal_size, reversal-normalized (can be negative)',
    'REAL_MA1_Price': 'Forward price move to bar closing beyond MA1',
    'REAL_MA1_ADR': 'Forward MA1 move normalized by ADR',
    'REAL_MA1_RR': 'Forward MA1 move normalized by reversal size',
    'REAL_MA2_Price': 'Forward price move to bar closing beyond MA2',
    'REAL_MA2_ADR': 'Forward MA2 move normalized by ADR',
    'REAL_MA2_RR': 'Forward MA2 move normalized by reversal size',
    'REAL_MA3_Price': 'Forward price move to bar closing beyond MA3',
    'REAL_MA3_ADR': 'Forward MA3 move normalized by ADR',
    'REAL_MA3_RR': 'Forward MA3 move normalized by reversal size',
  }

  // Match EMA_rawDistance/normDistance columns dynamically
  const getTooltip = (col) => {
    if (columnTooltips[col]) return columnTooltips[col]
    const rawMatch = col.match(/^EMA_rawDistance\((\d+)\)$/)
    if (rawMatch) return `Raw price distance from EMA(${rawMatch[1]})`
    const normMatch = col.match(/^EMA_adrDistance\((\d+)\)$/)
    if (normMatch) return `ADR-normalized distance from EMA(${normMatch[1]})`
    const rrMatch = col.match(/^EMA_rrDistance\((\d+)\)$/)
    if (rrMatch) return `Reversal-size-normalized distance from EMA(${rrMatch[1]})`
    return null
  }

  const formatCell = (value) => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'number') {
      if (Number.isNaN(value)) return 'NaN'
      if (!Number.isFinite(value)) return String(value)
      // Show integers as-is, floats with up to 6 decimals
      if (Number.isInteger(value)) return String(value)
      return value.toFixed(6).replace(/\.?0+$/, '')
    }
    if (typeof value === 'boolean') return value ? 'true' : 'false'
    return String(value)
  }

  return (
    <div className="parquet-page">
      <div className="parquet-header">
        <span className="parquet-filename">{filename}</span>
        <span className="parquet-row-count">{totalRows.toLocaleString()} rows x {columns.length} cols</span>
        <button className="parquet-back-btn" onClick={onBack}>
          Back to Stats
        </button>
      </div>

      <div className="parquet-table-container">
        <table className="parquet-table">
          <thead>
            <tr>
              <th className="row-num">#</th>
              {columns.map((col) => (
                <th key={col} data-tooltip={getTooltip(col)}>{col}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>
                <td className="row-num">{rowIdx + 1}</td>
                {row.map((cell, colIdx) => (
                  <td key={colIdx}>{formatCell(cell)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default ParquetPage
