import { useState, useEffect, useRef } from 'react'
import './MLResultsPage.css'

function formatTime(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

function MLResultsPage({ report, isTraining, error, progress }) {
  const [elapsed, setElapsed] = useState(0)
  const [finalElapsed, setFinalElapsed] = useState(null)
  const timerRef = useRef(null)
  const startTimeRef = useRef(null)
  const foldResultsRef = useRef([])

  // Track fold results from progress events
  useEffect(() => {
    if (progress?.phase === 'fold_done') {
      foldResultsRef.current = [
        ...foldResultsRef.current.filter(f => f.fold !== progress.fold),
        { fold: progress.fold, accuracy: progress.fold_accuracy }
      ]
    }
  }, [progress])

  // Timer management
  useEffect(() => {
    if (isTraining) {
      startTimeRef.current = Date.now()
      foldResultsRef.current = []
      setElapsed(0)
      setFinalElapsed(null)
      timerRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }, 1000)
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (startTimeRef.current && !error) {
        setFinalElapsed(Math.floor((Date.now() - startTimeRef.current) / 1000))
      }
      startTimeRef.current = null
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [isTraining])

  if (isTraining) {
    const pct = progress?.progress ?? 0
    const message = progress?.message || 'Starting...'
    const folds = foldResultsRef.current

    return (
      <div className="ml-results-page">
        <div className="ml-progress-container">
          <span className="ml-progress-message">{message}</span>

          <div className="ml-progress-bar-row">
            <div className="ml-progress-bar-track">
              <div className="ml-progress-bar-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="ml-progress-pct">{pct}%</span>
          </div>

          <span className="ml-progress-timer">{formatTime(elapsed)}</span>

          {folds.length > 0 && (
            <div className="ml-fold-chips">
              {folds.map(f => (
                <span key={f.fold} className="ml-fold-chip">
                  Fold {f.fold}: {(f.accuracy * 100).toFixed(1)}%
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="ml-results-page">
        <div className="ml-empty">
          <span className="ml-error-text">{error}</span>
        </div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="ml-results-page">
        <div className="ml-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M12 6v6l4 2" />
            <circle cx="12" cy="12" r="10" />
          </svg>
          <span>Train a model to see results here</span>
        </div>
      </div>
    )
  }

  const cr = report.classification_report || {}
  const cm = report.confusion_matrix || [[0,0],[0,0]]
  const fi = report.feature_importance || []
  const folds = report.fold_metrics || []
  const maxImportance = fi.length > 0 ? fi[0].importance : 1

  return (
    <div className="ml-results-page">
      <div className="ml-results-scroll">
        {/* Header */}
        <div className="ml-results-header">
          <div className="ml-results-header-row">
            <h2 className="ml-results-title">{report.model_name}</h2>
            {finalElapsed != null && (
              <span className="ml-completed-time">Completed in {formatTime(finalElapsed)}</span>
            )}
          </div>
          <span className="ml-results-meta">
            {report.target_column} &ge; {report.win_threshold}
            {report.filter_expr && <> &middot; filter: <code>{report.filter_expr}</code></>}
          </span>
        </div>

        {/* Summary Cards */}
        <div className="ml-summary-grid">
          <div className="ml-summary-card">
            <span className="ml-card-value">{report.n_rows?.toLocaleString()}</span>
            <span className="ml-card-label">Rows</span>
          </div>
          <div className="ml-summary-card">
            <span className="ml-card-value">{(report.win_rate * 100).toFixed(1)}%</span>
            <span className="ml-card-label">Win Rate</span>
          </div>
          <div className="ml-summary-card">
            <span className="ml-card-value">{(report.cv_accuracy * 100).toFixed(1)}%</span>
            <span className="ml-card-label">CV Accuracy</span>
          </div>
          <div className="ml-summary-card">
            <span className="ml-card-value">{report.features?.length}</span>
            <span className="ml-card-label">Features</span>
          </div>
        </div>

        {/* Classification Report */}
        <div className="ml-section">
          <h3 className="ml-section-title">Classification Report</h3>
          <table className="ml-table">
            <thead>
              <tr>
                <th>Class</th>
                <th>Precision</th>
                <th>Recall</th>
                <th>F1-Score</th>
                <th>Support</th>
              </tr>
            </thead>
            <tbody>
              {['0', '1'].map(cls => {
                const row = cr[cls]
                if (!row) return null
                return (
                  <tr key={cls}>
                    <td className="ml-class-label">{cls === '0' ? 'Loss (0)' : 'Win (1)'}</td>
                    <td>{row.precision?.toFixed(3)}</td>
                    <td>{row.recall?.toFixed(3)}</td>
                    <td>{row['f1-score']?.toFixed(3)}</td>
                    <td>{row.support}</td>
                  </tr>
                )
              })}
              {cr['weighted avg'] && (
                <tr className="ml-table-summary">
                  <td>Weighted Avg</td>
                  <td>{cr['weighted avg'].precision?.toFixed(3)}</td>
                  <td>{cr['weighted avg'].recall?.toFixed(3)}</td>
                  <td>{cr['weighted avg']['f1-score']?.toFixed(3)}</td>
                  <td>{cr['weighted avg'].support}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Confusion Matrix */}
        <div className="ml-section">
          <h3 className="ml-section-title">Confusion Matrix</h3>
          <div className="ml-cm-container">
            <div className="ml-cm-label-top">Predicted</div>
            <div className="ml-cm-grid-wrapper">
              <div className="ml-cm-label-left">Actual</div>
              <div className="ml-cm-grid">
                <div className="ml-cm-header"></div>
                <div className="ml-cm-header">Pred 0</div>
                <div className="ml-cm-header">Pred 1</div>

                <div className="ml-cm-row-label">Act 0</div>
                <div className="ml-cm-cell correct">{cm[0]?.[0] ?? 0}</div>
                <div className="ml-cm-cell incorrect">{cm[0]?.[1] ?? 0}</div>

                <div className="ml-cm-row-label">Act 1</div>
                <div className="ml-cm-cell incorrect">{cm[1]?.[0] ?? 0}</div>
                <div className="ml-cm-cell correct">{cm[1]?.[1] ?? 0}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Feature Importance */}
        <div className="ml-section">
          <h3 className="ml-section-title">Feature Importance</h3>
          <div className="ml-fi-list">
            {fi.map((item, idx) => (
              <div key={idx} className="ml-fi-row">
                <span className="ml-fi-name">{item.feature}</span>
                <div className="ml-fi-bar-bg">
                  <div
                    className="ml-fi-bar"
                    style={{ width: `${(item.importance / maxImportance) * 100}%` }}
                  />
                </div>
                <span className="ml-fi-value">{item.importance.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Per-Fold Results */}
        {folds.length > 0 && (
          <div className="ml-section">
            <h3 className="ml-section-title">Per-Fold Results</h3>
            <table className="ml-table">
              <thead>
                <tr>
                  <th>Fold</th>
                  <th>Train Size</th>
                  <th>Val Size</th>
                  <th>Accuracy</th>
                  <th>Val Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {folds.map((fold, idx) => (
                  <tr key={idx}>
                    <td>{fold.fold}</td>
                    <td>{fold.train_size?.toLocaleString()}</td>
                    <td>{fold.val_size?.toLocaleString()}</td>
                    <td>{(fold.accuracy * 100).toFixed(1)}%</td>
                    <td>{(fold.val_win_rate * 100).toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default MLResultsPage
