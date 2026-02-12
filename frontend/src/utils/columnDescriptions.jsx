import { useState } from 'react';

export const COLUMN_DESCRIPTIONS = {
  // System
  'currentADR': 'Average Daily Range recalculated at each bar; measures current volatility.',
  'chop(rolling)': 'Choppiness Index (rolling n-period). Higher values = choppier/range-bound market. Range: 0.0-1.0',

  // Signals
  'Type1': 'Pullback pattern counter. FP: 3-bar reversal (DN\u2192UP\u2192UP / UP\u2192DN\u2192DN in State \u00b13). TV: 2-bar reversal with DD > brick (DN\u2192UP / UP\u2192DN in State \u00b13).',
  'Type2': 'Pullback pattern counter. FP: 3-bar bounce-back (UP\u2192DN\u2192UP / DN\u2192UP\u2192DN in State \u00b13). TV: 2-bar continuation with DD > brick and close vs MA1 (UP\u2192UP / DN\u2192DN in State \u00b13).',

  // OHLC & Price
  'open, high, low, close, direction': 'Current bar OHLC prices and bar direction.',
  'open1, high1, low1, close1, direction1': 'Prior bar (-1) OHLC prices & direction.',
  'open2, high2, low2, close2, direction2': 'Two bars back (-2) OHLC prices & direction.',

  // DateTimes
  'Year, Month, Day, Hour, Minute': '2024-01-24T14:29 resolves to:\nYear - 2024\nMonth - 01\nDay - 24\nHour - 14\nMinute - 29',

  // Moving Averages
  'EMA_rawDistance(20/50/200)': 'Raw price distance from EMA (close \u2212 EMA value).',
  'EMA_adrDistance(20/50/200)': 'Price distance from EMA normalized by ADR \u2014 how many ADRs away from the EMA to current close.',
  'EMA_rrDistance(20/50/200)': 'Price distance from EMA normalized by reversal size \u2014 how many RR away from the EMA to current close.',
  'MA1, MA2, MA3': 'Current EMA values (fast, medium, slow).',
  'MA1_1, MA2_1, MA3_1': 'Prior bar EMA values.',
  'MA1_2, MA2_2, MA3_2': 'Two bars back EMA values.',

  // SMAE Channel
  'SMAE1_Upper, SMAE1_Lower': 'Upper and lower bands of SMAE1 envelope (SMA ± deviation%).',
  'SMAE2_Upper, SMAE2_Lower': 'Upper and lower bands of SMAE2 envelope (SMA ± deviation%).',

  // PWAP
  'PWAP_Mean': 'Session PWAP mean price (resets each session).',
  'PWAP_Upper1, PWAP_Lower1': 'PWAP ±1σ bands.',
  'PWAP_Upper2, PWAP_Lower2': 'PWAP ±2σ bands.',
  'PWAP_Upper3, PWAP_Lower3': 'PWAP ±3σ bands.',
  'PWAP_Upper4, PWAP_Lower4': 'PWAP ±4σ bands.',
  'PWAP_distance_RR': 'Distance from close to PWAP Mean normalized by reversal size.',
  'PWAP_distance_ADR': 'Distance from close to PWAP Mean normalized by ADR.',

  // State & Structure
  'State': 'MA alignment score from -3 to +3. +3 = Fast > Med > Slow, -3 = Slow > Med > Fast.',
  'prState': 'Prior bar State value.',
  'fromState': 'State of the previous run \u2014 persists throughout the current state to show where price transitioned from.',
  'stateBarCount': 'Number of bars since the current State value began.',

  // Consecutive Bars
  'Con_UP_bars': 'Count of consecutive UP direction bars; resets on direction change.',
  'Con_DN_bars': 'Count of consecutive DOWN direction bars; resets on direction change.',
  'Con_UP_bars(state)': 'Consecutive UP bars within the same State; resets on state or direction change.',
  'Con_DN_bars(state)': 'Consecutive DOWN bars within the same State; resets on state or direction change.',
  'priorRunCount': 'Occurrence count within a state run \u2014 e.g., 1 = first occurrence in this run.',

  // Drawdown / Wick
  'DD': 'Drawdown from entry in raw price. Opposite wick size.',
  'DD_RR': 'Drawdown normalized by reversal size/Wick (how many RR of adverse movement).',
  'DD_ADR': 'Drawdown normalized by ADR/Wick (how many ADRs of adverse movement).',

  // Duration
  'barDuration': 'Time in minutes it took for the bar to complete.',
  'stateDuration': 'Number of bars since the last State change.',

  // MFE / Outcome
  'MFE_clr_Bars': 'Number of bars to reach Maximum Favorable Excursion (b4 color change).',
  'MFE_clr_price': 'MFE price value (raw) at color change.',
  'MFE_clr_ADR': 'MFE normalized by ADR at color change.',
  'MFE_clr_RR': 'MFE normalized by reversal size at color change.',
  'REAL_clr_ADR': 'Realistic Exit accounts for color change (MFE minus 1 reversal) in ADR units.',
  'REAL_clr_RR': 'Realistic Exit accounts for color change (MFE minus 1 reversal) in RR units.',
  'REAL_MA1_Price, REAL_MA1_ADR, REAL_MA1_RR': 'Exit on first close back thru MA1 (fast EMA) in price/ADR/RR.',
  'REAL_MA2_Price, REAL_MA2_ADR, REAL_MA2_RR': 'Exit on first close back thru MA2 (medium EMA) in price/ADR/RR.',
  'REAL_MA3_Price, REAL_MA3_ADR, REAL_MA3_RR': 'Exit on first close back thru MA3 (slow EMA) in price/ADR/RR.',
};

export function ColumnItem({ label, desc }) {
  const [open, setOpen] = useState(false);
  return (
    <li>
      <code>{label}</code>
      {desc && (
        <button className="col-tooltip-btn" onClick={() => setOpen(v => !v)}>?</button>
      )}
      {open && <div className="col-tooltip-desc">{desc}</div>}
    </li>
  );
}
