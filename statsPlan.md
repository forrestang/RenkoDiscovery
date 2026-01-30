# Stats Page Enhancement Ideas

## Tab Structure & Filter Hierarchy

The stats page has two categories of modules, each in its own tab:

**Tab A — Signal Stats** (Modules 1, 2, 3 Table 3)
- These analyze Type1/Type2 signal performance
- Controlled by the **signal filter** (Type1/Type2 checkboxes + Nth occurrence) and the **FX column dropdown**
- Both controls live inside this tab — they don't apply globally

**Tab B — All-Bars Stats** (existing modules + new Modules 3 Tables 1-2, 4, 5, 6, 8, 9, 10)
- These analyze every bar regardless of signal presence
- Existing modules: General, Global Chop Index, State Distribution, Bar Location (all/beyond), Runs Decay, Runs Distribution, EMA RR Distance Decay, Wick Distribution
- New modules from this plan: Module 3 Tables 1-2 (chop regime overview + state dist by chop), Module 4 (time-of-day), Module 5 (state x conbars heatmap), Module 6 (state transition matrix), Module 8 (run length vs forward move), Module 9 (drawdown by context), Module 10 (EMA distance scatterplot)
- Module 7 (chop global toggle) would be a filter control inside this tab, re-filtering all-bars stats by chop regime

---

**Metric note**: The parquet contains three normalizations for most metrics: raw price, ADR-normalized, and RR-normalized. Each module notes which metric is best suited. RR is the default "trade unit" for cross-config comparison. ADR is better when volatility context matters (time-based analysis). Some modules benefit from showing both.

**Signal filter (applies to Modules 1, 2, and any future signal-based module)**: Add a checkbox-based signal selector panel that controls which signals are included in signal-dependent visualizations. The panel should have checkboxes for Type1 and Type2 independently, and within each type, checkboxes for each Nth occurrence (1st, 2nd, 3rd, etc.). This gives max flexibility — you can view only "Type1 occurrence 1 + Type2 occurrence 1", or "all Type1 but only Type2 occurrence 2", or any combination. The filter should be driven from the data (auto-populate occurrence checkboxes based on what values exist in the loaded parquet). Any module that uses Type1/Type2 signal data should respect this filter.

---

## Module 1: Cumulative R Curve (Equity Curve)

A line chart showing cumulative FX_clr_RR gained over time for each signal type (Type1 UP, Type1 DN, Type2 UP, Type2 DN). Each signal occurrence adds its FX_clr_RR to a running total. A rising line means the signal has a real edge; a flat or declining line means it doesn't. This is the single most important "does this work?" visualization. Should respect the signal filter checkboxes (see Signal filter note above) so you can isolate specific occurrence numbers and compare them.

**Metric**: RR. This is the natural "trade unit" — each signal earns or loses X reversals. Already built with Plotly (was LWC, migrated). Includes a combo mode toggle that merges UP+DN signals per type into a single net-performance line.

**FX Column Dropdown (applies to Modules 1 and 2)**: A single flat dropdown selector above the equity curve that controls which metric column drives the chart and all Module 2 stats. Options:
- `FX_clr_RR` (default) — MFE to color change, reversal-normalized
- `FX_clr_RR (adjusted)` — `FX_clr_RR - 1`, subtracts one reversal for a more realistic exit estimate
- `FX_clr_ADR` — MFE to color change, ADR-normalized
- `FX_clr_ADR (adjusted)` — `FX_clr_ADR - (reversal_size / currentADR)`, subtracts one reversal in ADR units for a more realistic exit estimate
- `FX_MA1_RR` — move until price closes beyond MA1, reversal-normalized
- `FX_MA1_ADR` — move until price closes beyond MA1, ADR-normalized
- `FX_MA2_RR` — move until price closes beyond MA2, reversal-normalized
- `FX_MA2_ADR` — move until price closes beyond MA2, ADR-normalized
- `FX_MA3_RR` — move until price closes beyond MA3, reversal-normalized
- `FX_MA3_ADR` — move until price closes beyond MA3, ADR-normalized

The selected column affects: equity curve traces (individual + combo), Module 2 summary stats (avg, win rate), Nth occurrence breakdown, and distribution histogram bins. The backend should send all 9 metric values per signal point in the signal data so the frontend can switch without re-fetching.

---

## Module 2: Type1/Type2 Performance Dashboard

