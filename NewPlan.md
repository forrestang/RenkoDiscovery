## Plan 1: Reimplement ADR-Based Renko Bar Generation

### Summary

Add a toggleable "ADR mode" alongside the existing fixed-price Renko sizing. In ADR mode, brick size and reversal size are expressed as percentages of the rolling Average Daily Range, recalculated at each UTC session boundary (00:00 UTC). Sessions with insufficient ADR history are skipped entirely.

### Historical Context

The previous attempt at this feature (commit `b36c0cc`) was removed because bars appeared incorrectly built. However, a later discovery revealed that LWC was interpreting datetime strings as local time instead of UTC, causing session-break lines to render at wrong chart positions (fixed in commit `9197b2b` by appending `'Z'` to datetimes). The backend session boundary logic (grouping by `dt.date` on UTC-localized datetimes) was likely correct — the visual misalignment on the chart made it *appear* that bars were sized wrong relative to sessions. The current codebase has the UTC fix in place, so this reimplementation should not encounter the same display issue.

---

### Backend Changes

#### Files: `backend/main.py`

#### Step 1: Extend `RenkoRequest` model (line 76)

Add fields to support ADR mode:
- `sizing_mode: str = "price"` — `"price"` or `"adr"`
- `brick_pct: float = 5.0` — brick size as % of ADR
- `reversal_pct: float = 10.0` — reversal size as % of ADR
- `adr_period: int = 14` — lookback period for ADR calculation

Existing fields (`brick_size`, `reversal_size`) remain for price mode. Defaults preserve backward compatibility.

#### Step 2: Extract `compute_adr_lookup()` helper

Refactor the existing ADR logic (lines 1162-1185) into a standalone function:

```python
def compute_adr_lookup(df: pd.DataFrame, adr_period: int) -> dict:
```

- Groups M1 data by `utc_date`
- Calculates daily range (high - low) per day
- Returns dict: `{utc_date: rolling_adr_value}` using `shift(1).rolling(window=adr_period, min_periods=adr_period).mean()`
- Dates without enough history map to `NaN`

#### Step 3: Add `size_schedule` parameter to `generate_renko_custom` (line 672)

New optional parameter:
```python
size_schedule: list[tuple[int, float, float]] | None = None
```

Each tuple is `(m1_bar_index, brick_size, reversal_size)`. When provided:
- The state machine tracks a `schedule_idx` starting at 0
- At each M1 bar, if the next schedule entry's index has been reached, advance `schedule_idx` and update `brick_size` / `reversal_size`
- Recalculate thresholds relative to `current_level` (last brick close) using new sizes
- Store `reversal_size` per brick (new column alongside existing `brick_size` column)
- When `size_schedule is None`, behavior is identical to current (fixed brick_size)

