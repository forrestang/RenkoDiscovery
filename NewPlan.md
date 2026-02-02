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

● Using the 17:00 EST (22:00 UTC) rollover:
  ┌───────────┬────────────┬─────────────┬────────────┬─────────────┬──────────┐
  │  Session  │ Open (EST) │ Close (EST) │ Open (UTC) │ Close (UTC) │ Duration │
  ├───────────┼────────────┼─────────────┼────────────┼─────────────┼──────────┤
  │ Monday    │ Sun 17:00  │ Mon 17:00   │ Sun 22:00  │ Mon 22:00   │ 24h      │
  ├───────────┼────────────┼─────────────┼────────────┼─────────────┼──────────┤
  │ Tuesday   │ Mon 17:00  │ Tue 17:00   │ Mon 22:00  │ Tue 22:00   │ 24h      │
  ├───────────┼────────────┼─────────────┼────────────┼─────────────┼──────────┤
  │ Wednesday │ Tue 17:00  │ Wed 17:00   │ Tue 22:00  │ Wed 22:00   │ 24h      │
  ├───────────┼────────────┼─────────────┼────────────┼─────────────┼──────────┤
  │ Thursday  │ Wed 17:00  │ Thu 17:00   │ Wed 22:00  │ Thu 22:00   │ 24h      │
  ├───────────┼────────────┼─────────────┼────────────┼─────────────┼──────────┤
  │ Friday    │ Thu 17:00  │ Fri 17:00   │ Thu 22:00  │ Fri 22:00   │ 24h      │
  └───────────┴────────────┴─────────────┴────────────┴─────────────┴──────────┘
  Five even 24-hour sessions. The market opens Sunday 17:00 EST, which is the start of Monday's session — not a separate
   Sunday session. The market closes Friday 17:00 EST, which is the end of Friday's session.

  The Sunday stub you were seeing at 22:00 UTC is actually the first few hours of Monday's session. When you split at
  00:00 UTC, you were slicing those hours off into their own "day," creating the short Sunday artifact and making Monday
   appear to start 2 hours late.


----------------------------------------------------
***************************************************
----------------------------------------------------

## Plan 2: Data Cleaning & Back-Adjustment at Import Time

### Summary

Add two optional data processing steps during CSV import (at `/process` time), controlled by checkboxes on the Data tab's left sidebar. These modify the `.feather` cache before it's saved, so all downstream operations (renko generation, stats, charting) automatically get clean/adjusted data.

**Key architectural change:** The session schedule configuration moves into the Data tab import section. The user sets (or loads a saved) session schedule at import time. That schedule is used for cleaning/back-adjustment grouping, stored in `.meta.json`, and read back by the frontend at runtime for chart boundary lines, ADR, etc. The current `SessionControls` in the chart header is replaced by reading the schedule from the loaded instrument's metadata. This means sessions are set once at import — no need to configure them in two places.

**UTC caution:** All datetime-to-session assignment must use UTC. The backend's `_get_session_date(dt, schedule)` (main.py line 678) already handles this correctly — it reads `dt.hour` and `dt.minute` on UTC-localized datetimes. The frontend must continue using `parseUTC()` (not `new Date()`) when interpreting datetimes from the data, as established by the Plan 1 fix. Any new code touching datetimes must follow this same pattern.

---

### Feature A: Clean Holidays / Bad Data

**Purpose:** Remove entire trading sessions that have abnormally low bar counts — holidays, half-days, or sessions with bad/sparse data.

**Algorithm:**
1. After combining and deduplicating all M1 bars (existing step in `/process`), assign each bar to its trading session using `_get_session_date(dt, schedule)` — NOT `df['datetime'].dt.date` (which splits at 00:00 UTC and would break sessions that span midnight, e.g. the 22:00 UTC FX boundary)
2. Count M1 bars per session
3. Calculate the median bar count across all sessions
4. Drop every session where the bar count is below **n-percent** of the median, where **n is a user input** (numeric field on the import UI, default 50%). Example: a typical FX session has ~1440 M1 bars; at 50% threshold, sessions under ~720 bars get removed. This catches Christmas, New Year's, and other shortened sessions.
5. Reset the DataFrame index after dropping

**Threshold:** User-configurable percentage input (not hardcoded). Displayed next to the "Clean holidays" checkbox, only visible when the checkbox is enabled.

### Feature B: Back-Adjust (Eliminate Inter-Session Price Gaps)

**Purpose:** Chain-adjust all sessions backwards from the most recent one so there are zero price jumps between sessions. The most recent session's prices remain unchanged (anchor point). All prior sessions get shifted.

**Algorithm:**
1. After cleaning (if cleaning is also enabled), assign each bar to its trading session using `_get_session_date(dt, schedule)` — same session grouping as cleaning
2. Get unique sessions sorted chronologically
3. Work backwards from the most recent session:
   - For each session boundary: `gap = next_session_first_open - current_session_last_close`
   - Accumulate the gap
   - Add the cumulative gap to all OHLC prices (`open`, `high`, `low`, `close`) of the current session and all prior sessions
4. The most recent session is the anchor — its prices are untouched

**Order of operations:** If both options are enabled, cleaning runs first, then back-adjustment runs on the cleaned data. This prevents the adjuster from trying to bridge gaps across sessions that shouldn't be in the dataset.

---

### Backend Changes

#### File: `backend/main.py`

#### Step 1: Extend `ProcessRequest` model

Add fields:
- `clean_holidays: bool = False`
- `clean_threshold_pct: float = 50.0` — user-configurable percentage threshold
- `back_adjust: bool = False`
- `session_schedule: Optional[dict] = None` — same `{"monday": {"hour": 22, "minute": 0}, ...}` shape used by `RenkoRequest`

Defaults preserve backward compatibility.