A dedicated section for each signal type showing: total signal count, average FX_clr_RR, and win rate (% where FX_clr_RR > 0). Also includes a breakdown by Nth occurrence and an RR distribution histogram showing how many signals landed in each outcome bucket (0, 0-1, 1-2, 2-3, 3-5, 5+ RR). Should respect the signal filter checkboxes (see Signal filter note above) — all summary stats, histograms, and occurrence breakdowns should only include the selected signal types and occurrence numbers.

**Key detail about Type1/Type2 columns**: These are NOT binary flags. They are sequential counters that increment within each State +3 or -3 regime. The first Type1 pullback in a +3 run has value `1`, the second is `2`, the third is `3`, etc. Negative values (-1, -2, -3...) for State -3. They reset to 0 when the state changes. The "by Nth occurrence" breakdown uses these counter values directly — e.g., compare performance of the 1st Type1 signal in a state vs the 3rd. Type2 works the same way.

**Metric**: RR. Keeps it consistent with the equity curve and makes the histogram bins meaningful as trade multiples.

---

## Module 3: Chop Index Filter Overlay

Split all existing stats by chop regime. Categorize every bar as low chop (<0.2), mid chop (0.2-0.4), or high chop (>0.4) based on the `chop(rolling)` column. The module has two layers:

**Layer 1 — All bars**: General market character per chop regime (bar count, UP/DN%, state distribution).

**Layer 2 — Signal bars only** (Type1 != 0 or Type2 != 0): Signal performance per chop regime (count, win rate, avg RR for both Type1 and Type2). Should respect the signal filter checkboxes in the Cumulative R curve — only include the selected signal types and occurrence numbers.

Reveals whether patterns work better in trending vs choppy conditions.

**Display layout**:

```
Table 1: CHOP REGIME OVERVIEW (all bars)
              | Low (<0.2) | Mid (0.2-0.4) | High (>0.4)
Bar count     |   5,200    |     3,100      |    1,700
UP %          |    54%     |      50%       |     48%
DN %          |    46%     |      50%       |     52%

Table 2: STATE DISTRIBUTION BY CHOP REGIME (all bars)
              | Low (<0.2) | Mid (0.2-0.4) | High (>0.4)
State -3      |    12%     |       8%       |      3%
State -2      |    10%     |      14%       |     18%
State -1      |     5%     |      12%       |     20%
State +1      |     5%     |      12%       |     20%
State +2      |    10%     |      14%       |     18%
State +3      |    12%     |       8%       |      3%

Table 3: SIGNAL PERFORMANCE BY CHOP REGIME (signal bars only)
               | Low (<0.2) | Mid (0.2-0.4) | High (>0.4)
Type1 count    |    120     |       85       |      40
Type1 win %    |    58%     |      51%       |     43%
Type1 avg RR   |   0.35     |     0.12       |   -0.08
Type1 avg ADR  |   0.28     |     0.09       |   -0.05
Type2 count    |     95     |       60       |      30
Type2 win %    |    62%     |      48%       |     40%
Type2 avg RR   |   0.42     |     0.05       |   -0.15
Type2 avg ADR  |   0.33     |     0.04       |   -0.10
```

**Metric**: Show both RR and ADR. Different chop regimes correlate with different volatility, so ADR-normalized values give a fairer cross-regime comparison alongside the RR trade-unit view.

---

## Module 4: Time-of-Day / Session Patterns -shit, not using

Extract the hour from each bar's `datetime` and compute per-hour stats: bar count (when does the market move?), average barDuration, average FX_clr_ADR (which hours trend best?), and average chop. Display as a bar chart by hour, optionally color-coded by trading session (Asia 0-9 UTC-yellow, London 8-17-red, NY 13-22-blue).  

**Metric**: `FX_clr_ADR`. Volatility varies by session, so ADR-normalized moves give a fairer comparison across hours.

---

## Module 5: State x Consecutive Bars Heatmap

A 2D grid where rows are State values (-3 to +3), columns are consecutive bar counts (1 through 10), and each cell shows the average FX_clr_RR and sample count. Color cells on a green-to-red scale by outcome quality. Answers: "If I enter on the Nth consecutive bar in State X, what's the expected forward move?"

**Metric**: RR. You're evaluating trade setups, so the "how many reversals" framing is most actionable.

---

## Module 6: State Transition Matrix

A 6x6 table showing the probability of moving from one State to another. Rows = prior state (prState), columns = current State, cells = percentage of transitions. Color intensity by probability. The diagonal shows how often each state persists. Reveals which states are sticky and which ones predict transitions (e.g., State +2 leading to +3 frequently).

---

## Module 7: Chop Filter Toggle 

Rather than just a comparison table, add a toggle button group (All | Low Chop | Mid | High) to the top of the General stats page that re-filters ALL existing stats modules to only show data from the selected chop regime. This turns chop into a global filter across the entire General Stats page.

