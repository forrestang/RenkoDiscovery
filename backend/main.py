"""
RenkoDiscovery Backend - Financial Data Processing API
"""
import os
import re
from pathlib import Path
from typing import Optional
from datetime import datetime

import numpy as np
import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="RenkoDiscovery API", version="1.0.0")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Default working directory
WORKING_DIR = Path(r"C:\Users\lawfp\Desktop\Data_renko")

# Known instrument patterns for auto-detection
INSTRUMENT_PATTERNS = [
    # Forex pairs
    r'(EURUSD|GBPUSD|USDJPY|USDCHF|AUDUSD|USDCAD|NZDUSD|EURGBP|EURJPY|GBPJPY|'
    r'AUDJPY|EURAUD|EURCHF|AUDNZD|AUDCAD|AUDCHF|CADJPY|CHFJPY|EURAUD|EURCAD|'
    r'EURNZD|GBPAUD|GBPCAD|GBPCHF|GBPNZD|NZDCAD|NZDCHF|NZDJPY)',
    # Crypto
    r'(BTC|ETH|XRP|LTC|BCH|ADA|DOT|LINK|XLM|DOGE)',
    # Indices
    r'(DAX|SPX|NDX|DJI|FTSE|CAC|NIKKEI|HSI)',
]


class FileInfo(BaseModel):
    filename: str
    filepath: str
    instrument: Optional[str]
    year: Optional[int]
    timeframe: Optional[str]
    size_bytes: int
    modified: str


class ProcessRequest(BaseModel):
    files: list[str]
    working_dir: Optional[str] = None


class ChartDataRequest(BaseModel):
    instrument: str
    working_dir: Optional[str] = None
    limit: Optional[int] = 5000


class RenkoRequest(BaseModel):
    brick_method: str = "price"  # "price" | "adr"
    brick_size: float = 0.0010  # raw price (price) or percentage (adr, e.g. 50 = 50%)
    reversal_size: float = 0.0020  # raw price (price) or percentage (adr)
    adr_lookback: int = 5  # sessions to look back for ADR calculation
    wick_mode: str = "all"  # "all" | "big" | "none"
    limit: Optional[int] = None  # limit M1 data to last N bars (for overlay mode alignment)
    working_dir: Optional[str] = None


def extract_instrument(filename: str) -> Optional[str]:
    """Extract instrument symbol from filename."""
    filename_upper = filename.upper()
    for pattern in INSTRUMENT_PATTERNS:
        match = re.search(pattern, filename_upper)
        if match:
            return match.group(1)
    return None


def extract_year(filename: str) -> Optional[int]:
    """Extract year from filename."""
    match = re.search(r'(20\d{2})', filename)
    if match:
        return int(match.group(1))
    return None


