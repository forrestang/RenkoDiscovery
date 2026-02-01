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

        {/* Training Configuration */}
        <div className="ml-section">
          <h3 className="ml-section-title">Training Configuration</h3>
          <div className="ml-config-grid">
            <span className="ml-config-label">Source File</span>
            <span className="ml-config-value mono">{report.source_parquet?.split(/[/\\]/).pop()}</span>

            <span className="ml-config-label">Target Column</span>
            <span className="ml-config-value mono">{report.target_column}</span>

            <span className="ml-config-label">Win Threshold</span>
            <span className="ml-config-value mono">{report.win_threshold}</span>

            <span className="ml-config-label">Row Filter</span>
            <span className="ml-config-value mono">{report.filter_expr || 'None'}</span>

            <span className="ml-config-label" title={`Data was split into ${report.n_splits} sequential chunks. Each fold trains on all prior chunks and tests on the next.`}>CV Folds</span>
            <span className="ml-config-value mono">{report.n_splits}</span>

            <span className="ml-config-label">Created</span>
            <span className="ml-config-value mono">{report.created_at ? new Date(report.created_at).toLocaleString() : '—'}</span>

            <span className="ml-config-label">Features ({report.features?.length})</span>
            <span className="ml-config-value mono ml-config-features">{report.features?.join(', ')}</span>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="ml-summary-grid">
          <div className="ml-summary-card" title={`${report.n_rows?.toLocaleString()} rows were used for training and validation after applying any filters.`}>
            <span className="ml-card-value">{report.n_rows?.toLocaleString()}</span>
            <span className="ml-card-label">Rows</span>
          </div>
          <div className="ml-summary-card" title={`${(report.win_rate * 100).toFixed(1)}% of rows in the data have ${report.target_column} >= ${report.win_threshold}. This is the natural occurrence rate in your data, not a model prediction.`}>
            <span className="ml-card-value">{(report.win_rate * 100).toFixed(1)}%</span>
            <span className="ml-card-label">Data Win Rate</span>
          </div>
          <div className="ml-summary-card" title={`The model correctly predicted win/loss on ${(report.cv_accuracy * 100).toFixed(1)}% of unseen rows, averaged across all ${report.n_splits} cross-validation folds.`}>
            <span className="ml-card-value">{(report.cv_accuracy * 100).toFixed(1)}%</span>
            <span className="ml-card-label">CV Accuracy</span>
          </div>
          <div className="ml-summary-card" title={`${report.features?.length} features were provided to the model for learning. Features with 0% importance had no effect on predictions.`}>
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
                <th title="Of all predictions for this class, the fraction that were correct.">Precision</th>
                <th title="Of all actual instances of this class, the fraction the model correctly identified.">Recall</th>
                <th title="Harmonic mean of precision and recall. Balances both into a single score — drops sharply if either is weak.">F1-Score</th>
                <th title="The number of actual rows belonging to this class in the validation data.">Support</th>
              </tr>
            </thead>
            <tbody>
              {['0', '1'].map(cls => {
                const row = cr[cls]
                if (!row) return null
                const label = cls === '0' ? 'Loss' : 'Win'
                return (
                  <tr key={cls}>
                    <td className="ml-class-label">{cls === '0' ? 'Loss (0)' : 'Win (1)'}</td>
                    <td title={`Of all rows the model predicted as ${label}, ${(row.precision * 100).toFixed(1)}% actually were.`}>{row.precision?.toFixed(3)}</td>
                    <td title={`Of all actual ${label} rows, the model correctly caught ${(row.recall * 100).toFixed(1)}% of them.`}>{row.recall?.toFixed(3)}</td>
                    <td title={`The model is ${(row['f1-score'] * 100).toFixed(1)}% effective at both finding and correctly labeling ${label} rows.`}>{row['f1-score']?.toFixed(3)}</td>
                    <td title={`${row.support} actual ${label} rows were in the validation data.`}>{row.support}</td>
                  </tr>
                )
              })}
              {cr['weighted avg'] && (
                <tr className="ml-table-summary">
                  <td title="Average weighted by each class's support count, so the majority class has more influence.">Weighted Avg</td>
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
            <div className="ml-cm-label-top" title="Columns show what the model predicted. Rows show what actually happened. Green = correct, red = mistakes.">Predicted</div>
            <div className="ml-cm-grid-wrapper">
              <div className="ml-cm-label-left">Actual</div>
              <div className="ml-cm-grid">
                <div className="ml-cm-header"></div>
                <div className="ml-cm-header">Pred 0</div>
                <div className="ml-cm-header">Pred 1</div>

                <div className="ml-cm-row-label">Act 0</div>
                <div className="ml-cm-cell correct" title={`${cm[0]?.[0] ?? 0} actual losses were correctly predicted as losses.`}>{cm[0]?.[0] ?? 0}</div>
                <div className="ml-cm-cell incorrect" title={`${cm[0]?.[1] ?? 0} actual losses were wrongly predicted as wins (false alarms).`}>{cm[0]?.[1] ?? 0}</div>

                <div className="ml-cm-row-label">Act 1</div>
                <div className="ml-cm-cell incorrect" title={`${cm[1]?.[0] ?? 0} actual wins were wrongly predicted as losses (missed opportunities).`}>{cm[1]?.[0] ?? 0}</div>
                <div className="ml-cm-cell correct" title={`${cm[1]?.[1] ?? 0} actual wins were correctly predicted as wins.`}>{cm[1]?.[1] ?? 0}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Feature Importance */}
        <div className="ml-section">
          <h3 className="ml-section-title" title="Scores are normalized to sum to 100%. Higher means the model relied more on this feature to split decisions.">Feature Importance</h3>
          <div className="ml-fi-list">
            {fi.map((item, idx) => (
              <div key={idx} className="ml-fi-row" title={`${item.feature} contributed ${item.importance.toFixed(2)}% of the model's decision-making.${item.importance === 0 ? ' This feature had no effect on predictions.' : ''}`}>
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
            <h3 className="ml-section-title" title="Each fold trains a separate model from scratch on past data, then tests it on the next unseen chunk. Results vary because the data shifts over time.">Per-Fold Results</h3>
            <table className="ml-table">
              <thead>
                <tr>
                  <th title="Sequential fold number. Each fold trains on all data before it.">Fold</th>
                  <th title="Number of rows the model learned from. Grows each fold as more past data becomes available.">Train Size</th>
                  <th title="Number of rows the model was tested on. Accuracy is measured against these rows.">Val Size</th>
                  <th title="Percentage of validation rows the model predicted correctly.">Accuracy</th>
                  <th title="The percentage of wins in this fold's validation data. This is the actual makeup of the data, not a prediction.">Val Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {folds.map((fold, idx) => (
                  <tr key={idx}>
                    <td>{fold.fold}</td>
                    <td title={`Fold ${fold.fold} trained on ${fold.train_size?.toLocaleString()} rows of past data.`}>{fold.train_size?.toLocaleString()}</td>
                    <td title={`Fold ${fold.fold} was tested on ${fold.val_size?.toLocaleString()} unseen rows.`}>{fold.val_size?.toLocaleString()}</td>
                    <td title={`The model got ${(fold.accuracy * 100).toFixed(1)}% of its ${fold.val_size?.toLocaleString()} predictions correct.`}>{(fold.accuracy * 100).toFixed(1)}%</td>
                    <td title={`${(fold.val_win_rate * 100).toFixed(1)}% of the ${fold.val_size?.toLocaleString()} validation rows were actual wins — this is the data composition, not a model prediction.`}>{(fold.val_win_rate * 100).toFixed(1)}%</td>
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