---

## ~~Module 8: Run Length vs Forward Move~~

~~A table or bar chart showing, for each consecutive bar count (1 through 10), the average and median FX_clr_RR of the next move. Separate UP and DN runs. Answers: "After N bars in a row, how much juice is left?" Shows whether continuation diminishes as runs get longer.~~

~~**Metric**: RR. Directly answers "how many more reversals of continuation can I expect."~~

*Dropped — subsumed by Module 5 (State x ConBars Heatmap).*

---

## Module 9: Drawdown by Context

Two tables showing DD_RR (wick size) statistics broken down by context. First table: DD_RR by State (mean, median, P75, P90, max per state). Second table: DD_RR by consecutive bar count. Helps calibrate stop-loss expectations — e.g., "In State +3 after 5 UP bars, the 90th percentile wick is 0.8 RR."

**Metric**: RR. Stop-loss calibration is naturally in reversal units — "my stop needs to be 0.8 reversals" is directly actionable.

---

## Module 10: EMA Distance Scatterplot

A scatter plot with fast EMA RR distance on the X axis and slow EMA RR distance on the Y axis. Each dot represents a bar, colored green if FX_clr_RR > 0 (favorable outcome) or red if negative. Sample to ~500 points for performance. Reveals "sweet spot" zones where price distance from both MAs predicts good moves, and overextension zones where mean-reversion is likely.

**Metric**: RR for the axes (uses `EMA_rrDistance` columns). Comparable across configs. Could also offer an ADR toggle since ADR-normalized distance accounts for changing volatility over the dataset's time range.

---

## Module 11 (Bonus): Multi-Timeframe Alignment

Compare two parquet files generated with different brick sizes. Align them by datetime and show how signal quality changes when both timeframes agree on state (e.g., both in State +3) vs disagree. Requires a new backend endpoint that loads two parquets and joins them. Defer to last as it's the most complex.

---

## Module 12: Signal Quality Filters (EMA Distance & Wick Size)

A collapsible filter panel on the Type1/Type2 signal tab that lets you filter signals by EMA distance and drawdown/wick size before they feed into the R-Curve and all Module 2 stats. Works the same way as the existing N-value chips and chop filter — signals that don't pass the filter are excluded from all downstream calculations.

The panel exposes 4 filter groups: EMA distance from each of the 3 MAs, plus DD (wick size). A normalization toggle (RR / ADR) switches all sliders between RR-normalized and ADR-normalized values — only one normalization is active at a time. Each filter group has independent UP and DN range sliders, since long and short signals often behave asymmetrically — for example, you might want to filter UP signals to only include those where EMA(20) RR distance is between 0.5 and 2.0, while leaving DN signals unfiltered or using a different range.

Each filter row has a checkbox toggle to activate it. Filters default to inactive (unchecked), meaning no filtering is applied. When enabled, a dual-handle range slider sets the min/max bounds — only signals whose value for that metric falls within the range are included. Slider bounds are auto-derived from the actual data range of each metric. All enabled filters combine with AND logic: a signal must pass every active filter plus the existing N-value and chop filters to be included.

The purpose is signal quality exploration — discovering whether signals fired at certain EMA distances or with certain wick characteristics systematically perform better or worse. For example, you might find that Type1 signals with small wicks (DD_RR < 0.5) and moderate EMA(20) distance (1–3 RR) produce a much steeper equity curve than unfiltered signals. This effectively turns the R-Curve into an interactive signal optimizer.

The backend needs to attach EMA distance and DD values to each signal point (currently not included). The frontend adds the collapsible panel below the existing filter controls, with the filter logic extending the existing `filteredSignalData` pipeline.

**Metric**: 4 filter groups (EMA MA1, EMA MA2, EMA MA3, DD) with a single RR/ADR normalization toggle that applies to all. Backend sends both normalizations per signal point; the frontend switches which values the sliders reference.

---

## Suggested Implementation Order

Each module is independent. Start with table-only modules, then add chart-based ones after installing recharts:

1. Module 6 — State Transition Matrix
2. Module 8 — Run Length vs Forward Move
3. Module 9 — Drawdown by Context
4. Module 3 — Chop Filter Comparison
5. Module 1 — Cumulative R Curve
6. Module 2 — Signal Performance Dashboard
7. Module 4 — Time-of-Day Patterns
8. Module 5 — State x ConBars Heatmap
9. Module 10 — EMA Distance Scatterplot
10. Module 7 — Chop Global Toggle
11. Module 11 — Multi-Timeframe Alignment