#### Step 2: Add `clean_holidays()` function

```python
def clean_holidays(df: pd.DataFrame, schedule: dict, threshold_pct: float = 50.0) -> pd.DataFrame:
```

- Assigns each bar to a session via `_get_session_date(dt, schedule)`
- Counts bars per session, computes median
- Drops sessions with count < `threshold_pct`% of median
- Returns filtered DataFrame with reset index
- If all sessions are removed, returns empty DataFrame (caller checks and reports error)

#### Step 3: Add `back_adjust_data()` function

```python
def back_adjust_data(df: pd.DataFrame, schedule: dict) -> pd.DataFrame:
```

- Assigns each bar to a session via `_get_session_date(dt, schedule)`
- Sorts unique sessions chronologically
- Iterates backwards accumulating gaps between consecutive sessions
- Shifts OHLC of all prior sessions by cumulative gap
- Drops the temporary `_session_date` column before returning

#### Step 4: Wire into `/process` endpoint

After dedup/sort (~line 568), before feather save:

```python
sched = request.session_schedule or _default_schedule()

if request.clean_holidays:
    combined = clean_holidays(combined, sched, request.clean_threshold_pct)
    if len(combined) == 0:
        results.append({"instrument": instrument, "status": "error",
                        "message": "All sessions removed by holiday cleaning"})
        continue

if request.back_adjust:
    combined = back_adjust_data(combined, sched)
```

#### Step 5: Update `.meta.json`

Add to metadata dict:
- `clean_holidays` (bool)
- `clean_threshold_pct` (float, only if clean_holidays is true)
- `back_adjust` (bool)
- `session_schedule` (the resolved schedule dict that was used)

#### Step 6: Expose session schedule via `/chart/{instrument}` response

When the frontend loads a chart, it needs the session schedule that was used at import. Add `session_schedule` to the JSON response of the `/chart/{instrument}` endpoint by reading it from the instrument's `.meta.json`. If the metadata doesn't contain a schedule (older imports), fall back to `_default_schedule()`.

---

### Frontend Changes

#### Step 7: Move SessionControls into the Data tab import section (Sidebar.jsx)

Remove `SessionControls` from the chart header in `App.jsx`. Instead, place the same session schedule UI (template selector, per-day hour/minute grid, save/rename/delete) in the Sidebar's Data tab, in the import settings area above the Process button. The `SessionControls` component itself can be reused as-is — it just moves to a different location.

The session schedule state (`sessionSettings`) stays in `App.jsx` and is passed down to Sidebar as a prop, same as today.

#### Step 8: Add cleaning controls to import section (Sidebar.jsx)

Below the session schedule and above the Process button, add:
- **"Clean holidays"** checkbox + a numeric input for threshold percentage (default 50%, step 5, min 10, max 90). The numeric input only appears when the checkbox is enabled.
- **"Back-adjust gaps"** checkbox

New state in `App.jsx`:
```javascript
const [cleanHolidays, setCleanHolidays] = useState(false)
const [cleanThresholdPct, setCleanThresholdPct] = useState(50)
const [backAdjust, setBackAdjust] = useState(false)
```

#### Step 9: Pass session schedule + flags in `/process` POST request

Extend `handleProcess` body:
```javascript
clean_holidays: cleanHolidays,
clean_threshold_pct: cleanThresholdPct,
back_adjust: backAdjust,
session_schedule: sessionSchedule
```

`sessionSchedule` is already derived from `sessionSettings` via `useMemo`.

#### Step 10: Read session schedule from loaded chart data at runtime

When the frontend loads a chart (response from `/chart/{instrument}`), read the `session_schedule` field from the response. Use this as the active schedule for:
- Drawing session boundary lines on the chart (ChartArea.jsx)
- ADR calculation in renko generation (passed to `/renko/{instrument}`)
- Any other runtime session logic

This replaces the old flow where the user had to separately configure sessions at runtime. The schedule is now baked into the data at import and read back automatically.

---

### Critical Files

| File | Changes |
|------|---------|
| `backend/main.py` | ProcessRequest model, `clean_holidays()`, `back_adjust_data()`, `/process` wiring, `.meta.json`, `/chart` response |
| `frontend/src/App.jsx` | State for clean/adjust options, move sessionSettings usage, handleProcess body, read schedule from chart response |
| `frontend/src/components/Sidebar.jsx` | SessionControls placement in import section, cleaning checkboxes + threshold input |
| `frontend/src/components/ChartArea.jsx` | Receives session schedule from chart data instead of from a separate settings prop |

---

### Verification

1. **Regression**: Import with both checkboxes off — .feather output identical to current behavior
2. **Clean only**: Import with clean at 50% — confirm short sessions (holidays) are removed. The returned result should show how many sessions were dropped.
3. **Back-adjust only**: Import with back-adjust — load chart, confirm no visible price jumps at session boundaries
4. **Both enabled**: Cleaning runs first, then back-adjustment on clean data — no gaps across removed sessions
5. **Session grouping**: Verify sessions are grouped by the configured boundary time (e.g. 22:00 UTC), not by 00:00 UTC. Monday's session should include Sunday 22:00–Monday 22:00, not Monday 00:00–Tuesday 00:00.
6. **UTC correctness**: Verify boundary lines on the chart appear at the correct UTC time (not shifted to local time). This was the Plan 1 bug — ensure it doesn't regress.
7. **Metadata**: `.meta.json` records `clean_holidays`, `clean_threshold_pct`, `back_adjust`, and `session_schedule`
8. **Runtime schedule**: After loading a chart, session boundary lines and ADR use the schedule from `.meta.json` automatically without the user having to set it again
9. **Edge cases**: Empty after cleaning (error reported), single session (back-adjust is no-op), all sessions similar count (clean is no-op)

---