Key state machine update logic at session boundaries:
- `current_level` persists (it's an absolute price)
- Only threshold distances change: `up_threshold = current_level + new_brick_size`, etc.
- The `reversal_multiplier` becomes `reversal_size / brick_size` per-session (varies since both are independent % of ADR)

#### Step 4: Update `/renko/{instrument}` endpoint (line ~1015)

When `request.sizing_mode == "adr"`:
1. Call `compute_adr_lookup(df, request.adr_period)` to get per-date ADR values
2. Walk the M1 dataframe's dates to build `size_schedule`:
   - For each new UTC date, look up ADR; skip dates where ADR is NaN
   - `brick_size = adr * brick_pct / 100`, `reversal_size = adr * reversal_pct / 100`
3. Trim the dataframe to start from the first session with valid ADR
4. Pass `size_schedule` to `generate_renko_custom`
5. Return per-brick `brick_size` and `reversal_size` arrays in `data` dict

When `request.sizing_mode == "price"`: no changes, existing code path runs as-is.

#### Step 5: Update `/stats/{instrument}` endpoint (line ~1123)

The stats endpoint currently sets `df['reversal_size'] = request.reversal_size` as a scalar (line ~1155). Change this:
- If `renko_data` contains a `reversal_size` array, use it as the per-brick column
- If `renko_data` contains a `brick_size` array, use it as the per-brick column
- Otherwise fall back to scalars from `StatsRequest` (backward compat)

This ensures `REAL_clr` calculations (which already reference `df['reversal_size']` per-row) work correctly with variable sizes.

---

### Frontend Changes

#### Step 6: Update `RenkoControls.jsx`

Add a mode toggle (small segmented button: "Price" / "ADR%") above or beside the existing inputs:
- **Price mode** (current default): Show Brick and Rev inputs as-is (step=0.0001, raw price values)
- **ADR% mode**: Show:
  - Brick % input (step=0.5, default=5, suffix "Brick %")
  - Rev % input (step=0.5, default=10, suffix "Rev %")
  - ADR Period input (integer, step=1, default=14, suffix "ADR")

Trigger `onChange()` when switching modes or when active-mode inputs are committed.

#### Step 7: Update `App.jsx` state management (line 81-112)

Extend `renkoSettings` shape:
```javascript
{
  sizingMode: 'price',    // 'price' | 'adr'
  brickSize: 0.0010,      // price mode
  reversalSize: 0.0020,   // price mode
  brickPct: 5,            // adr mode
  reversalPct: 10,        // adr mode
  adrPeriod: 14,          // adr mode
  wickMode: 'all'
}
```

Add localStorage migration for existing entries missing new fields.

#### Step 8: Update `loadRenko` API call (line ~622)

Build request body based on `sizingMode`:
- Price mode: send `brick_size`, `reversal_size` (current behavior)
- ADR mode: send `brick_pct`, `reversal_pct`, `adr_period`
- Always send `sizing_mode`

#### Step 9: Update `ChartArea.jsx` indicator pane (line 1095)

The Type1/Type2 pattern logic uses `reversalSize > brickSize` to choose 3-bar vs 2-bar patterns. In ADR mode, pass per-brick arrays from `renkoData.data.brick_size` and `renkoData.data.reversal_size` and index per-bar instead of using scalar props.

---

### Critical Files

| File | Changes |
|------|---------|
| `backend/main.py` | RenkoRequest model, compute_adr_lookup helper, generate_renko_custom size_schedule, /renko endpoint, /stats endpoint |
| `frontend/src/components/RenkoControls.jsx` | Mode toggle UI, conditional inputs |
| `frontend/src/App.jsx` | renkoSettings state, localStorage migration, loadRenko API call |
| `frontend/src/components/ChartArea.jsx` | Per-brick brickSize/reversalSize for indicator pane |
| `frontend/src/styles/App.css` | Styles for mode toggle and ADR inputs |

---

### Verification

1. **Regression**: Price mode produces identical output to current version (same brick count, same OHLC values)
2. **ADR mode basic**: Load a pair in ADR mode (5% brick, 10% rev, 14-period). Verify bricks appear only after 14 sessions. Visually confirm varying brick sizes across sessions.
3. **Session boundary check**: Inspect per-brick `brick_size` array — values should change at UTC date boundaries
4. **Edge case**: Data with fewer sessions than ADR period returns a clear error
5. **Stats pipeline**: Run stats on ADR-mode data. Verify `REAL_clr_RR` uses per-brick reversal sizes (values should vary row-to-row)
6. **Persistence**: Switch modes, set custom values, refresh page — settings restored correctly
7. **Mode toggle**: Switching between Price/ADR regenerates chart immediately

---

----------------------------------------------------
***************************************************
----------------------------------------------------

## Plan 2: Data Cleaning & Back-Adjustment at Import Time

### Summary

Add two optional data processing steps during CSV import (at `/process` time), controlled by checkboxes on the Data tab. These modify the `.feather` cache before it's saved, so all downstream operations (renko generation, stats, charting) automatically get clean/adjusted data.

### Feature A: Clean Holidays / Bad Data

**Purpose:** Remove entire calendar days (UTC) that have abnormally low bar counts — holidays, half-days, or days with bad/sparse data.

**Algorithm:**
1. After combining and deduplicating all M1 bars for an instrument (existing step in `/process`), group by UTC calendar date
2. Count M1 bars per day
3. Calculate the median bar count across all days
4. Drop every day where the bar count is below 50% of the median
5. Reset the DataFrame index after dropping

**Threshold:** Hardcoded at 50% of median. Simple and reasonable — a typical forex day has ~1440 M1 bars, so anything under ~720 gets cut. This catches Christmas, New Year's, and other shortened sessions.

### Feature B: Back-Adjust (Eliminate Inter-Session Price Gaps)

**Purpose:** Chain-adjust all sessions backwards from the most recent one so there are zero price jumps between sessions. The most recent session's prices remain unchanged (anchor point). All prior sessions get shifted.

**Algorithm:**
1. After cleaning (if cleaning is also enabled), identify day boundaries in the M1 data by grouping on UTC date
2. Work backwards from the most recent day:
   - For each day boundary: `gap = next_day_first_open - current_day_last_close`
   - Accumulate the gap
   - Subtract the cumulative gap from all OHLC prices (`open`, `high`, `low`, `close`) of the current day and all prior days
3. The most recent day is the anchor — its prices are untouched

**Order of operations:** If both options are enabled, cleaning runs first, then back-adjustment runs on the cleaned data. This prevents the adjuster from trying to bridge gaps across days that shouldn't be in the dataset. If only one option is selected, it runs standalone with no dependency.

---

### Backend Changes

#### File: `backend/main.py`

#### Step 1: Extend `ProcessRequest` model

Add two boolean fields:
- `clean_holidays: bool = False`
- `back_adjust: bool = False`

Defaults preserve backward compatibility — existing callers are unaffected.

#### Step 2: Add `clean_holidays()` function

```python
def clean_holidays(df: pd.DataFrame) -> pd.DataFrame:
```

- Assumes `df` has a `datetime` column (already parsed as datetime)
- Groups by `df['datetime'].dt.date`
- Counts bars per day
- Calculates median bar count
- Drops all rows belonging to days with count < 50% of median
- Returns the filtered DataFrame with reset index

#### Step 3: Add `back_adjust_data()` function

```python
def back_adjust_data(df: pd.DataFrame) -> pd.DataFrame:
```

- Groups by `df['datetime'].dt.date` to identify day boundaries
- Gets the unique dates sorted chronologically
- Iterates backwards from the second-to-last date:
  - `gap = first_open_of_next_day - last_close_of_current_day`
  - Accumulates the gap
  - Subtracts cumulative gap from `open`, `high`, `low`, `close` for all rows on the current day and all prior days
- Returns the adjusted DataFrame

#### Step 4: Call in `/process` endpoint

After the existing deduplication and sorting step (around line 562), and before saving to .feather:

```python
if request.clean_holidays:
    combined = clean_holidays(combined)

if request.back_adjust:
    combined = back_adjust_data(combined)
```

#### Step 5: Update `.meta.json`

Add `clean_holidays` and `back_adjust` boolean fields to the metadata dict so the UI can reflect what was applied to a cached dataset.

---

### Frontend Changes

#### File: `frontend/src/components/Sidebar.jsx`

#### Step 6: Add state variables

```javascript
const [cleanHolidays, setCleanHolidays] = useState(false);
const [backAdjust, setBackAdjust] = useState(false);
```

#### Step 7: Add checkboxes to Import Settings section

Place two checkboxes in the Import Settings area (near the Format/Interval toggles, before the Process button):

- **"Clean holidays/bad data"** — tooltip: "Removes sessions with fewer than 50% of the typical day's bar count"
- **"Back-adjust gaps"** — tooltip: "Eliminates inter-session price gaps by adjusting prior sessions"

Style consistently with the existing toggle buttons in that section.

#### Step 8: Pass flags in `/process` POST request

Add `clean_holidays` and `back_adjust` to the request body sent to the `/process` endpoint alongside the existing `files`, `working_dir`, `data_format`, `interval_type`, and `custom_name` fields.

---

### Critical Files

| File | Changes |
|------|---------|
| `backend/main.py` | ProcessRequest model, `clean_holidays()` function, `back_adjust_data()` function, `/process` endpoint, `.meta.json` output |
| `frontend/src/components/Sidebar.jsx` | State variables, checkbox UI, POST request body |

---

### Verification

1. **Regression**: Import a dataset with both checkboxes off — confirm .feather output is identical to current behavior
2. **Clean only**: Import with clean enabled — inspect the .feather and confirm short days (holidays) are gone. Compare day counts before/after.
3. **Back-adjust only**: Import with back-adjust enabled — load the chart and confirm no visible price jumps between sessions
4. **Both enabled**: Import with both on — confirm cleaning runs first (short days removed), then back-adjustment applied to remaining data with no gaps
5. **Metadata**: Check `.meta.json` records which options were used
6. **Edge cases**: Single-day dataset (nothing to clean or adjust), dataset with no holidays (clean is a no-op), dataset where all days are sparse (should warn or return empty)

---
