import { useState } from 'react';

export const COLUMN_DESCRIPTIONS = {
  // System
  'currentADR': 'Average Daily Range recalculated at each bar; measures current volatility.',
  'chop(rolling)': 'Choppiness Index (rolling n-period). Higher values = choppier/range-bound market. Range: 0.0-1.0',

  // Signals
  'Type1': '3-bar reversal pattern counter. Positive = bullish (DN\u2192UP\u2192UP in State +3), Negative = bearish (UP\u2192DN\u2192DN in State -3).',
  'Type2': 'Wick-based pullback counter. Triggers only when reversal > brick size and wick > brick size.',

  // OHLC & Price
  'open, high, low, close, direction': 'Current bar OHLC prices and bar direction.',
  'open1, high1, low1, close1, direction1': 'Prior bar (-1) OHLC prices & direction.',
  'open2, high2, low2, close2, direction2': 'Two bars back (-2) OHLC prices & direction.',

  // Moving Averages
  'EMA_rawDistance(20/50/200)': 'Raw price distance from EMA (close \u2212 EMA value).',
  'EMA_adrDistance(20/50/200)': 'Price distance from EMA normalized by ADR \u2014 how many ADRs away from the EMA to current close.',
  'EMA_rrDistance(20/50/200)': 'Price distance from EMA normalized by reversal size \u2014 how many RR away from the EMA to current close.',
  'MA1, MA2, MA3': 'Current EMA values (fast, medium, slow).',
  'MA1_1, MA2_1, MA3_1': 'Prior bar EMA values.',
  'MA1_2, MA2_2, MA3_2': 'Two bars back EMA values.',

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
  'REAL_clr_ADR': 'Realistic MFE (MFE minus 1 reversal) in ADR units \u2014 accounts for entry cost.',
  'REAL_clr_RR': 'Realistic MFE in RR units \u2014 accounts for entry cost.',
  'REAL_MA1_Price, REAL_MA1_ADR, REAL_MA1_RR': 'MFE measured to MA1 (fast EMA) in price/ADR/RR.',
  'REAL_MA2_Price, REAL_MA2_ADR, REAL_MA2_RR': 'MFE measured to MA2 (medium EMA) in price/ADR/RR.',
  'REAL_MA3_Price, REAL_MA3_ADR, REAL_MA3_RR': 'MFE measured to MA3 (slow EMA) in price/ADR/RR.',
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