def extract_timeframe(filename: str) -> Optional[str]:
    """Extract timeframe from filename (M1, M5, H1, etc.)."""
    match = re.search(r'[_\-](M1|M5|M15|M30|H1|H4|D1|W1)[_\-\.]', filename, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    return None


@app.get("/")
def root():
    return {"status": "ok", "app": "RenkoDiscovery API"}


@app.get("/files", response_model=list[FileInfo])
def list_files(working_dir: Optional[str] = None):
    """List all data files in the working directory's data folder."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    data_dir = base_dir / "data"

    if not data_dir.exists():
        raise HTTPException(status_code=404, detail=f"Data directory not found: {data_dir}")

    files = []
    for filepath in data_dir.iterdir():
        if filepath.is_file() and filepath.suffix.lower() in ['.csv', '.txt', '.dat']:
            stat = filepath.stat()
            files.append(FileInfo(
                filename=filepath.name,
                filepath=str(filepath),
                instrument=extract_instrument(filepath.name),
                year=extract_year(filepath.name),
                timeframe=extract_timeframe(filepath.name),
                size_bytes=stat.st_size,
                modified=datetime.fromtimestamp(stat.st_mtime).isoformat()
            ))

    # Sort by instrument, then year
    files.sort(key=lambda f: (f.instrument or "", f.year or 0))
    return files


@app.get("/cache")
def list_cache(working_dir: Optional[str] = None):
    """List all cached feather files."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    cache_dir = base_dir / "cache_performant"

    if not cache_dir.exists():
        return []

    feathers = []
    for filepath in cache_dir.iterdir():
        if filepath.is_file() and filepath.suffix.lower() == '.feather':
            stat = filepath.stat()
            feathers.append({
                "filename": filepath.name,
                "filepath": str(filepath),
                "instrument": filepath.stem,
                "size_bytes": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })

    return feathers


@app.delete("/cache/{instrument}")
def delete_cache_instrument(instrument: str, working_dir: Optional[str] = None):
    """Delete a specific cached feather file."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    cache_dir = base_dir / "cache_performant"
    feather_path = cache_dir / f"{instrument}.feather"

    if not feather_path.exists():
        raise HTTPException(status_code=404, detail=f"No cached data for {instrument}")

    feather_path.unlink()
    return {"status": "deleted", "instrument": instrument}


@app.delete("/cache")
def delete_cache_all(working_dir: Optional[str] = None):
    """Delete all cached feather files."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    cache_dir = base_dir / "cache_performant"

    if not cache_dir.exists():
        return {"status": "ok", "deleted": 0}

    deleted = 0
    for filepath in cache_dir.iterdir():
        if filepath.is_file() and filepath.suffix.lower() == '.feather':
            filepath.unlink()
            deleted += 1

    return {"status": "ok", "deleted": deleted}


def detect_csv_format(filepath: str) -> dict:
    """Auto-detect CSV format by reading first few lines."""
    with open(filepath, 'r') as f:
        first_line = f.readline().strip()

    # Check for header (J4X format has "Time" in header)
    has_header = 'Time' in first_line or 'Open' in first_line

    # Check delimiter
    if ';' in first_line:
        delimiter = ';'
    else:
        delimiter = ','

    return {'has_header': has_header, 'delimiter': delimiter}


def parse_csv_file(filepath: str) -> pd.DataFrame:
    """Parse CSV file with auto-format detection."""
    fmt = detect_csv_format(filepath)

    if fmt['has_header']:
        # J4X format: "Time (EET),Open,High,Low,Close,Volume" with YYYY.MM.DD HH:MM:SS
        df = pd.read_csv(filepath, delimiter=fmt['delimiter'])
        # Rename columns to standard names
        df.columns = ['datetime', 'open', 'high', 'low', 'close', 'volume']
        # Parse datetime: "2026.01.02 00:00:00"
        df['datetime'] = pd.to_datetime(df['datetime'], format='%Y.%m.%d %H:%M:%S')
        df['datetime'] = df['datetime'].dt.tz_localize('UTC')
    else:
        # MT4 format: semicolon or comma delimited, no header
        df = pd.read_csv(
            filepath,
            sep=fmt['delimiter'],
            header=None,
            names=['datetime', 'open', 'high', 'low', 'close', 'volume'],
        )
        # Try to detect datetime format from first value
        sample_dt = str(df['datetime'].iloc[0])
        if ' ' in sample_dt and '.' not in sample_dt.split(' ')[0]:
            # Format: "20220102 170300" (YYYYMMDD HHMMSS)
            df['datetime'] = pd.to_datetime(df['datetime'], format='%Y%m%d %H%M%S')
            df['datetime'] = df['datetime'].dt.tz_localize('UTC')
        elif '.' in sample_dt:
            # Format: "2012.02.01,00:00" (YYYY.MM.DD with separate time column)
            # In this case, datetime column has date, next column has time
            # Re-read with different handling
            df = pd.read_csv(
                filepath,
                sep=fmt['delimiter'],
                header=None,
                names=['date', 'time', 'open', 'high', 'low', 'close', 'volume'],
            )
            df['datetime'] = pd.to_datetime(df['date'] + ' ' + df['time'], format='%Y.%m.%d %H:%M')
            df['datetime'] = df['datetime'].dt.tz_localize('UTC')
            df = df.drop(columns=['date', 'time'])

    return df


@app.post("/process")
def process_files(request: ProcessRequest):
    """Process selected files into parquet format, stitching by instrument."""
    base_dir = Path(request.working_dir) if request.working_dir else WORKING_DIR
    cache_dir = base_dir / "cache_performant"
    cache_dir.mkdir(exist_ok=True)

    # Group files by instrument
    instrument_files: dict[str, list[str]] = {}
    for filepath in request.files:
        instrument = extract_instrument(filepath)
        if instrument:
            if instrument not in instrument_files:
                instrument_files[instrument] = []
            instrument_files[instrument].append(filepath)

    if not instrument_files:
        raise HTTPException(status_code=400, detail="No valid instruments found in selected files")

    results = []

    for instrument, filepaths in instrument_files.items():
        # Sort files by year for proper stitching
        filepaths.sort(key=lambda f: extract_year(f) or 0)

        dfs = []
        for fp in filepaths:
            try:
                df = parse_csv_file(fp)
                dfs.append(df)
            except Exception as e:
                results.append({
                    "instrument": instrument,
                    "file": fp,
                    "status": "error",
                    "message": str(e)
                })
                continue

        if dfs:
            # Concatenate and deduplicate
            combined = pd.concat(dfs, ignore_index=True)
            combined = combined.drop_duplicates(subset=['datetime'], keep='first')
            combined = combined.sort_values('datetime').reset_index(drop=True)

            # Ensure proper dtypes
            combined['open'] = pd.to_numeric(combined['open'], errors='coerce')
            combined['high'] = pd.to_numeric(combined['high'], errors='coerce')
            combined['low'] = pd.to_numeric(combined['low'], errors='coerce')
            combined['close'] = pd.to_numeric(combined['close'], errors='coerce')
            combined['volume'] = pd.to_numeric(combined['volume'], errors='coerce').fillna(0).astype(int)

            # Save as feather
            output_path = cache_dir / f"{instrument}.feather"
            combined.to_feather(output_path)

            results.append({
                "instrument": instrument,
                "status": "success",
                "output": str(output_path),
                "rows": len(combined),
                "date_range": {
                    "start": combined['datetime'].min().isoformat(),
                    "end": combined['datetime'].max().isoformat()
                }
            })

    return {"results": results}


@app.get("/chart/{instrument}")
def get_chart_data(instrument: str, working_dir: Optional[str] = None, limit: Optional[int] = None):
    """Get OHLC data for charting."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    cache_dir = base_dir / "cache_performant"
    feather_path = cache_dir / f"{instrument}.feather"

    if not feather_path.exists():
        raise HTTPException(status_code=404, detail=f"No cached data for {instrument}")

    df = pd.read_feather(feather_path)
    total_rows = len(df)

    # Apply limit if specified (return last N rows)
    if limit and len(df) > limit:
        df = df.tail(limit)

    return {
        "instrument": instrument,
        "data": {
            "datetime": df['datetime'].dt.strftime('%Y-%m-%d %H:%M:%S').tolist(),
            "open": df['open'].tolist(),
            "high": df['high'].tolist(),
            "low": df['low'].tolist(),
            "close": df['close'].tolist(),
            "volume": df['volume'].tolist(),
        },
        "total_rows": total_rows,
        "displayed_rows": len(df)
    }


def calculate_adr(df: pd.DataFrame, lookback_sessions: int = 5) -> dict:
    """
    Calculate Average Daily Range for the last N UTC sessions.

    Returns dict with:
      - 'adr': float - the average daily range
      - 'session_ranges': list - daily ranges for each session
      - 'session_dates': list - UTC dates for each session
    """
    # Ensure we have a DataFrame with proper columns
    if 'datetime' in df.columns:
        df = df.set_index('datetime')

    # Work with a copy and ensure UTC
    df_utc = df.copy()
    if df_utc.index.tz is None:
        df_utc.index = pd.to_datetime(df_utc.index).tz_localize('UTC')
    else:
        df_utc.index = pd.to_datetime(df_utc.index).tz_convert('UTC')
    df_utc['session_date'] = df_utc.index.date

    # Group by session date and get high-low range
    session_stats = df_utc.groupby('session_date').agg({'high': 'max', 'low': 'min'})
    session_stats['range'] = session_stats['high'] - session_stats['low']

    # Get last N complete sessions (exclude current partial session)
    complete_sessions = session_stats.iloc[:-1].tail(lookback_sessions)

    if len(complete_sessions) == 0:
        # Fallback: use all sessions if no complete sessions
        complete_sessions = session_stats.tail(lookback_sessions)

    adr = complete_sessions['range'].mean()

    return {
        'adr': float(adr),
        'session_ranges': complete_sessions['range'].tolist(),
        'session_dates': [str(d) for d in complete_sessions.index.tolist()]
    }


def calculate_daily_ranges(df: pd.DataFrame) -> pd.DataFrame:
    """
    Calculate daily high-low ranges for each UTC session.
    Returns a DataFrame indexed by session date with 'range' column.
    """
    # Ensure we have a DataFrame with proper columns
    if 'datetime' in df.columns:
        df = df.set_index('datetime')

    df_utc = df.copy()
    if df_utc.index.tz is None:
        df_utc.index = pd.to_datetime(df_utc.index).tz_localize('UTC')
    else:
        df_utc.index = pd.to_datetime(df_utc.index).tz_convert('UTC')
    df_utc['session_date'] = df_utc.index.date

    # Group by session date and get high-low range
    daily_ranges = df_utc.groupby('session_date').agg({'high': 'max', 'low': 'min'})
    daily_ranges['range'] = daily_ranges['high'] - daily_ranges['low']

    return daily_ranges


def calculate_session_brick_sizes(daily_ranges: pd.DataFrame, brick_percentage: float, lookback: int) -> dict:
    """
    Calculate the brick size that applies to each session date.
    For each session, brick_size = ADR(last N sessions) * percentage/100

    Returns: dict mapping session_date -> brick_size
    """
    session_brick_sizes = {}
    session_dates = sorted(daily_ranges.index.tolist())

    for i, session_date in enumerate(session_dates):
        # Get ADR from previous N sessions (not including current)
        past_sessions = daily_ranges.loc[daily_ranges.index < session_date].tail(lookback)
        if len(past_sessions) >= 1:
            adr = past_sessions['range'].mean()
        else:
            # Fallback for early sessions: use first available sessions
            adr = daily_ranges.iloc[:i+1]['range'].mean() if i > 0 else daily_ranges.iloc[0]['range']

        session_brick_sizes[session_date] = float(adr * (brick_percentage / 100.0))

    return session_brick_sizes


def get_pip_value(instrument: str) -> float:
    """Get pip value for instrument (assumes forex pairs)."""
    # JPY pairs have 2 decimal places, others have 4
    if 'JPY' in instrument.upper():
        return 0.01
    return 0.0001


def generate_renko_custom(df: pd.DataFrame, brick_size: float, reversal_multiplier: float = 2.0, wick_mode: str = "all",
                          session_brick_sizes: dict = None) -> tuple[pd.DataFrame, dict]:
    """
    Generate Renko bricks with configurable reversal multiplier using threshold-based logic.

    Standard Renko uses reversal_multiplier=2 (need 2x brick size to reverse).
    This implementation allows custom reversal thresholds.

    wick_mode options:
        - "all": Show all wicks (any retracement)
        - "big": Only show wicks when retracement > brick_size
        - "none": No wicks at all

    session_brick_sizes: Optional dict mapping session_date -> brick_size for dynamic ADR sizing

    Returns:
        tuple: (completed_bricks_df, pending_brick_dict)
    """
    def find_threshold_crossings(closes, start_idx, end_idx, start_threshold, brick_size, direction):
        """
        Find M1 bar indices where each brick threshold was crossed.

        direction: 1 for UP (prices >= threshold), -1 for DOWN (prices <= threshold)

        Returns list of (tick_open, tick_close) tuples for each brick.
        """
        crossings = []
        current_threshold = start_threshold
        current_open = start_idx

        for j in range(start_idx, end_idx + 1):
            price = closes[j]
            # Check if this bar crosses the current threshold
            if direction == 1 and price >= current_threshold:
                # Find all thresholds crossed by this bar
                while price >= current_threshold:
                    crossings.append((current_open, j))
                    current_open = j
                    current_threshold += brick_size
            elif direction == -1 and price <= current_threshold:
                # Find all thresholds crossed by this bar
                while price <= current_threshold:
                    crossings.append((current_open, j))
                    current_open = j
                    current_threshold -= brick_size

        return crossings

    def calc_up_brick_low(pending_low_val, brick_open, apply_wick=True):
        """Calculate low for up brick based on wick mode."""
        if not apply_wick or wick_mode == "none":
            return brick_open
        elif wick_mode == "big":
            retracement = brick_open - pending_low_val
            if retracement > brick_size:
                return pending_low_val
            return brick_open
        else:  # "all"
            return min(pending_low_val, brick_open)

    def calc_down_brick_high(pending_high_val, brick_open, apply_wick=True):
        """Calculate high for down brick based on wick mode."""
        if not apply_wick or wick_mode == "none":
            return brick_open
        elif wick_mode == "big":
            retracement = pending_high_val - brick_open
            if retracement > brick_size:
                return pending_high_val
            return brick_open
        else:  # "all"
            return max(pending_high_val, brick_open)

    open_prices = df['open'].values
    close_prices = df['close'].values
    high_prices = df['high'].values
    low_prices = df['low'].values
    timestamps = df.index

    if len(close_prices) < 2:
        return pd.DataFrame(), None

    # Session tracking for dynamic brick sizing
    current_session = None
    session_dates = None
    if session_brick_sizes is not None:
        # Extract session dates from timestamps
        session_dates = [ts.date() if hasattr(ts, 'date') else pd.to_datetime(ts).date() for ts in timestamps]

    reversal_size = brick_size * reversal_multiplier
    bricks = []

    # Initialize with first M1 bar's OPEN rounded to brick boundary
    ref_price = np.floor(open_prices[0] / brick_size) * brick_size

    # State variables
    last_brick_close = ref_price
    direction = 0  # 0 = undetermined, 1 = up, -1 = down
    up_threshold = ref_price + brick_size
    down_threshold = ref_price - brick_size
    pending_high = high_prices[0]
    pending_low = low_prices[0]
    tick_idx_open = 0

    for i in range(len(close_prices)):
        # Dynamic brick sizing: check for session change
        if session_brick_sizes is not None:
            bar_session = session_dates[i]
            if bar_session != current_session and bar_session in session_brick_sizes:
                current_session = bar_session
                brick_size = session_brick_sizes[bar_session]
                reversal_size = brick_size * reversal_multiplier

        # Update pending high/low with current bar's high/low
        pending_high = max(pending_high, high_prices[i])
        pending_low = min(pending_low, low_prices[i])
        price = close_prices[i]

        if direction == 0:
            # Undetermined direction - check which threshold is crossed first
            if price >= up_threshold:
                # Create UP brick
                brick_open = last_brick_close
                brick_close = brick_open + brick_size
                bricks.append({
                    'datetime': timestamps[tick_idx_open],
                    'open': brick_open,
                    'high': brick_close,
                    'low': calc_up_brick_low(pending_low, brick_open),
                    'close': brick_close,
                    'direction': 1,
                    'is_reversal': 0,
                    'tick_index_open': tick_idx_open,
                    'tick_index_close': i,
                    'brick_size': brick_size
                })
                last_brick_close = brick_close
                direction = 1
                # Update thresholds after UP brick
                up_threshold = brick_close + brick_size
                down_threshold = brick_close - reversal_size
                # Reset pending values
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i

            elif price <= down_threshold:
                # Create DOWN brick
                brick_open = last_brick_close
                brick_close = brick_open - brick_size
                bricks.append({
                    'datetime': timestamps[tick_idx_open],
                    'open': brick_open,
                    'high': calc_down_brick_high(pending_high, brick_open),
                    'low': brick_close,
                    'close': brick_close,
                    'direction': -1,
                    'is_reversal': 0,
                    'tick_index_open': tick_idx_open,
                    'tick_index_close': i,
                    'brick_size': brick_size
                })
                last_brick_close = brick_close
                direction = -1
                # Update thresholds after DOWN brick
                down_threshold = brick_close - brick_size
                up_threshold = brick_close + reversal_size
                # Reset pending values
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i

        elif direction == 1:
            # Uptrend - check for continuation or reversal
            if price >= up_threshold:
                # Create UP brick(s) - continuation
                # Find where each threshold was crossed
                crossings = find_threshold_crossings(close_prices, tick_idx_open, i, up_threshold, brick_size, 1)

                for idx, (cross_open, cross_close) in enumerate(crossings):
                    brick_open = last_brick_close
                    brick_close = brick_open + brick_size
                    first_brick = (idx == 0)
                    bricks.append({
                        'datetime': timestamps[cross_open],
                        'open': brick_open,
                        'high': brick_close,
                        'low': calc_up_brick_low(pending_low, brick_open, apply_wick=first_brick),
                        'close': brick_close,
                        'direction': 1,
                        'is_reversal': 0,
                        'tick_index_open': cross_open,
                        'tick_index_close': cross_close,
                        'brick_size': brick_size
                    })
                    last_brick_close = brick_close

                # Update thresholds after all UP bricks
                up_threshold = last_brick_close + brick_size
                down_threshold = last_brick_close - reversal_size

                # Reset pending values after all bricks created
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i

            elif price <= down_threshold:
                # Reversal to DOWN
                # Find where each threshold was crossed
                # Start from first brick threshold (1 brick away), not reversal threshold (2 bricks away)
                first_brick_threshold = last_brick_close - brick_size
                crossings = find_threshold_crossings(close_prices, tick_idx_open, i, first_brick_threshold, brick_size, -1)

                for idx, (cross_open, cross_close) in enumerate(crossings):
                    brick_open = last_brick_close
                    brick_close = brick_open - brick_size
                    first_brick = (idx == 0)
                    bricks.append({
                        'datetime': timestamps[cross_open],
                        'open': brick_open,
                        'high': calc_down_brick_high(pending_high, brick_open, apply_wick=first_brick),
                        'low': brick_close,
                        'close': brick_close,
                        'direction': -1,
                        'is_reversal': 1 if first_brick else 0,
                        'tick_index_open': cross_open,
                        'tick_index_close': cross_close,
                        'brick_size': brick_size
                    })
                    last_brick_close = brick_close

                direction = -1
                # Update thresholds after all DOWN bricks
                down_threshold = last_brick_close - brick_size
                up_threshold = last_brick_close + reversal_size

                # Reset pending values after all bricks created
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i

        else:  # direction == -1
            # Downtrend - check for continuation or reversal
            if price <= down_threshold:
                # Create DOWN brick(s) - continuation
                # Find where each threshold was crossed
                crossings = find_threshold_crossings(close_prices, tick_idx_open, i, down_threshold, brick_size, -1)

                for idx, (cross_open, cross_close) in enumerate(crossings):
                    brick_open = last_brick_close
                    brick_close = brick_open - brick_size
                    first_brick = (idx == 0)
                    bricks.append({
                        'datetime': timestamps[cross_open],
                        'open': brick_open,
                        'high': calc_down_brick_high(pending_high, brick_open, apply_wick=first_brick),
                        'low': brick_close,
                        'close': brick_close,
                        'direction': -1,
                        'is_reversal': 0,
                        'tick_index_open': cross_open,
                        'tick_index_close': cross_close,
                        'brick_size': brick_size
                    })
                    last_brick_close = brick_close

                # Update thresholds after all DOWN bricks
                down_threshold = last_brick_close - brick_size
                up_threshold = last_brick_close + reversal_size

                # Reset pending values after all bricks created
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i

            elif price >= up_threshold:
                # Reversal to UP
                # Find where each threshold was crossed
                # Start from first brick threshold (1 brick away), not reversal threshold (2 bricks away)
                first_brick_threshold = last_brick_close + brick_size
                crossings = find_threshold_crossings(close_prices, tick_idx_open, i, first_brick_threshold, brick_size, 1)

                for idx, (cross_open, cross_close) in enumerate(crossings):
                    brick_open = last_brick_close
                    brick_close = brick_open + brick_size
                    first_brick = (idx == 0)
                    bricks.append({
                        'datetime': timestamps[cross_open],
                        'open': brick_open,
                        'high': brick_close,
                        'low': calc_up_brick_low(pending_low, brick_open, apply_wick=first_brick),
                        'close': brick_close,
                        'direction': 1,
                        'is_reversal': 1 if first_brick else 0,
                        'tick_index_open': cross_open,
                        'tick_index_close': cross_close,
                        'brick_size': brick_size
                    })
                    last_brick_close = brick_close

                direction = 1
                # Update thresholds after all UP bricks
                up_threshold = last_brick_close + brick_size
                down_threshold = last_brick_close - reversal_size

                # Reset pending values after all bricks created
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i

    # Build pending brick (the forming brick that hasn't completed yet)
    pending_brick = None
    if direction != 0 and len(close_prices) > 0:
        last_idx = len(close_prices) - 1
        current_price = close_prices[last_idx]
        brick_open = last_brick_close

        if direction == 1:
            # Pending up brick
            pending_brick = {
                'open': brick_open,
                'high': max(current_price, brick_open),
                'low': calc_up_brick_low(pending_low, brick_open),
                'close': current_price,
                'direction': direction,
                'tick_index_open': tick_idx_open,
                'tick_index_close': last_idx
            }
        else:
            # Pending down brick
            pending_brick = {
                'open': brick_open,
                'high': calc_down_brick_high(pending_high, brick_open),
                'low': min(current_price, brick_open),
                'close': current_price,
                'direction': direction,
                'tick_index_open': tick_idx_open,
                'tick_index_close': last_idx
            }

    if not bricks:
        return pd.DataFrame(), pending_brick

    result_df = pd.DataFrame(bricks)
    result_df = result_df.set_index('datetime')
    return result_df, pending_brick


@app.post("/renko/{instrument}")
def get_renko_data(instrument: str, request: RenkoRequest):
    """Generate Renko chart data with wicks."""
    base_dir = Path(request.working_dir) if request.working_dir else WORKING_DIR
    cache_dir = base_dir / "cache_performant"
    feather_path = cache_dir / f"{instrument}.feather"

    if not feather_path.exists():
        raise HTTPException(status_code=404, detail=f"No cached data for {instrument}")

    # Read source data
    df = pd.read_feather(feather_path)

    # Ensure datetime index for renkodf
    df = df.set_index('datetime')

    # Clean data - remove any NaN values
    df = df.dropna()

    # Ensure data is sorted by datetime
    df = df.sort_index()

    # Apply limit if specified (use last N bars to match M1 chart display)
    if request.limit and len(df) > request.limit:
        df = df.tail(request.limit)

    # Calculate brick size based on method
    adr_info = None
    daily_ranges = None

    if request.brick_method == "price":
        # Direct raw price value
        brick_size = request.brick_size
        reversal_size = request.reversal_size
    elif request.brick_method == "adr":
        # Calculate daily ranges
        daily_ranges = calculate_daily_ranges(df.reset_index())

        # Calculate overall ADR for response info
        adr_result = calculate_adr(df.reset_index(), request.adr_lookback)
        adr_value = adr_result['adr']

        # Calculate per-session brick sizes for dynamic sizing
        session_brick_sizes = calculate_session_brick_sizes(
            daily_ranges,
            request.brick_size,  # percentage
            request.adr_lookback
        )

        # Use the most recent session's brick size as the "current" brick size
        latest_session = max(session_brick_sizes.keys())
        brick_size = session_brick_sizes[latest_session]
        reversal_size = brick_size * (request.reversal_size / request.brick_size)

        adr_info = {
            'adr_value': adr_value,
            'adr_lookback': request.adr_lookback,
            'brick_percentage': request.brick_size,
            'reversal_percentage': request.reversal_size,
            'session_ranges': adr_result['session_ranges'],
            'session_dates': adr_result['session_dates']
        }
    else:
        raise HTTPException(status_code=400, detail=f"Invalid brick_method: {request.brick_method}")

    # Validate brick size (check for NaN and <= 0)
    if brick_size is None or np.isnan(brick_size) or brick_size <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid brick size: {brick_size}. Check your settings."
        )

    # Validate brick size is not too small (would create too many bricks)
    price_range = df['close'].max() - df['close'].min()
    estimated_bricks = price_range / brick_size
    if estimated_bricks > 100000:
        raise HTTPException(
            status_code=400,
            detail=f"Brick size too small ({brick_size:.6f}). Would create ~{int(estimated_bricks)} bricks. Use a larger value."
        )

    # Generate Renko data
    try:
        brick_size = float(brick_size)
        reversal_size = float(reversal_size)

        # Always use custom implementation to get tick_index_open/close for overlay mode
        reversal_mult = reversal_size / brick_size

        if request.brick_method == "adr":
            renko_df, pending_brick = generate_renko_custom(
                df, brick_size, reversal_mult, request.wick_mode,
                session_brick_sizes=session_brick_sizes
            )
        else:
            renko_df, pending_brick = generate_renko_custom(
                df, brick_size, reversal_mult, request.wick_mode
            )

        if renko_df.empty:
            raise HTTPException(
                status_code=400,
                detail="No Renko bricks generated. Try a smaller brick size."
            )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Renko generation failed: {str(e)}")

    # Reset index to get datetime as column
    renko_df = renko_df.reset_index()

    # Handle volume - sum if available, otherwise use brick count
    if 'volume' not in renko_df.columns:
        renko_df['volume'] = 1

    # Determine datetime column name (varies based on reset_index behavior)
    datetime_col = None
    for col in ['datetime', 'date', 'index']:
        if col in renko_df.columns:
            datetime_col = col
            break

    # Format datetime if found, otherwise use brick index
    if datetime_col is not None and hasattr(renko_df[datetime_col], 'dt'):
        datetime_list = renko_df[datetime_col].dt.strftime('%Y-%m-%d %H:%M:%S').tolist()
    else:
        datetime_list = [f"Brick {i}" for i in range(len(renko_df))]

    # Calculate per-bar ADR values for cursor tracking (only for ADR method)
    bar_adr = None
    bar_brick_size = None
    if request.brick_method == "adr" and daily_ranges is not None and datetime_col is not None:
        bar_adr_values = []
        bar_brick_sizes = []
        for _, row in renko_df.iterrows():
            bar_dt = row[datetime_col]
            if hasattr(bar_dt, 'date'):
                bar_date = bar_dt.date()
            else:
                bar_date = pd.to_datetime(bar_dt).date()
            # Get ADR from sessions before this bar's date
            past_sessions = daily_ranges.loc[daily_ranges.index < bar_date].tail(request.adr_lookback)
            if len(past_sessions) >= 1:
                bar_adr_val = float(past_sessions['range'].mean())
            else:
                bar_adr_val = float(adr_info['adr_value'])  # fallback
            bar_adr_values.append(bar_adr_val)
            bar_brick_sizes.append(bar_adr_val * (request.brick_size / 100.0))
        bar_adr = bar_adr_values
        bar_brick_size = bar_brick_sizes

    return {
        "instrument": instrument,
        "brick_method": request.brick_method,
        "brick_size": brick_size,
        "reversal_size": reversal_size,
        "adr_info": adr_info,
        "data": {
            "datetime": datetime_list,
            "open": renko_df['open'].tolist(),
            "high": renko_df['high'].tolist(),
            "low": renko_df['low'].tolist(),
            "close": renko_df['close'].tolist(),
            "volume": renko_df['volume'].tolist() if 'volume' in renko_df.columns else [1] * len(renko_df),
            "tick_index_open": renko_df['tick_index_open'].tolist() if 'tick_index_open' in renko_df.columns else None,
            "tick_index_close": renko_df['tick_index_close'].tolist() if 'tick_index_close' in renko_df.columns else None,
            "bar_adr": bar_adr,
            "bar_brick_size": bar_brick_size,
            "brick_size_actual": renko_df['brick_size'].tolist() if 'brick_size' in renko_df.columns else None,
        },
        "pending_brick": pending_brick,
        "total_bricks": len(renko_df)
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
