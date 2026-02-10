"""
RenkoDiscovery Backend - Financial Data Processing API
"""
import os
import re
import json
from pathlib import Path
from typing import Optional
from datetime import datetime
import pytz

import numpy as np
import pandas as pd
import pandas.core.arrays.arrow.extension_types  # Force early pyarrow registration
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="RenkoDiscovery API", version="1.0.0")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Timezone for J4X data
EET = pytz.timezone('EET')

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
    data_format: str = "MT4"  # "MT4" or "J4X"
    interval_type: str = "M"  # "M" for minute, "T" for tick
    custom_name: Optional[str] = None  # User-specified output filename
    clean_holidays: bool = False
    clean_threshold_pct: float = 50.0  # Drop sessions with bar count < this % of median
    back_adjust: bool = False
    session_schedule: Optional[dict] = None  # {"monday": {"hour": 22, "minute": 0}, ...}


class ChartDataRequest(BaseModel):
    instrument: str
    working_dir: Optional[str] = None
    limit: Optional[int] = 5000


class RenkoRequest(BaseModel):
    brick_size: float = 0.0010  # raw price value
    reversal_size: float = 0.0020  # raw price value
    wick_mode: str = "all"  # "all" | "big" | "none"
    limit: Optional[int] = None  # limit M1 data to last N bars (for overlay mode alignment)
    working_dir: Optional[str] = None
    sizing_mode: str = "price"  # "price" | "adr"
    brick_pct: float = 5.0  # brick as % of ADR
    reversal_pct: float = 10.0  # reversal as % of ADR
    adr_period: int = 14  # rolling lookback
    session_schedule: Optional[dict] = None  # Per-day schedule: {"monday": {"hour": 22, "minute": 0}, ...}


class StatsRequest(BaseModel):
    filename: str = "stats_output"
    working_dir: Optional[str] = None
    adr_period: int = 14
    chop_period: int = 20
    brick_size: float = 0.0010
    reversal_size: float = 0.0020
    wick_mode: str = "all"
    ma1_period: int = 20
    ma2_period: int = 50
    ma3_period: int = 200
    smae1_period: int = 20
    smae1_deviation: float = 1.0
    smae2_period: int = 50
    smae2_deviation: float = 1.0
    pwap_sigmas: list[float] = [1.0, 2.0, 2.5, 3.0]
    renko_data: dict  # Contains datetime, open, high, low, close arrays
    session_schedule: Optional[dict] = None  # Per-day schedule: {"monday": {"hour": 22, "minute": 0}, ...}


class MLTrainRequest(BaseModel):
    working_dir: Optional[str] = None
    source_parquet: str        # filepath to stats parquet
    features: list[str]        # selected feature columns
    target_column: str         # e.g. "REAL_clr_RR"
    win_threshold: float       # target >= threshold => class 1
    filter_expr: Optional[str] = None  # pandas query string
    model_name: str            # output name stem
    n_splits: int = 5          # time-series CV folds


class PlaygroundSignal(BaseModel):
    name: str
    expression: str


class PlaygroundRequest(BaseModel):
    filepath: str
    signals: list[PlaygroundSignal]


class BacktestRequest(BaseModel):
    filepath: str
    signals: list[PlaygroundSignal]
    stop_type: str          # 'rr' or 'adr'
    stop_value: float       # e.g. 1.0 for 1RR, or 0.5 for 0.5 ADR
    target_type: str        # 'fixed_rr', 'fixed_adr', 'ma_trail', 'color_change'
    target_value: float     # RR/ADR amount, or 0 for color_change
    target_ma: int = 1      # which MA (1/2/3) for ma_trail target
    report_unit: str = 'rr' # 'rr' or 'adr' — unit for result values
    allow_overlap: bool = True  # when False, skip entries while a trade is open


class DirectGenerateJob(BaseModel):
    instrument: str              # cached feather stem, e.g. "EURUSD_MT4_M"
    filename: str                # output parquet filename (without .parquet)
    sizing_mode: str = "price"   # "price" | "adr"
    brick_size: float = 0.0010
    reversal_size: float = 0.0020
    brick_pct: float = 5.0
    reversal_pct: float = 10.0
    adr_period: int = 14
    wick_mode: str = "all"
    ma1_period: int = 20
    ma2_period: int = 50
    ma3_period: int = 200
    chop_period: int = 20
    smae1_period: int = 20
    smae1_deviation: float = 1.0
    smae2_period: int = 50
    smae2_deviation: float = 1.0
    pwap_sigmas: list[float] = [1.0, 2.0, 2.5, 3.0]
    session_schedule: Optional[dict] = None


class DirectGenerateRequest(BaseModel):
    jobs: list[DirectGenerateJob]
    working_dir: Optional[str] = None


class BypassTemplate(BaseModel):
    name: str
    sizing_mode: str = "price"
    brick_size: float = 0.0010
    reversal_size: float = 0.0020
    brick_pct: float = 5.0
    reversal_pct: float = 10.0
    adr_period: int = 14
    wick_mode: str = "all"
    ma1_period: int = 20
    ma2_period: int = 50
    ma3_period: int = 200
    chop_period: int = 20
    smae1_period: int = 20
    smae1_deviation: float = 1.0
    smae2_period: int = 50
    smae2_deviation: float = 1.0
    pwap_sigmas: list[float] = [1.0, 2.0, 2.5, 3.0]
    session_schedule: Optional[dict] = None


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


def get_unique_cache_path(cache_dir: Path, base_name: str, data_format: str = "MT4", interval_type: str = "M") -> Path:
    """
    Get a unique cache file path with format and interval tags.

    Naming convention: {instrument}_{format}_{interval}.feather
    Example: EURUSD_J4X_T.feather, EURUSD_MT4_M.feather

    If file exists, appends _2, _3, etc.
    """
    # Build the full name with tags
    full_name = f"{base_name}_{data_format}_{interval_type}"

    output_path = cache_dir / f"{full_name}.feather"
    if not output_path.exists():
        return output_path

    # File exists, find next available number
    counter = 2
    while True:
        output_path = cache_dir / f"{full_name}_{counter}.feather"
        if not output_path.exists():
            return output_path
        counter += 1


def save_cache_metadata(cache_path: Path, metadata: dict):
    """Save metadata alongside the cache file."""
    meta_path = cache_path.with_suffix('.meta.json')
    with open(meta_path, 'w') as f:
        json.dump(metadata, f, indent=2, default=str)


def load_cache_metadata(cache_path: Path) -> Optional[dict]:
    """Load metadata for a cache file."""
    meta_path = cache_path.with_suffix('.meta.json')
    if meta_path.exists():
        with open(meta_path, 'r') as f:
            return json.load(f)
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
    """List all cached feather files with metadata."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    cache_dir = base_dir / "cache"

    if not cache_dir.exists():
        return []

    feathers = []
    for filepath in cache_dir.iterdir():
        if filepath.is_file() and filepath.suffix.lower() == '.feather':
            stat = filepath.stat()
            cache_info = {
                "filename": filepath.name,
                "filepath": str(filepath),
                "instrument": filepath.stem,
                "size_bytes": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            }

            # Try to load metadata
            metadata = load_cache_metadata(filepath)
            if metadata:
                cache_info["data_format"] = metadata.get("data_format", "MT4")
                cache_info["interval_type"] = metadata.get("interval_type", "M")
                cache_info["rows"] = metadata.get("rows")
                cache_info["date_range"] = metadata.get("date_range")
                cache_info["raw_tick_count"] = metadata.get("raw_tick_count")
            else:
                # Parse from filename if no metadata (legacy files)
                # Format: {instrument}_{format}_{interval}.feather
                parts = filepath.stem.split('_')
                if len(parts) >= 3:
                    # Check if last two parts are format and interval
                    potential_format = parts[-2] if len(parts) >= 2 else None
                    potential_interval = parts[-1] if len(parts) >= 1 else None
                    if potential_format in ['MT4', 'J4X']:
                        cache_info["data_format"] = potential_format
                    if potential_interval in ['M', 'T']:
                        cache_info["interval_type"] = potential_interval

            feathers.append(cache_info)

    return feathers


@app.get("/stats-files")
def list_stats_files(working_dir: Optional[str] = None):
    """List all parquet files in the Stats folder."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    stats_dir = base_dir / "Stats"

    if not stats_dir.exists():
        return []

    parquets = []
    for filepath in stats_dir.iterdir():
        if filepath.is_file() and filepath.suffix.lower() == '.parquet':
            stat = filepath.stat()
            parquets.append({
                "filename": filepath.name,
                "filepath": str(filepath),
                "size_bytes": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })

    # Sort by modified date, newest first
    parquets.sort(key=lambda f: f["modified"], reverse=True)
    return parquets


@app.delete("/cache/{instrument}")
def delete_cache_instrument(instrument: str, working_dir: Optional[str] = None):
    """Delete a specific cached feather file and its metadata."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    cache_dir = base_dir / "cache"
    feather_path = cache_dir / f"{instrument}.feather"

    if not feather_path.exists():
        raise HTTPException(status_code=404, detail=f"No cached data for {instrument}")

    feather_path.unlink()

    # Also delete metadata file if it exists
    meta_path = feather_path.with_suffix('.meta.json')
    if meta_path.exists():
        meta_path.unlink()

    return {"status": "deleted", "instrument": instrument}


@app.delete("/cache")
def delete_cache_all(working_dir: Optional[str] = None):
    """Delete all cached feather and metadata files."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    cache_dir = base_dir / "cache"

    if not cache_dir.exists():
        return {"status": "ok", "deleted": 0}

    deleted = 0
    for filepath in cache_dir.iterdir():
        if filepath.is_file() and filepath.suffix.lower() in ['.feather', '.json']:
            filepath.unlink()
            if filepath.suffix.lower() == '.feather':
                deleted += 1

    return {"status": "ok", "deleted": deleted}


def detect_csv_format(filepath: str) -> dict:
    """Auto-detect CSV format by reading first few lines."""
    with open(filepath, 'r') as f:
        first_line = f.readline().strip()

    # Check for header (J4X format has "Time" in header)
    has_header = 'Time' in first_line or 'Open' in first_line

    # Check if it's tick data (has Ask,Bid columns)
    is_tick_data = 'Ask' in first_line and 'Bid' in first_line

    # Check delimiter
    if ';' in first_line:
        delimiter = ';'
    else:
        delimiter = ','

    return {'has_header': has_header, 'delimiter': delimiter, 'is_tick_data': is_tick_data}


def parse_csv_file(filepath: str, data_format: str = "MT4", interval_type: str = "M") -> pd.DataFrame:
    """
    Parse CSV file with format and interval type specification.

    Args:
        filepath: Path to CSV file
        data_format: "MT4" or "J4X"
        interval_type: "M" for minute data, "T" for tick data

    Returns:
        DataFrame with columns: datetime, open, high, low, close, volume
        For tick data, also includes: tick_ask, tick_bid for overlay high/low calculation
    """
    fmt = detect_csv_format(filepath)

    if data_format == "J4X":
        if interval_type == "T":
            # J4X Tick format: "Time (EET),Ask,Bid,AskVolume,BidVolume"
            # Skip header row and use explicit column names to avoid issues with trailing spaces
            df = pd.read_csv(
                filepath,
                delimiter=fmt['delimiter'],
                skiprows=1,
                names=['datetime', 'ask', 'bid', 'ask_volume', 'bid_volume'],
                usecols=[0, 1, 2, 3, 4]  # Only use first 5 columns
            )

            # Parse datetime with milliseconds: "2026.01.02 00:04:01.135"
            df['datetime'] = pd.to_datetime(df['datetime'], format='%Y.%m.%d %H:%M:%S.%f')

            # Convert EET to UTC
            df['datetime'] = df['datetime'].dt.tz_localize(EET).dt.tz_convert('UTC')

            # Calculate mid price (average of bid and ask)
            df['price'] = (df['ask'] + df['bid']) / 2

            # For tick data, we store the raw tick info for OHLC building
            # open = first price, high = max ask, low = min bid, close = last price
            df['open'] = df['price']
            df['high'] = df['ask']  # Use ask for high
            df['low'] = df['bid']   # Use bid for low
            df['close'] = df['price']
            df['volume'] = df['ask_volume'] + df['bid_volume']

            # Keep tick_ask and tick_bid for overlay mode high/low calculation
            df['tick_ask'] = df['ask']
            df['tick_bid'] = df['bid']

            df = df[['datetime', 'open', 'high', 'low', 'close', 'volume', 'tick_ask', 'tick_bid']]

        else:
            # J4X M1 format: "Time (EET),Open,High,Low,Close,Volume"
            # Skip header row and use explicit column names to avoid issues with trailing spaces
            df = pd.read_csv(
                filepath,
                delimiter=fmt['delimiter'],
                skiprows=1,
                names=['datetime', 'open', 'high', 'low', 'close', 'volume'],
                usecols=[0, 1, 2, 3, 4, 5]  # Only use first 6 columns
            )

            # Parse datetime: "2026.01.02 00:00:00"
            df['datetime'] = pd.to_datetime(df['datetime'], format='%Y.%m.%d %H:%M:%S')

            # Convert EET to UTC
            df['datetime'] = df['datetime'].dt.tz_localize(EET).dt.tz_convert('UTC')
    else:
        # MT4 format: semicolon or comma delimited, no header (always minute data)
        # MT4 data is in EST (UTC-5, no daylight savings) — must convert to UTC
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
            df['datetime'] = df['datetime'].dt.tz_localize('EST').dt.tz_convert('UTC')
        elif '.' in sample_dt:
            # Format: "2012.02.01,00:00" (YYYY.MM.DD with separate time column)
            df = pd.read_csv(
                filepath,
                sep=fmt['delimiter'],
                header=None,
                names=['date', 'time', 'open', 'high', 'low', 'close', 'volume'],
            )
            df['datetime'] = pd.to_datetime(df['date'] + ' ' + df['time'], format='%Y.%m.%d %H:%M')
            df['datetime'] = df['datetime'].dt.tz_localize('EST').dt.tz_convert('UTC')
            df = df.drop(columns=['date', 'time'])

    return df


def aggregate_ticks_to_ohlc(df: pd.DataFrame, freq: str = '1min') -> pd.DataFrame:
    """
    Aggregate tick data into OHLC bars.

    For tick data, we use:
    - open: first mid price
    - high: max ask price (to capture full range)
    - low: min bid price (to capture full range)
    - close: last mid price

    This gives us the true high/low range that includes the spread.
    """
    df = df.set_index('datetime')

    # Calculate mid price for open/close
    if 'tick_ask' in df.columns and 'tick_bid' in df.columns:
        df['mid'] = (df['tick_ask'] + df['tick_bid']) / 2

        # Aggregate separately to avoid MultiIndex issues
        ohlc_open = df['mid'].resample(freq).first()
        ohlc_close = df['mid'].resample(freq).last()
        ohlc_high = df['tick_ask'].resample(freq).max()
        ohlc_low = df['tick_bid'].resample(freq).min()
        ohlc_volume = df['volume'].resample(freq).sum()

        ohlc = pd.DataFrame({
            'open': ohlc_open,
            'high': ohlc_high,
            'low': ohlc_low,
            'close': ohlc_close,
            'volume': ohlc_volume
        })
    else:
        ohlc = df.resample(freq).agg({
            'open': 'first',
            'high': 'max',
            'low': 'min',
            'close': 'last',
            'volume': 'sum'
        })

    # Remove rows with NaN (empty periods)
    ohlc = ohlc.dropna()
    ohlc = ohlc.reset_index()

    return ohlc


def calculate_ema(values: pd.Series, period: int) -> pd.Series:
    """Calculate EMA matching frontend implementation."""
    # Work with numpy arrays for simpler indexing
    vals = values.values
    n = len(vals)
    ema_arr = np.full(n, np.nan)

    if n >= period:
        multiplier = 2 / (period + 1)
        ema_arr[period - 1] = np.mean(vals[:period])  # First EMA = SMA
        for i in range(period, n):
            ema_arr[i] = (vals[i] - ema_arr[i - 1]) * multiplier + ema_arr[i - 1]

    return pd.Series(ema_arr, index=values.index)


@app.post("/process")
def process_files(request: ProcessRequest):
    """
    Process selected files into feather format, stitching by instrument.

    Supports:
    - MT4 format (minute data only)
    - J4X format (minute or tick data)

    For tick data, aggregates to 1-minute OHLC bars using:
    - open/close: mid price (average of bid/ask)
    - high: max ask price
    - low: min bid price
    """
    base_dir = Path(request.working_dir) if request.working_dir else WORKING_DIR
    cache_dir = base_dir / "cache"
    cache_dir.mkdir(exist_ok=True)

    data_format = request.data_format
    interval_type = request.interval_type
    custom_name = request.custom_name

    # Group files by instrument (or use custom name for all)
    instrument_files: dict[str, list[str]] = {}
    for filepath in request.files:
        if custom_name:
            # Use custom name for all files
            instrument = custom_name
        else:
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
                df = parse_csv_file(fp, data_format=data_format, interval_type=interval_type)
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

            # For tick data, keep raw ticks (don't aggregate)
            is_tick_data = interval_type == "T"
            if is_tick_data and 'tick_ask' in combined.columns:
                # Keep tick_ask and tick_bid for Renko high/low calculation
                # The 'open', 'high', 'low', 'close' columns are already set in parse_csv_file:
                # - open/close = mid price (avg of bid/ask)
                # - high = ask price
                # - low = bid price
                pass  # Don't aggregate - keep raw ticks for granular Renko building

            # Ensure proper dtypes
            combined['open'] = pd.to_numeric(combined['open'], errors='coerce')
            combined['high'] = pd.to_numeric(combined['high'], errors='coerce')
            combined['low'] = pd.to_numeric(combined['low'], errors='coerce')
            combined['close'] = pd.to_numeric(combined['close'], errors='coerce')
            combined['volume'] = pd.to_numeric(combined['volume'], errors='coerce').fillna(0).astype(int)

            # Data cleaning and back-adjustment
            sched = request.session_schedule or _default_schedule()
            bars_removed = 0
            removed_session_dates = []
            adjusted_session_dates = []

            if request.clean_holidays:
                before_count = len(combined)
                combined, removed_session_dates = clean_holidays(combined, sched, request.clean_threshold_pct)
                if len(combined) == 0:
                    results.append({
                        "instrument": instrument,
                        "status": "error",
                        "message": "All sessions removed by holiday cleaning"
                    })
                    continue
                bars_removed = before_count - len(combined)

            if request.back_adjust:
                combined, adjusted_session_dates = back_adjust_data(combined, sched)

            # Save as feather - get unique path with format/interval tags
            output_path = get_unique_cache_path(cache_dir, instrument, data_format, interval_type)
            combined.to_feather(output_path)

            # Save metadata
            metadata = {
                "instrument": instrument,
                "data_format": data_format,
                "interval_type": interval_type,
                "source_files": filepaths,
                "rows": len(combined),
                "date_range": {
                    "start": combined['datetime'].min().isoformat(),
                    "end": combined['datetime'].max().isoformat()
                },
                "processed_at": datetime.now().isoformat(),
                "session_schedule": sched,
                "clean_holidays": request.clean_holidays,
                "back_adjust": request.back_adjust,
            }
            if request.clean_holidays:
                metadata["clean_threshold_pct"] = request.clean_threshold_pct
                metadata["sessions_removed_count"] = len(removed_session_dates)
                metadata["bars_removed_by_cleaning"] = bars_removed
            if request.back_adjust:
                metadata["sessions_adjusted_count"] = len(adjusted_session_dates)
            if removed_session_dates:
                metadata["removed_session_dates"] = removed_session_dates
            if adjusted_session_dates:
                metadata["adjusted_session_dates"] = adjusted_session_dates
            save_cache_metadata(output_path, metadata)

            # Use the actual filename (without extension) as the cache name
            cache_name = output_path.stem

            result = {
                "instrument": cache_name,
                "status": "success",
                "output": str(output_path),
                "rows": len(combined),
                "data_format": data_format,
                "interval_type": interval_type,
                "date_range": {
                    "start": combined['datetime'].min().isoformat(),
                    "end": combined['datetime'].max().isoformat()
                }
            }

            results.append(result)

    return {"results": results}


@app.get("/chart/{instrument}")
def get_chart_data(instrument: str, working_dir: Optional[str] = None, limit: Optional[int] = None):
    """Get OHLC data for charting."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    cache_dir = base_dir / "cache"
    feather_path = cache_dir / f"{instrument}.feather"

    if not feather_path.exists():
        raise HTTPException(status_code=404, detail=f"No cached data for {instrument}")

    df = pd.read_feather(feather_path)
    total_rows = len(df)

    # Check if this is tick data (has sub-second timestamps or tick columns)
    is_tick_data = 'tick_ask' in df.columns or '_T' in instrument

    # Apply limit if specified (return last N rows)
    if limit and len(df) > limit:
        df = df.tail(limit)

    # For tick data, use millisecond-precision timestamps to avoid duplicates
    if is_tick_data:
        # Format with milliseconds for tick data
        datetime_list = df['datetime'].dt.strftime('%Y-%m-%d %H:%M:%S.%f').tolist()
    else:
        datetime_list = df['datetime'].dt.strftime('%Y-%m-%d %H:%M:%S').tolist()

    # Read session_schedule from metadata if available
    meta_path = feather_path.with_suffix('.meta.json')
    session_schedule = _default_schedule()
    if meta_path.exists():
        try:
            with open(meta_path, 'r') as f:
                meta = json.load(f)
            if 'session_schedule' in meta:
                session_schedule = meta['session_schedule']
        except Exception:
            pass

    return {
        "instrument": instrument,
        "is_tick_data": is_tick_data,
        "data": {
            "datetime": datetime_list,
            "open": df['open'].tolist(),
            "high": df['high'].tolist(),
            "low": df['low'].tolist(),
            "close": df['close'].tolist(),
            "volume": df['volume'].tolist(),
        },
        "total_rows": total_rows,
        "displayed_rows": len(df),
        "session_schedule": session_schedule,
    }


def get_pip_value(instrument: str) -> float:
    """Get pip value for instrument (assumes forex pairs)."""
    # JPY pairs have 2 decimal places, others have 4
    if 'JPY' in instrument.upper():
        return 0.01
    return 0.0001


def _get_session_date(dt, schedule):
    """Assign a session date (close-day) to a UTC datetime using per-day schedule.

    The boundary for each trading day occurs at that day's configured hour:minute UTC.
    A bar before Monday's boundary belongs to Monday's session.
    A bar at or after Monday's boundary belongs to Tuesday's session.
    """
    dow = dt.weekday()  # 0=Mon..6=Sun
    dow_keys = [None] * 7
    dow_keys[0] = 'monday'
    dow_keys[1] = 'tuesday'
    dow_keys[2] = 'wednesday'
    dow_keys[3] = 'thursday'
    dow_keys[4] = 'friday'

    # Weekend: assign to Monday
    if dow in (5, 6):  # Sat, Sun
        days_to_mon = 7 - dow if dow == 5 else 0 + 1
        return (dt + pd.Timedelta(days=days_to_mon)).date()

    key = dow_keys[dow]
    if key and key in schedule:
        boundary_h = schedule[key].get('hour', 22)
        boundary_m = schedule[key].get('minute', 0)
    else:
        boundary_h, boundary_m = 22, 0

    minute_of_day = dt.hour * 60 + dt.minute
    boundary_min = boundary_h * 60 + boundary_m

    if minute_of_day < boundary_min:
        # Before boundary → today's session
        return dt.date()
    else:
        # At or after boundary → next trading day's session
        next_dt = dt + pd.Timedelta(days=1)
        # Skip weekend
        if next_dt.weekday() == 5:  # Sat
            next_dt += pd.Timedelta(days=2)
        elif next_dt.weekday() == 6:  # Sun
            next_dt += pd.Timedelta(days=1)
        return next_dt.date()


def _default_schedule():
    return {
        'monday': {'hour': 22, 'minute': 0},
        'tuesday': {'hour': 22, 'minute': 0},
        'wednesday': {'hour': 22, 'minute': 0},
        'thursday': {'hour': 22, 'minute': 0},
        'friday': {'hour': 22, 'minute': 0},
    }


def clean_holidays(df: pd.DataFrame, schedule: dict, threshold_pct: float = 50.0) -> pd.DataFrame:
    """Remove sessions with abnormally low bar counts (holidays, half-days, bad data).

    Drops entire sessions where the M1 bar count is below threshold_pct% of the
    median bar count across all sessions.
    """
    session_dates = df['datetime'].apply(lambda dt: _get_session_date(dt, schedule))
    counts = session_dates.value_counts()
    median_count = counts.median()
    threshold = median_count * threshold_pct / 100.0
    valid_sessions = counts[counts >= threshold].index
    removed_sessions = sorted(counts[counts < threshold].index)
    removed_details = [[str(d), int(median_count), int(counts[d])] for d in removed_sessions]
    mask = session_dates.isin(valid_sessions)
    return df[mask].reset_index(drop=True), removed_details


def back_adjust_data(df: pd.DataFrame, schedule: dict) -> pd.DataFrame:
    """Chain-adjust all sessions backwards to eliminate inter-session price gaps.

    The most recent session is the anchor (prices unchanged). All prior sessions
    are shifted by the cumulative gap so there are zero jumps between sessions.
    """
    df = df.copy()
    session_dates = df['datetime'].apply(lambda dt: _get_session_date(dt, schedule))
    df['_session_date'] = session_dates
    unique_sessions = sorted(df['_session_date'].unique())

    if len(unique_sessions) <= 1:
        df.drop(columns=['_session_date'], inplace=True)
        return df, []

    # First pass: collect all inter-session gaps from original (unmodified) data
    gaps = []  # gaps[i] = gap between session i and session i+1
    for i in range(len(unique_sessions) - 1):
        curr_last_close = df.loc[df['_session_date'] == unique_sessions[i], 'close'].iloc[-1]
        next_first_open = df.loc[df['_session_date'] == unique_sessions[i + 1], 'open'].iloc[0]
        gaps.append(next_first_open - curr_last_close)

    # Second pass: accumulate gaps backwards and apply shifts
    # The last session is the anchor (shift = 0). Each prior session gets
    # shifted by the sum of all gaps from it to the last session.
    cumulative_gap = 0.0
    for i in range(len(gaps) - 1, -1, -1):
        cumulative_gap += gaps[i]
        mask = df['_session_date'] == unique_sessions[i]
        for col in ['open', 'high', 'low', 'close']:
            df.loc[mask, col] += cumulative_gap

    adjusted_details = [[str(unique_sessions[i]), f"{float(gaps[i]):.5f}"] for i in range(len(gaps))]
    df.drop(columns=['_session_date'], inplace=True)
    return df, adjusted_details


def compute_adr_lookup(raw_df: pd.DataFrame, adr_period: int, session_schedule: dict = None) -> pd.Series:
    """Date-keyed Series of ADR values from raw M1 OHLC data."""
    schedule = session_schedule or _default_schedule()
    tmp = raw_df.copy()
    tmp['utc_date'] = tmp['datetime'].apply(lambda dt: _get_session_date(dt, schedule))
    daily_stats = tmp.groupby('utc_date').agg(
        day_high=('high', 'max'), day_low=('low', 'min')
    )
    daily_stats['daily_range'] = daily_stats['day_high'] - daily_stats['day_low']
    daily_stats['adr'] = daily_stats['daily_range'].shift(1).rolling(
        window=adr_period, min_periods=adr_period
    ).mean()
    return daily_stats['adr']


def generate_renko_custom(df: pd.DataFrame, brick_size: float, reversal_multiplier: float = 2.0, wick_mode: str = "all", size_schedule=None) -> tuple[pd.DataFrame, dict]:
    """
    Generate Renko bricks with configurable reversal multiplier using threshold-based logic.

    Standard Renko uses reversal_multiplier=2 (need 2x brick size to reverse).
    This implementation allows custom reversal thresholds.

    size_schedule: optional list of (m1_index, brick_size, reversal_size, adr_value) tuples.
        When provided, brick/reversal sizes change dynamically per session (lock-at-start).

    wick_mode options:
        - "all": Show all wicks (any retracement)
        - "big": Only show wicks when retracement > brick_size
        - "none": No wicks at all

    Returns:
        tuple: (completed_bricks_df, pending_brick_dict)
    """
    def get_schedule_values(m1_idx):
        if size_schedule is None:
            return brick_size, brick_size * reversal_multiplier, None
        best = size_schedule[0]
        for entry in size_schedule:
            if entry[0] <= m1_idx:
                best = entry
            else:
                break
        return best[1], best[2], best[3]

    def find_threshold_crossings(closes, start_idx, end_idx, start_threshold, brick_sz, direction):
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
                    current_threshold += brick_sz
            elif direction == -1 and price <= current_threshold:
                # Find all thresholds crossed by this bar
                while price <= current_threshold:
                    crossings.append((current_open, j))
                    current_open = j
                    current_threshold -= brick_sz

        return crossings

    def calc_up_brick_low(pending_low_val, brick_open, brick_sz, apply_wick=True):
        """Calculate low for up brick based on wick mode."""
        if wick_mode == "none" or not apply_wick:
            return brick_open
        elif wick_mode == "all":
            return min(pending_low_val, brick_open)
        elif wick_mode == "big":
            retracement = round(brick_open - pending_low_val, 5)
            if retracement > brick_sz:
                return pending_low_val
            return brick_open
        return brick_open

    def calc_down_brick_high(pending_high_val, brick_open, brick_sz, apply_wick=True):
        """Calculate high for down brick based on wick mode."""
        if wick_mode == "none" or not apply_wick:
            return brick_open
        elif wick_mode == "all":
            return max(pending_high_val, brick_open)
        elif wick_mode == "big":
            retracement = round(pending_high_val - brick_open, 5)
            if retracement > brick_sz:
                return pending_high_val
            return brick_open
        return brick_open

    open_prices = df['open'].values
    close_prices = df['close'].values
    high_prices = df['high'].values
    low_prices = df['low'].values
    timestamps = df.index

    if len(close_prices) < 2:
        return pd.DataFrame(), None

    # Initialize active/pending size tracking
    if size_schedule is None:
        reversal_size = brick_size * reversal_multiplier
        active_bs, active_rs, active_adr = brick_size, reversal_size, None
    else:
        active_bs, active_rs, active_adr = get_schedule_values(0)
    pending_bs, pending_rs, pending_adr = active_bs, active_rs, active_adr

    bricks = []

    # Initialize with first M1 bar's OPEN rounded to brick boundary
    ref_price = np.floor(open_prices[0] / active_bs) * active_bs

    # State variables
    last_brick_close = ref_price
    direction = 0  # 0 = undetermined, 1 = up, -1 = down
    up_threshold = ref_price + active_bs
    down_threshold = ref_price - active_bs
    pending_high = high_prices[0]
    pending_low = low_prices[0]
    tick_idx_open = 0

    for i in range(len(close_prices)):
        # Update pending schedule values for this M1 bar
        pending_bs, pending_rs, pending_adr = get_schedule_values(i)

        # Update pending high/low with current bar's high/low
        pending_high = max(pending_high, high_prices[i])
        pending_low = min(pending_low, low_prices[i])
        price = close_prices[i]

        if direction == 0:
            # Undetermined direction - check which threshold is crossed first
            if price >= up_threshold:
                # Create UP brick
                brick_open = last_brick_close
                brick_close = brick_open + active_bs
                bricks.append({
                    'datetime': timestamps[tick_idx_open],
                    'open': brick_open,
                    'high': brick_close,
                    'low': calc_up_brick_low(pending_low, brick_open, active_bs),
                    'close': brick_close,
                    'direction': 1,
                    'is_reversal': 0,
                    'tick_index_open': tick_idx_open,
                    'tick_index_close': i,
                    'brick_size': active_bs,
                    'reversal_size': active_rs,
                    'adr_value': active_adr
                })
                last_brick_close = brick_close
                direction = 1
                # Promote pending -> active
                active_bs, active_rs, active_adr = pending_bs, pending_rs, pending_adr
                # Update thresholds with NEW active values
                up_threshold = brick_close + active_bs
                down_threshold = brick_close - active_rs
                # Reset pending values
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i

            elif price <= down_threshold:
                # Create DOWN brick
                brick_open = last_brick_close
                brick_close = brick_open - active_bs
                bricks.append({
                    'datetime': timestamps[tick_idx_open],
                    'open': brick_open,
                    'high': calc_down_brick_high(pending_high, brick_open, active_bs),
                    'low': brick_close,
                    'close': brick_close,
                    'direction': -1,
                    'is_reversal': 0,
                    'tick_index_open': tick_idx_open,
                    'tick_index_close': i,
                    'brick_size': active_bs,
                    'reversal_size': active_rs,
                    'adr_value': active_adr
                })
                last_brick_close = brick_close
                direction = -1
                # Promote pending -> active
                active_bs, active_rs, active_adr = pending_bs, pending_rs, pending_adr
                # Update thresholds with NEW active values
                down_threshold = brick_close - active_bs
                up_threshold = brick_close + active_rs
                # Reset pending values
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i

        elif direction == 1:
            # Uptrend - check for continuation or reversal
            if price >= up_threshold:
                # Create UP brick(s) - continuation
                crossings = find_threshold_crossings(close_prices, tick_idx_open, i, up_threshold, active_bs, 1)

                for idx, (cross_open, cross_close) in enumerate(crossings):
                    brick_open = last_brick_close
                    brick_close = brick_open + active_bs
                    first_brick = (idx == 0)
                    brick_pending_low = low_prices[cross_open:cross_close+1].min() if wick_mode == "all" and not first_brick else pending_low
                    bricks.append({
                        'datetime': timestamps[cross_open],
                        'open': brick_open,
                        'high': brick_close,
                        'low': calc_up_brick_low(brick_pending_low, brick_open, active_bs, apply_wick=first_brick),
                        'close': brick_close,
                        'direction': 1,
                        'is_reversal': 0,
                        'tick_index_open': cross_open,
                        'tick_index_close': cross_close,
                        'brick_size': active_bs,
                        'reversal_size': active_rs,
                        'adr_value': active_adr
                    })
                    last_brick_close = brick_close

                # Promote pending -> active AFTER batch
                active_bs, active_rs, active_adr = pending_bs, pending_rs, pending_adr
                # Update thresholds with NEW active values
                up_threshold = last_brick_close + active_bs
                down_threshold = last_brick_close - active_rs

                # Reset pending values after all bricks created
                if len(crossings) > 1:
                    pending_high = high_prices[i]
                    pending_low = last_brick_close
                else:
                    pending_high = high_prices[i]
                    pending_low = low_prices[i]
                tick_idx_open = i

            elif price <= down_threshold:
                # Reversal to DOWN
                first_brick_threshold = last_brick_close - active_bs
                crossings = find_threshold_crossings(close_prices, tick_idx_open, i, first_brick_threshold, active_bs, -1)

                for idx, (cross_open, cross_close) in enumerate(crossings):
                    brick_open = last_brick_close
                    brick_close = brick_open - active_bs
                    first_brick = (idx == 0)
                    brick_pending_high = high_prices[cross_open:cross_close+1].max() if wick_mode == "all" and not first_brick else pending_high

                    # Special handling for second bar of reversal (idx==1)
                    if idx == 1:
                        if wick_mode == "none":
                            brick_high = brick_open
                        elif wick_mode == "all":
                            brick_range_high = high_prices[cross_open:cross_close+1].max()
                            brick_high = max(brick_range_high, brick_open)
                        elif wick_mode == "big":
                            brick_range_high = high_prices[cross_open:cross_close+1].max()
                            retracement = round(brick_range_high - brick_open, 5)
                            if retracement > active_bs:
                                brick_high = brick_range_high
                            else:
                                brick_high = brick_open
                        else:
                            brick_high = brick_open
                    else:
                        brick_high = calc_down_brick_high(brick_pending_high, brick_open, active_bs, apply_wick=first_brick)

                    bricks.append({
                        'datetime': timestamps[cross_open],
                        'open': brick_open,
                        'high': brick_high,
                        'low': brick_close,
                        'close': brick_close,
                        'direction': -1,
                        'is_reversal': 1 if first_brick else 0,
                        'tick_index_open': cross_open,
                        'tick_index_close': cross_close,
                        'brick_size': active_bs,
                        'reversal_size': active_rs,
                        'adr_value': active_adr
                    })
                    last_brick_close = brick_close

                direction = -1
                # Promote pending -> active AFTER batch
                active_bs, active_rs, active_adr = pending_bs, pending_rs, pending_adr
                # Update thresholds with NEW active values
                down_threshold = last_brick_close - active_bs
                up_threshold = last_brick_close + active_rs

                # Reset pending values after all bricks created
                if len(crossings) > 1:
                    pending_high = last_brick_close
                    pending_low = low_prices[i]
                else:
                    pending_high = high_prices[i]
                    pending_low = low_prices[i]
                tick_idx_open = i

        else:  # direction == -1
            # Downtrend - check for continuation or reversal
            if price <= down_threshold:
                # Create DOWN brick(s) - continuation
                crossings = find_threshold_crossings(close_prices, tick_idx_open, i, down_threshold, active_bs, -1)

                for idx, (cross_open, cross_close) in enumerate(crossings):
                    brick_open = last_brick_close
                    brick_close = brick_open - active_bs
                    first_brick = (idx == 0)
                    brick_pending_high = high_prices[cross_open:cross_close+1].max() if wick_mode == "all" and not first_brick else pending_high
                    bricks.append({
                        'datetime': timestamps[cross_open],
                        'open': brick_open,
                        'high': calc_down_brick_high(brick_pending_high, brick_open, active_bs, apply_wick=first_brick),
                        'low': brick_close,
                        'close': brick_close,
                        'direction': -1,
                        'is_reversal': 0,
                        'tick_index_open': cross_open,
                        'tick_index_close': cross_close,
                        'brick_size': active_bs,
                        'reversal_size': active_rs,
                        'adr_value': active_adr
                    })
                    last_brick_close = brick_close

                # Promote pending -> active AFTER batch
                active_bs, active_rs, active_adr = pending_bs, pending_rs, pending_adr
                # Update thresholds with NEW active values
                down_threshold = last_brick_close - active_bs
                up_threshold = last_brick_close + active_rs

                # Reset pending values after all bricks created
                if len(crossings) > 1:
                    pending_high = last_brick_close
                    pending_low = low_prices[i]
                else:
                    pending_high = high_prices[i]
                    pending_low = low_prices[i]
                tick_idx_open = i

            elif price >= up_threshold:
                # Reversal to UP
                first_brick_threshold = last_brick_close + active_bs
                crossings = find_threshold_crossings(close_prices, tick_idx_open, i, first_brick_threshold, active_bs, 1)

                for idx, (cross_open, cross_close) in enumerate(crossings):
                    brick_open = last_brick_close
                    brick_close = brick_open + active_bs
                    first_brick = (idx == 0)
                    brick_pending_low = low_prices[cross_open:cross_close+1].min() if wick_mode == "all" and not first_brick else pending_low

                    # Special handling for second bar of reversal (idx==1)
                    if idx == 1:
                        if wick_mode == "none":
                            brick_low = brick_open
                        elif wick_mode == "all":
                            brick_range_low = low_prices[cross_open:cross_close+1].min()
                            brick_low = min(brick_range_low, brick_open)
                        elif wick_mode == "big":
                            brick_range_low = low_prices[cross_open:cross_close+1].min()
                            retracement = round(brick_open - brick_range_low, 5)
                            if retracement > active_bs:
                                brick_low = brick_range_low
                            else:
                                brick_low = brick_open
                        else:
                            brick_low = brick_open
                    else:
                        brick_low = calc_up_brick_low(brick_pending_low, brick_open, active_bs, apply_wick=first_brick)

                    bricks.append({
                        'datetime': timestamps[cross_open],
                        'open': brick_open,
                        'high': brick_close,
                        'low': brick_low,
                        'close': brick_close,
                        'direction': 1,
                        'is_reversal': 1 if first_brick else 0,
                        'tick_index_open': cross_open,
                        'tick_index_close': cross_close,
                        'brick_size': active_bs,
                        'reversal_size': active_rs,
                        'adr_value': active_adr
                    })
                    last_brick_close = brick_close

                direction = 1
                # Promote pending -> active AFTER batch
                active_bs, active_rs, active_adr = pending_bs, pending_rs, pending_adr
                # Update thresholds with NEW active values
                up_threshold = last_brick_close + active_bs
                down_threshold = last_brick_close - active_rs

                # Reset pending values after all bricks created
                if len(crossings) > 1:
                    pending_high = high_prices[i]
                    pending_low = last_brick_close
                else:
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
                'low': calc_up_brick_low(pending_low, brick_open, active_bs),
                'close': current_price,
                'direction': direction,
                'tick_index_open': tick_idx_open,
                'tick_index_close': last_idx,
                'brick_size': active_bs,
                'reversal_size': active_rs,
                'adr_value': active_adr
            }
        else:
            # Pending down brick
            pending_brick = {
                'open': brick_open,
                'high': calc_down_brick_high(pending_high, brick_open, active_bs),
                'low': min(current_price, brick_open),
                'close': current_price,
                'direction': direction,
                'tick_index_open': tick_idx_open,
                'tick_index_close': last_idx,
                'brick_size': active_bs,
                'reversal_size': active_rs,
                'adr_value': active_adr
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
    cache_dir = base_dir / "cache"
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

    # Build size_schedule for ADR mode, or use price mode defaults
    size_schedule = None
    if request.sizing_mode == "adr":
        # Load raw data for ADR computation
        raw_df = pd.read_feather(feather_path)
        raw_df = raw_df.set_index('datetime')
        raw_df = raw_df.dropna()
        raw_df = raw_df.sort_index()
        raw_df = raw_df.reset_index()  # compute_adr_lookup expects 'datetime' column
        session_sched = request.session_schedule or _default_schedule()
        adr_series = compute_adr_lookup(raw_df, request.adr_period, session_sched)

        # Build schedule by walking M1 dates
        size_schedule = []
        prev_date_adr = None
        for idx in range(len(df)):
            dt = _get_session_date(df.index[idx], session_sched)
            adr_val = adr_series.get(dt)
            if adr_val is not None and not np.isnan(adr_val) and adr_val != prev_date_adr:
                bs = round(adr_val * request.brick_pct / 100, 6)
                rs = round(adr_val * request.reversal_pct / 100, 6)
                size_schedule.append((idx, bs, rs, round(adr_val, 6)))
                prev_date_adr = adr_val

        if not size_schedule:
            raise HTTPException(
                status_code=400,
                detail=f"Insufficient history for ADR({request.adr_period}). Need at least {request.adr_period + 1} trading sessions."
            )

        brick_size = size_schedule[0][1]
        reversal_size = size_schedule[0][2]
    else:
        # Price mode - use direct price values
        brick_size = request.brick_size
        reversal_size = request.reversal_size

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

        renko_df, pending_brick = generate_renko_custom(
            df, brick_size, reversal_mult, request.wick_mode, size_schedule=size_schedule
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

    # Round OHLC to 5 decimal places (match parquet generation)
    for col in ['open', 'high', 'low', 'close']:
        renko_df[col] = renko_df[col].round(5)

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

    return {
        "instrument": instrument,
        "brick_size": brick_size,
        "reversal_size": reversal_size,
        "sizing_mode": request.sizing_mode,
        "adr_period": request.adr_period if request.sizing_mode == "adr" else None,
        "data": {
            "datetime": datetime_list,
            "open": renko_df['open'].tolist(),
            "high": renko_df['high'].tolist(),
            "low": renko_df['low'].tolist(),
            "close": renko_df['close'].tolist(),
            "volume": renko_df['volume'].tolist() if 'volume' in renko_df.columns else [1] * len(renko_df),
            "tick_index_open": renko_df['tick_index_open'].tolist() if 'tick_index_open' in renko_df.columns else None,
            "tick_index_close": renko_df['tick_index_close'].tolist() if 'tick_index_close' in renko_df.columns else None,
            "brick_size": renko_df['brick_size'].tolist() if 'brick_size' in renko_df.columns else None,
            "reversal_size": renko_df['reversal_size'].tolist() if 'reversal_size' in renko_df.columns else None,
            "adr_value": renko_df['adr_value'].tolist() if 'adr_value' in renko_df.columns else None,
        },
        "pending_brick": pending_brick,
        "total_bricks": len(renko_df)
    }


def compute_stats_columns(df, raw_df, session_sched, adr_period, ma1_period, ma2_period, ma3_period, chop_period,
                           smae1_period=20, smae1_deviation=1.0, smae2_period=50, smae2_deviation=1.0,
                           pwap_sigmas=None):
    """Compute all stats/ML columns on a renko DataFrame.
    df: must already have datetime, OHLC, brick_size, reversal_size, settings columns.
    raw_df: raw M1 OHLC (with 'datetime' column) for ADR computation.
    Returns enriched df with all columns, trimmed. Includes session_date and EMA price columns."""
    if pwap_sigmas is None:
        pwap_sigmas = [1.0, 2.0, 2.5, 3.0]
    adr_series = compute_adr_lookup(raw_df, adr_period, session_sched)

    # Map currentADR back to renko bars based on their session date
    df['datetime'] = pd.to_datetime(df['datetime'])
    df['session_date'] = df['datetime'].apply(lambda dt: _get_session_date(dt, session_sched))
    df['currentADR'] = df['session_date'].map(adr_series).round(5)

    # Calculate EMA values and store price columns (metadata, grouped left)
    ma_periods = [ma1_period, ma2_period, ma3_period]
    ema_columns = {}

    for idx, period in enumerate(ma_periods, start=1):
        ema_values = calculate_ema(df['close'], period)
        ema_columns[period] = ema_values
        df[f'EMA{idx}_Price'] = ema_values.round(5)

    # Calculate SMAE (Simple Moving Average Envelope) columns
    for idx, (period, deviation) in enumerate([(smae1_period, smae1_deviation), (smae2_period, smae2_deviation)], start=1):
        sma = df['close'].rolling(window=period).mean()
        df[f'SMAE{idx}_Center'] = sma.round(5)
        df[f'SMAE{idx}_Upper'] = (sma * (1 + deviation / 100)).round(5)
        df[f'SMAE{idx}_Lower'] = (sma * (1 - deviation / 100)).round(5)

    # Calculate PWAP (Price-Weighted Average Price) columns per session
    tp = (df['high'] + df['low'] + df['close']) / 3
    _tp_vals = tp.values
    _sess_vals = df['session_date'].values
    _pwap_mean = np.empty(len(df))
    _pwap_std = np.empty(len(df))
    _last_sess = None
    _sess_tps = []
    for _i in range(len(df)):
        if _sess_vals[_i] != _last_sess:
            _sess_tps = []
            _last_sess = _sess_vals[_i]
        _sess_tps.append(_tp_vals[_i])
        _count = len(_sess_tps)
        _m = sum(_sess_tps) / _count
        _pwap_mean[_i] = _m
        if _count < 2:
            _pwap_std[_i] = 0.0
        else:
            _sq_sum = sum((_v - _m) ** 2 for _v in _sess_tps)
            _pwap_std[_i] = (_sq_sum / _count) ** 0.5
    df['PWAP_Mean'] = np.round(_pwap_mean, 5)
    for _si, _sigma in enumerate(pwap_sigmas, start=1):
        df[f'PWAP_Upper{_si}'] = np.round(_pwap_mean + _pwap_std * _sigma, 5)
        df[f'PWAP_Lower{_si}'] = np.round(_pwap_mean - _pwap_std * _sigma, 5)

    # PWAP distance columns
    df['PWAP_distance'] = (df['close'] - df['PWAP_Mean']).round(5)
    df['PWAP_distance_ADR'] = (df['PWAP_distance'] / df['currentADR']).round(5)
    df['PWAP_distance_RR'] = (df['PWAP_distance'] / df['reversal_size']).round(5)

    # Calculate EMA distance columns (derived data, right side)
    for period in ma_periods:
        ema_values = ema_columns[period]
        df[f'EMA_rawDistance({period})'] = (df['close'] - ema_values).round(5)
        df[f'EMA_adrDistance({period})'] = ((df['close'] - ema_values) / df['currentADR']).round(5)
        df[f'EMA_rrDistance({period})'] = ((df['close'] - ema_values) / df['reversal_size']).round(5)

    # Calculate DD (drawdown/wick size in price units)
    df['DD'] = np.where(
        df['close'] > df['open'],
        df['open'] - df['low'],
        df['high'] - df['open']
    )
    df['DD'] = df['DD'].round(5)
    df['DD_ADR'] = (df['DD'] / df['currentADR']).round(5)
    df['DD_RR'] = (df['DD'] / df['reversal_size']).round(5)

    # Calculate State based on MA order
    fast_ema = ema_columns[ma1_period]
    med_ema = ema_columns[ma2_period]
    slow_ema = ema_columns[ma3_period]

    def get_state(fast, med, slow):
        if fast > med > slow: return 3
        if fast > slow > med: return 2
        if slow > fast > med: return 1
        if med > fast > slow: return -1
        if med > slow > fast: return -2
        if slow > med > fast: return -3
        return 0

    df['State'] = [get_state(f, m, s) for f, m, s in zip(fast_ema, med_ema, slow_ema)]
    df['prState'] = df['State'].shift(1)

    # fromState: the state of the previous run
    state_list = df['State'].tolist()
    from_state = [None] * len(state_list)
    last_state = None
    for i in range(1, len(state_list)):
        if state_list[i] != state_list[i - 1]:
            last_state = state_list[i - 1]
        from_state[i] = last_state
    df['fromState'] = from_state

    # Calculate Type1 and Type2 pullback counters
    state_arr = df['State'].values
    is_up_arr_t = (df['close'] > df['open']).values
    is_dn_arr_t = (df['close'] < df['open']).values
    open_arr = df['open'].values
    high_arr = df['high'].values
    low_arr = df['low'].values
    rev_size_arr = df['reversal_size'].values
    brick_size_arr = df['brick_size'].values

    n = len(df)
    type1_count = np.zeros(n, dtype=int)
    type2_count = np.zeros(n, dtype=int)

    internal_type1 = 0
    internal_type2 = 0
    prev_state = None

    for i in range(n):
        state = int(state_arr[i])
        if state != prev_state:
            internal_type1 = 0
            internal_type2 = 0
        prev_state = state

        is_up = bool(is_up_arr_t[i])
        is_dn = bool(is_dn_arr_t[i])
        use_3bar = rev_size_arr[i] > brick_size_arr[i]

        if i > 1:
            prior_is_up = bool(is_up_arr_t[i - 1])
            prior_is_dn = bool(is_dn_arr_t[i - 1])
            prior2_is_up = bool(is_up_arr_t[i - 2])
            prior2_is_dn = bool(is_dn_arr_t[i - 2])

            if state == 3 and is_up and prior_is_up and prior2_is_dn:
                internal_type1 += 1
                type1_count[i] = internal_type1
            elif state == -3 and is_dn and prior_is_dn and prior2_is_up:
                internal_type1 -= 1
                type1_count[i] = internal_type1

        if use_3bar and i > 0:
            prior_is_up_t2 = bool(is_up_arr_t[i - 1])
            brick_i = brick_size_arr[i]

            if state == 3 and is_up and round(open_arr[i] - low_arr[i], 5) > brick_i and prior_is_up_t2:
                internal_type2 += 1
                type2_count[i] = internal_type2
            elif state == -3 and is_dn and round(high_arr[i] - open_arr[i], 5) > brick_i and not prior_is_up_t2:
                internal_type2 -= 1
                type2_count[i] = internal_type2

    df['Type1'] = type1_count
    df['Type2'] = type2_count

    # Calculate consecutive bar counters
    is_up = df['close'] > df['open']

    con_up = []
    con_dn = []
    up_count = 0
    dn_count = 0

    for up in is_up:
        if up:
            up_count += 1
            dn_count = 0
        else:
            dn_count += 1
            up_count = 0
        con_up.append(up_count)
        con_dn.append(dn_count)

    df['Con_UP_bars'] = con_up
    df['Con_DN_bars'] = con_dn

    df['direction'] = is_up.map({True: 1, False: -1}).astype(int)

    # priorRunCount
    prior_run = [0] * len(is_up)
    last_run_length = 0
    is_up_list = is_up.tolist()
    for i in range(1, len(is_up_list)):
        if is_up_list[i] != is_up_list[i - 1]:
            last_run_length = con_up[i - 1] if is_up_list[i - 1] else con_dn[i - 1]
        prior_run[i] = last_run_length
    df['priorRunCount'] = prior_run

    # Con_UP_bars(state) and Con_DN_bars(state)
    state_values = df['State'].tolist()
    con_up_state = []
    con_dn_state = []
    up_count_state = 0
    dn_count_state = 0
    prev_state = None

    for i, (up, state) in enumerate(zip(is_up, state_values)):
        if prev_state is not None and state != prev_state:
            up_count_state = 0
            dn_count_state = 0
        if up:
            up_count_state += 1
            dn_count_state = 0
        else:
            dn_count_state += 1
            up_count_state = 0
        con_up_state.append(up_count_state)
        con_dn_state.append(dn_count_state)
        prev_state = state

    df['Con_UP_bars(state)'] = con_up_state
    df['Con_DN_bars(state)'] = con_dn_state

    # Bar duration in minutes
    bar_duration_td = df['datetime'] - df['datetime'].shift(1)
    df['barDuration'] = (bar_duration_td.dt.total_seconds() / 60).round(2)

    # stateBarCount and stateDuration
    state_values = df['State'].tolist()
    bar_durations = df['barDuration'].tolist()
    state_bar_count = []
    state_duration = []
    bar_count = 0
    duration_sum = 0.0
    prev_state_dur = None

    for i, (state, bar_dur) in enumerate(zip(state_values, bar_durations)):
        if prev_state_dur is not None and state != prev_state_dur:
            bar_count = 0
            duration_sum = 0.0
        bar_count += 1
        if pd.notna(bar_dur):
            duration_sum += bar_dur
        state_bar_count.append(bar_count)
        state_duration.append(round(duration_sum, 2))
        prev_state_dur = state

    df['stateBarCount'] = state_bar_count
    df['stateDuration'] = state_duration

    # Chop index
    directions = (df['close'] > df['open']).astype(int)
    reversals = (directions != directions.shift(1)).astype(int)
    reversals.iloc[0] = 0
    df['chop(rolling)'] = (reversals.rolling(window=chop_period, min_periods=chop_period).sum() / chop_period).round(2)

    # MFE_clr_Bars
    is_up_arr = is_up.values
    n = len(is_up_arr)
    mfe_clr_bars = np.zeros(n, dtype=int)

    for i in range(n):
        count = 0
        current_color = is_up_arr[i]
        for j in range(i + 1, n):
            if is_up_arr[j] == current_color:
                count += 1
            else:
                break
        if count == 0:
            mfe_clr_bars[i] = 0
        else:
            mfe_clr_bars[i] = count

    df['MFE_clr_Bars'] = mfe_clr_bars

    # MFE_clr_price
    close_arr = df['close'].values
    mfe_clr_price = np.zeros(n, dtype=float)

    for i in range(n):
        if mfe_clr_bars[i] > 0:
            last_match_idx = i + mfe_clr_bars[i]
            mfe_clr_price[i] = abs(close_arr[last_match_idx] - close_arr[i])
        else:
            mfe_clr_price[i] = 0

    df['MFE_clr_price'] = pd.Series(mfe_clr_price).round(5).values
    df['MFE_clr_ADR'] = (df['MFE_clr_price'] / df['currentADR']).round(2)
    df['MFE_clr_RR'] = (df['MFE_clr_price'] / df['reversal_size']).round(2)
    df['REAL_clr_ADR'] = ((df['MFE_clr_price'] - df['reversal_size']) / df['currentADR']).round(2)
    df['REAL_clr_RR'] = ((df['MFE_clr_price'] - df['reversal_size']) / df['reversal_size']).round(2)

    # REAL_MA columns
    for idx, period in enumerate(ma_periods, start=1):
        ema_values = calculate_ema(df['close'], period)
        mfe_ma_price = np.full(n, np.nan, dtype=float)

        for i in range(n):
            current_is_up = is_up_arr[i]
            current_close = close_arr[i]
            rev_size = df['reversal_size'].iloc[i]

            for j in range(i + 1, n):
                if is_up_arr[j] != current_is_up:
                    if current_is_up:
                        if close_arr[j] < ema_values[j]:
                            mfe_ma_price[i] = max(close_arr[j] - current_close, -rev_size)
                            break
                    else:
                        if close_arr[j] > ema_values[j]:
                            mfe_ma_price[i] = max(current_close - close_arr[j], -rev_size)
                            break

        df[f'REAL_MA{idx}_Price'] = pd.Series(mfe_ma_price).round(5).values
        df[f'REAL_MA{idx}_ADR'] = (mfe_ma_price / df['currentADR']).round(2)
        df[f'REAL_MA{idx}_RR'] = (mfe_ma_price / df['reversal_size']).round(2)

    # LEFT CUT: first row where all warmup columns are valid
    left_cols = ['currentADR'] + [f'EMA_rawDistance({p})' for p in ma_periods] + ['SMAE1_Center', 'SMAE2_Center']
    left_valid = df[left_cols].notna().all(axis=1)
    left_cut = left_valid.idxmax()

    # RIGHT CUT: last row where all forward-scan columns are valid
    right_cols = [f'REAL_MA{idx}_Price' for idx in range(1, len(ma_periods) + 1)]
    right_valid = df[right_cols].notna().all(axis=1)
    right_cut = right_valid[::-1].idxmax()

    df = df.loc[left_cut:right_cut].reset_index(drop=True)

    return df


@app.post("/stats/{instrument}")
async def generate_stats(instrument: str, request: StatsRequest):
    """Generate a parquet file with chart statistics for ML training."""
    base_dir = Path(request.working_dir) if request.working_dir else WORKING_DIR
    stats_dir = base_dir / "Stats"

    # Create Stats directory if it doesn't exist
    stats_dir.mkdir(parents=True, exist_ok=True)

    # Build the output filepath
    filename = request.filename.replace('.parquet', '')  # Remove extension if provided
    output_path = stats_dir / f"{filename}.parquet"

    # Extract renko data from request
    renko_data = request.renko_data

    # Create DataFrame from renko data
    df = pd.DataFrame({
        'datetime': renko_data.get('datetime', []),
        'open': renko_data.get('open', []),
        'high': renko_data.get('high', []),
        'low': renko_data.get('low', []),
        'close': renko_data.get('close', []),
    })

    # Round OHLC columns to 5 decimal places
    for col in ['open', 'high', 'low', 'close']:
        df[col] = df[col].round(5)

    # Add settings columns - use per-brick arrays if available (ADR mode)
    df['adr_period'] = request.adr_period
    if 'brick_size' in renko_data and isinstance(renko_data['brick_size'], list):
        df['brick_size'] = renko_data['brick_size']
        df['reversal_size'] = renko_data['reversal_size']
    else:
        df['brick_size'] = request.brick_size
        df['reversal_size'] = request.reversal_size
    df['wick_mode'] = request.wick_mode
    df['ma1_period'] = request.ma1_period
    df['ma2_period'] = request.ma2_period
    df['ma3_period'] = request.ma3_period
    df['chopPeriod'] = request.chop_period
    df['smae1_period'] = request.smae1_period
    df['smae1_deviation'] = request.smae1_deviation
    df['smae2_period'] = request.smae2_period
    df['smae2_deviation'] = request.smae2_deviation
    df['pwap_sigmas'] = json.dumps(request.pwap_sigmas)

    # Compute all stats columns using shared helper
    cache_dir = base_dir / "cache"
    feather_path = cache_dir / f"{instrument}.feather"
    raw_df = pd.read_feather(feather_path)
    session_sched = request.session_schedule or _default_schedule()

    df = compute_stats_columns(
        df, raw_df, session_sched,
        request.adr_period, request.ma1_period, request.ma2_period,
        request.ma3_period, request.chop_period,
        request.smae1_period, request.smae1_deviation,
        request.smae2_period, request.smae2_deviation,
        request.pwap_sigmas
    )

    # Write to parquet with session_schedule and indicator params in metadata
    table = pa.Table.from_pandas(df, preserve_index=False)
    existing_meta = table.schema.metadata or {}
    extra_meta = {
        b'session_schedule': json.dumps(session_sched).encode('utf-8'),
        b'smae_params': json.dumps({
            'smae1': {'period': request.smae1_period, 'deviation': request.smae1_deviation},
            'smae2': {'period': request.smae2_period, 'deviation': request.smae2_deviation},
        }).encode('utf-8'),
        b'pwap_sigmas': json.dumps(request.pwap_sigmas).encode('utf-8'),
    }
    table = table.replace_schema_metadata({**existing_meta, **extra_meta})
    pq.write_table(table, output_path)

    return {
        "status": "success",
        "filepath": str(output_path),
        "rows": len(df),
        "instrument": instrument
    }


# ── Bypass Template Persistence ─────────────────────────────────────────────────

def _templates_json_path(working_dir=None):
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    return base_dir / "Bypass" / "templates.json"


def _read_templates(json_path):
    if json_path.exists():
        try:
            return json.loads(json_path.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _write_templates(json_path, templates):
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(templates, indent=2), encoding="utf-8")


@app.get("/bypass-templates")
def get_bypass_templates(working_dir: Optional[str] = None):
    json_path = _templates_json_path(working_dir)
    return {"templates": _read_templates(json_path)}


@app.post("/bypass-templates")
def save_bypass_template(template: BypassTemplate, working_dir: Optional[str] = None):
    json_path = _templates_json_path(working_dir)
    templates = _read_templates(json_path)
    found = False
    for t in templates:
        if t["name"] == template.name:
            t.update(template.dict())
            found = True
            break
    if not found:
        templates.append(template.dict())
    _write_templates(json_path, templates)
    return {"templates": templates}


@app.delete("/bypass-templates")
def delete_bypass_template(name: str, working_dir: Optional[str] = None):
    json_path = _templates_json_path(working_dir)
    templates = _read_templates(json_path)
    templates = [t for t in templates if t["name"] != name]
    _write_templates(json_path, templates)
    return {"templates": templates}


# ── Direct Generate Endpoint ───────────────────────────────────────────────────

@app.post("/direct-generate")
def direct_generate(request: DirectGenerateRequest):
    """Generate parquets directly from cached feather files without loading the chart."""
    base_dir = Path(request.working_dir) if request.working_dir else WORKING_DIR
    cache_dir = base_dir / "cache"
    stats_dir = base_dir / "Stats"
    stats_dir.mkdir(parents=True, exist_ok=True)

    results = []

    for job in request.jobs:
        try:
            feather_path = cache_dir / f"{job.instrument}.feather"
            if not feather_path.exists():
                results.append({"instrument": job.instrument, "filename": job.filename,
                                "status": "error", "error": f"No cached data for {job.instrument}"})
                continue

            # Read feather
            raw_df = pd.read_feather(feather_path)

            # Resolve session_schedule: job override → feather .meta.json → default
            session_sched = job.session_schedule
            if session_sched is None:
                meta = load_cache_metadata(feather_path)
                if meta and "session_schedule" in meta:
                    session_sched = meta["session_schedule"]
            if session_sched is None:
                session_sched = _default_schedule()

            # Prepare M1 data (same as /renko)
            df = raw_df.copy()
            df = df.set_index('datetime')
            df = df.dropna()
            df = df.sort_index()

            # Build size_schedule for ADR mode
            size_schedule = None
            if job.sizing_mode == "adr":
                raw_for_adr = raw_df.copy()
                raw_for_adr = raw_for_adr.set_index('datetime').dropna().sort_index().reset_index()
                adr_series = compute_adr_lookup(raw_for_adr, job.adr_period, session_sched)

                size_schedule = []
                prev_date_adr = None
                for idx in range(len(df)):
                    dt = _get_session_date(df.index[idx], session_sched)
                    adr_val = adr_series.get(dt)
                    if adr_val is not None and not np.isnan(adr_val) and adr_val != prev_date_adr:
                        bs = round(adr_val * job.brick_pct / 100, 6)
                        rs = round(adr_val * job.reversal_pct / 100, 6)
                        size_schedule.append((idx, bs, rs, round(adr_val, 6)))
                        prev_date_adr = adr_val

                if not size_schedule:
                    results.append({"instrument": job.instrument, "filename": job.filename,
                                    "status": "error",
                                    "error": f"Insufficient history for ADR({job.adr_period})"})
                    continue

                brick_size = size_schedule[0][1]
                reversal_size = size_schedule[0][2]
            else:
                brick_size = job.brick_size
                reversal_size = job.reversal_size

            # Validate brick size
            if brick_size is None or np.isnan(brick_size) or brick_size <= 0:
                results.append({"instrument": job.instrument, "filename": job.filename,
                                "status": "error", "error": f"Invalid brick size: {brick_size}"})
                continue

            price_range = df['close'].max() - df['close'].min()
            estimated_bricks = price_range / brick_size
            if estimated_bricks > 100000:
                results.append({"instrument": job.instrument, "filename": job.filename,
                                "status": "error",
                                "error": f"Brick size too small ({brick_size:.6f}). Would create ~{int(estimated_bricks)} bricks."})
                continue

            # Generate renko
            brick_size = float(brick_size)
            reversal_size = float(reversal_size)
            reversal_mult = reversal_size / brick_size

            renko_df, _ = generate_renko_custom(
                df, brick_size, reversal_mult, job.wick_mode, size_schedule=size_schedule
            )

            if renko_df.empty:
                results.append({"instrument": job.instrument, "filename": job.filename,
                                "status": "error", "error": "No Renko bricks generated"})
                continue

            # Build stats DataFrame from renko
            renko_df = renko_df.reset_index()
            stats_df = pd.DataFrame({
                'datetime': renko_df['datetime'] if 'datetime' in renko_df.columns else renko_df.index,
                'open': renko_df['open'],
                'high': renko_df['high'],
                'low': renko_df['low'],
                'close': renko_df['close'],
            })
            for col in ['open', 'high', 'low', 'close']:
                stats_df[col] = stats_df[col].round(5)

            # Add settings columns
            stats_df['adr_period'] = job.adr_period
            if 'brick_size' in renko_df.columns:
                stats_df['brick_size'] = renko_df['brick_size'].values
                stats_df['reversal_size'] = renko_df['reversal_size'].values
            else:
                stats_df['brick_size'] = brick_size
                stats_df['reversal_size'] = reversal_size
            stats_df['wick_mode'] = job.wick_mode
            stats_df['ma1_period'] = job.ma1_period
            stats_df['ma2_period'] = job.ma2_period
            stats_df['ma3_period'] = job.ma3_period
            stats_df['chopPeriod'] = job.chop_period
            stats_df['smae1_period'] = job.smae1_period
            stats_df['smae1_deviation'] = job.smae1_deviation
            stats_df['smae2_period'] = job.smae2_period
            stats_df['smae2_deviation'] = job.smae2_deviation
            stats_df['pwap_sigmas'] = json.dumps(job.pwap_sigmas)

            # Compute stats columns
            stats_df = compute_stats_columns(
                stats_df, raw_df, session_sched,
                job.adr_period, job.ma1_period, job.ma2_period,
                job.ma3_period, job.chop_period,
                job.smae1_period, job.smae1_deviation,
                job.smae2_period, job.smae2_deviation,
                job.pwap_sigmas
            )

            # Save parquet with session_schedule and indicator params in metadata
            fname = job.filename.replace('.parquet', '')
            output_path = stats_dir / f"{fname}.parquet"
            table = pa.Table.from_pandas(stats_df, preserve_index=False)
            existing_meta = table.schema.metadata or {}
            extra_meta = {
                b'session_schedule': json.dumps(session_sched).encode('utf-8'),
                b'smae_params': json.dumps({
                    'smae1': {'period': job.smae1_period, 'deviation': job.smae1_deviation},
                    'smae2': {'period': job.smae2_period, 'deviation': job.smae2_deviation},
                }).encode('utf-8'),
                b'pwap_sigmas': json.dumps(job.pwap_sigmas).encode('utf-8'),
            }
            table = table.replace_schema_metadata({**existing_meta, **extra_meta})
            pq.write_table(table, output_path)

            results.append({
                "instrument": job.instrument,
                "filename": fname,
                "status": "success",
                "rows": len(stats_df),
                "filepath": str(output_path)
            })

        except Exception as e:
            results.append({
                "instrument": job.instrument,
                "filename": job.filename,
                "status": "error",
                "error": str(e)
            })

    return {"results": results}


@app.get("/parquet-data")
def get_parquet_data(filepath: str):
    """Return raw parquet data as JSON (columns + rows)."""
    parquet_path = Path(filepath)

    if not parquet_path.exists():
        raise HTTPException(status_code=404, detail=f"Parquet file not found: {filepath}")

    try:
        df = pd.read_parquet(parquet_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read parquet: {str(e)}")

    if len(df) == 0:
        raise HTTPException(status_code=400, detail="Parquet file contains no data")

    # Convert datetime columns to strings for JSON serialization
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            df[col] = df[col].astype(str)

    columns = df.columns.tolist()
    rows = df.values.tolist()

    result = {"columns": columns, "rows": rows, "totalRows": len(rows)}
    from starlette.responses import Response
    json_str = json.dumps(result, allow_nan=True, default=str)
    json_str = re.sub(r'\bNaN\b', 'null', json_str)
    json_str = re.sub(r'\b-?Infinity\b', 'null', json_str)
    return Response(content=json_str, media_type="application/json")


@app.get("/export-csv")
def export_csv(filepath: str, working_dir: str):
    """Export a parquet file as CSV into an 'exports' folder in the user's working directory."""
    parquet_path = Path(filepath)
    if not parquet_path.exists():
        raise HTTPException(status_code=404, detail=f"Parquet file not found: {filepath}")

    try:
        df = pd.read_parquet(parquet_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read parquet: {str(e)}")

    exports_dir = Path(working_dir) / "exports"
    exports_dir.mkdir(exist_ok=True)
    csv_path = exports_dir / (parquet_path.stem + ".csv")
    df.to_csv(csv_path, index=False, float_format='%.5f')

    return {"message": f"Exported {csv_path.name}", "path": str(csv_path)}


@app.get("/parquet-stats")
def get_parquet_stats(filepath: str):
    """
    Calculate MA statistics from a parquet file.

    Returns counts and percentages of bars above/below each MA,
    and bars above/below ALL MAs.
    Also returns per-bar column arrays (barData) for client-side chop filtering.
    """
    parquet_path = Path(filepath)

    if not parquet_path.exists():
        raise HTTPException(status_code=404, detail=f"Parquet file not found: {filepath}")

    try:
        pf = pq.read_table(parquet_path)
        df = pf.to_pandas()
        # Extract session_schedule from parquet metadata if present
        parquet_meta = pf.schema.metadata or {}
        session_schedule = None
        if b'session_schedule' in parquet_meta:
            try:
                session_schedule = json.loads(parquet_meta[b'session_schedule'].decode('utf-8'))
            except Exception:
                pass
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read parquet: {str(e)}")

    total_bars = len(df)
    if total_bars == 0:
        raise HTTPException(status_code=400, detail="Parquet file contains no data")

    # Get MA periods from the dataframe
    ma1_period = int(df['ma1_period'].iloc[0]) if 'ma1_period' in df.columns else 20
    ma2_period = int(df['ma2_period'].iloc[0]) if 'ma2_period' in df.columns else 50
    ma3_period = int(df['ma3_period'].iloc[0]) if 'ma3_period' in df.columns else 200

    ma_periods = [ma1_period, ma2_period, ma3_period]

    # Calculate stats for each MA using EMA_rawDistance columns
    # Positive distance = above MA, Negative distance = below MA
    ma_stats = []
    above_all_mask = pd.Series([True] * total_bars, index=df.index)
    below_all_mask = pd.Series([True] * total_bars, index=df.index)

    # Determine bar direction: UP (close > open), DOWN (close < open)
    is_up_bar = df['close'] > df['open']
    is_down_bar = df['close'] < df['open']

    # Calculate Global Chop Index
    # A reversal is when current bar direction differs from prior bar
    # Chop Index = Reversal Bars / (Total Bars - 1)
    chop_stats = {"reversalBars": 0, "chopIndex": 0.0}
    if total_bars > 1:
        # Compare each bar's direction to the previous bar
        # Direction: 1 = up, -1 = down, 0 = doji (treat as continuation)
        direction = is_up_bar.astype(int) - is_down_bar.astype(int)
        # A reversal occurs when direction changes (ignoring dojis)
        prev_direction = direction.shift(1)
        # Only count as reversal when both bars have clear direction and they differ
        reversals = (direction != 0) & (prev_direction != 0) & (direction != prev_direction)
        reversal_count = int(reversals.sum())
        chop_stats["reversalBars"] = reversal_count
        chop_stats["chopIndex"] = round(reversal_count / total_bars * 100, 1)

    # Calculate State Distribution
    state_stats = []
    if 'State' in df.columns:
        # States from +3 to -3 (excluding 0)
        for state in [3, 2, 1, -1, -2, -3]:
            state_mask = df['State'] == state
            count = int(state_mask.sum())
            up_count = int((state_mask & is_up_bar).sum())
            dn_count = int((state_mask & is_down_bar).sum())
            state_stats.append({
                "state": state,
                "count": count,
                "pct": round(count / total_bars * 100, 1) if total_bars > 0 else 0,
                "upCount": up_count,
                "upPct": round(up_count / count * 100, 0) if count > 0 else 0,
                "dnCount": dn_count,
                "dnPct": round(dn_count / count * 100, 0) if count > 0 else 0
            })

    # Calculate State x Consecutive Bars Heatmap (Module 5)
    state_conbars_heatmap = None
    if 'State' in df.columns and 'REAL_clr_RR' in df.columns:
        # Use Con_UP_bars for positive states, Con_DN_bars for negative states
        # This gives the "with-trend" consecutive bar count for each state
        heatmap_rows = []
        max_conbars = 10
        states = [3, 2, 1, -1, -2, -3]
        for con in range(1, max_conbars + 1):
            row = {"conBars": con}
            for state in states:
                state_mask = df['State'] == state
                if state > 0:
                    con_mask = df['Con_UP_bars'] == con
                else:
                    con_mask = df['Con_DN_bars'] == con
                cell_mask = state_mask & con_mask
                count = int(cell_mask.sum())
                mean_val = df.loc[cell_mask, 'REAL_clr_RR'].mean()
                avg_rr = round(float(mean_val), 2) if pd.notna(mean_val) else None
                row[f"s{state}_count"] = count
                row[f"s{state}_avgRR"] = avg_rr
            heatmap_rows.append(row)
        state_conbars_heatmap = heatmap_rows

    # Calculate State Transition Matrix (Module 6)
    state_transition_matrix = None
    if 'State' in df.columns and 'prState' in df.columns:
        states = [3, 2, 1, -1, -2, -3]
        matrix = []
        for from_state in states:
            from_mask = df['prState'] == from_state
            from_total = int(from_mask.sum())
            row = {"fromState": from_state, "total": from_total}
            for to_state in states:
                to_mask = df['State'] == to_state
                count = int((from_mask & to_mask).sum())
                pct = round(count / from_total * 100, 1) if from_total > 0 else 0
                row[f"to_{to_state}_count"] = count
                row[f"to_{to_state}_pct"] = pct
            matrix.append(row)
        state_transition_matrix = matrix

    # Calculate Chop Regime Stats (Module 3)
    chop_regime_stats = None
    if 'chop(rolling)' in df.columns:
        chop_col = df['chop(rolling)']
        chop_regimes = [
            {"key": "low", "label": "Low (<0.2)", "mask": chop_col < 0.2},
            {"key": "mid", "label": "Mid (0.2-0.4)", "mask": (chop_col >= 0.2) & (chop_col <= 0.4)},
            {"key": "high", "label": "High (>0.4)", "mask": chop_col > 0.4},
        ]
        # Table 1: Overview (all bars)
        overview = []
        for regime in chop_regimes:
            rmask = regime["mask"]
            rcount = int(rmask.sum())
            up_c = int((rmask & is_up_bar).sum())
            dn_c = int((rmask & is_down_bar).sum())
            overview.append({
                "label": regime["label"],
                "key": regime["key"],
                "count": rcount,
                "upPct": round(up_c / rcount * 100, 0) if rcount > 0 else 0,
                "dnPct": round(dn_c / rcount * 100, 0) if rcount > 0 else 0,
            })
        # Table 2: State distribution by chop regime
        state_by_chop = []
        if 'State' in df.columns:
            for state in [3, 2, 1, -1, -2, -3]:
                state_mask = df['State'] == state
                row = {"state": state}
                for regime in chop_regimes:
                    rmask = regime["mask"]
                    regime_total = int(rmask.sum())
                    in_state = int((rmask & state_mask).sum())
                    row[regime["key"]] = round(in_state / regime_total * 100, 1) if regime_total > 0 else 0
                state_by_chop.append(row)
        chop_regime_stats = {
            "overview": overview,
            "stateByChop": state_by_chop,
        }

    for period in ma_periods:
        col_name = f'EMA_rawDistance({period})'
        if col_name in df.columns:
            above_mask = df[col_name] > 0
            below_mask = df[col_name] < 0

            above_count = int(above_mask.sum())
            below_count = int(below_mask.sum())

            # UP/DOWN breakdown for bars above MA
            above_up = int((above_mask & is_up_bar).sum())
            above_down = int((above_mask & is_down_bar).sum())

            # UP/DOWN breakdown for bars below MA
            below_up = int((below_mask & is_up_bar).sum())
            below_down = int((below_mask & is_down_bar).sum())

            # Update masks for "all MAs" calculation
            above_all_mask &= above_mask
            below_all_mask &= below_mask
        else:
            # Column not found, default to 0
            above_count = 0
            below_count = 0
            above_up = 0
            above_down = 0
            below_up = 0
            below_down = 0

        ma_stats.append({
            "period": period,
            "above": above_count,
            "below": below_count,
            "aboveUp": above_up,
            "aboveDown": above_down,
            "belowUp": below_up,
            "belowDown": below_down
        })

    # Calculate bars above/below ALL MAs
    above_all = int(above_all_mask.sum())
    below_all = int(below_all_mask.sum())

    # UP/DOWN breakdown for bars above/below ALL MAs
    above_all_up = int((above_all_mask & is_up_bar).sum())
    above_all_down = int((above_all_mask & is_down_bar).sum())
    below_all_up = int((below_all_mask & is_up_bar).sum())
    below_all_down = int((below_all_mask & is_down_bar).sum())

    # Calculate "beyond" bar location stats (bar fully above/below MA - both open and close)
    beyond_ma_stats = []
    beyond_above_all_mask = pd.Series([True] * total_bars, index=df.index)
    beyond_below_all_mask = pd.Series([True] * total_bars, index=df.index)

    for period in ma_periods:
        col_name = f'EMA_rawDistance({period})'
        if col_name in df.columns:
            # Derive EMA from close - rawDistance
            ema = df['close'] - df[col_name]
            beyond_above_mask = df['low'] > ema
            beyond_below_mask = df['high'] < ema

            beyond_above_count = int(beyond_above_mask.sum())
            beyond_below_count = int(beyond_below_mask.sum())

            beyond_above_up = int((beyond_above_mask & is_up_bar).sum())
            beyond_above_down = int((beyond_above_mask & is_down_bar).sum())
            beyond_below_up = int((beyond_below_mask & is_up_bar).sum())
            beyond_below_down = int((beyond_below_mask & is_down_bar).sum())

            beyond_above_all_mask &= beyond_above_mask
            beyond_below_all_mask &= beyond_below_mask
        else:
            beyond_above_count = 0
            beyond_below_count = 0
            beyond_above_up = 0
            beyond_above_down = 0
            beyond_below_up = 0
            beyond_below_down = 0

        beyond_ma_stats.append({
            "period": period,
            "above": beyond_above_count,
            "below": beyond_below_count,
            "aboveUp": beyond_above_up,
            "aboveDown": beyond_above_down,
            "belowUp": beyond_below_up,
            "belowDown": beyond_below_down
        })

    # Calculate beyond bars above/below ALL MAs
    beyond_above_all = int(beyond_above_all_mask.sum())
    beyond_below_all = int(beyond_below_all_mask.sum())
    beyond_above_all_up = int((beyond_above_all_mask & is_up_bar).sum())
    beyond_above_all_down = int((beyond_above_all_mask & is_down_bar).sum())
    beyond_below_all_up = int((beyond_below_all_mask & is_up_bar).sum())
    beyond_below_all_down = int((beyond_below_all_mask & is_down_bar).sum())

    # Calculate run distribution (consecutive bar runs)
    run_stats = {"upRuns": [], "dnRuns": [], "upDecay": [], "dnDecay": []}

    if 'Con_UP_bars' in df.columns and 'Con_DN_bars' in df.columns:
        up_runs = []
        dn_runs = []

        # Extract completed runs by detecting when counter goes from N > 0 to 0
        for i in range(1, len(df)):
            prev_up = df['Con_UP_bars'].iloc[i - 1]
            curr_up = df['Con_UP_bars'].iloc[i]
            prev_dn = df['Con_DN_bars'].iloc[i - 1]
            curr_dn = df['Con_DN_bars'].iloc[i]

            # UP run ended
            if prev_up > 0 and curr_up == 0:
                up_runs.append(int(prev_up))
            # DN run ended
            if prev_dn > 0 and curr_dn == 0:
                dn_runs.append(int(prev_dn))

        # Capture final run if data ends mid-run
        last_up = df['Con_UP_bars'].iloc[-1]
        last_dn = df['Con_DN_bars'].iloc[-1]
        if last_up > 0:
            up_runs.append(int(last_up))
        if last_dn > 0:
            dn_runs.append(int(last_dn))

        run_stats["upRuns"] = up_runs
        run_stats["dnRuns"] = dn_runs

        # Calculate decay thresholds (unified so UP and DN rows always align)
        thresholds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 50, 100, 200, 500]
        max_either = max(max(up_runs) if up_runs else 0, max(dn_runs) if dn_runs else 0)
        active_thresholds = [t for t in thresholds if t <= max_either]

        up_total = len(up_runs)
        dn_total = len(dn_runs)
        run_stats["upDecay"] = [
            {
                "threshold": t,
                "count": sum(1 for r in up_runs if r >= t),
                "pct": round(sum(1 for r in up_runs if r >= t) / up_total * 100, 1) if up_total > 0 else 0
            }
            for t in active_thresholds
        ]
        run_stats["dnDecay"] = [
            {
                "threshold": t,
                "count": sum(1 for r in dn_runs if r >= t),
                "pct": round(sum(1 for r in dn_runs if r >= t) / dn_total * 100, 1) if dn_total > 0 else 0
            }
            for t in active_thresholds
        ]

        # Calculate auto-binned distribution (unified bins for UP and DN)
        from collections import Counter
        up_counts = Counter(up_runs) if up_runs else Counter()
        dn_counts = Counter(dn_runs) if dn_runs else Counter()
        max_run = max(max(up_runs) if up_runs else 0, max(dn_runs) if dn_runs else 0)

        bins = []
        for i in range(1, min(11, max_run + 1)):
            bins.append((i, i, str(i)))
        ranges = [(11, 20), (21, 50), (51, 100), (101, 200), (201, 500), (501, 1000)]
        for start, end in ranges:
            if start <= max_run:
                actual_end = min(end, max_run)
                label = str(start) if start == actual_end else f"{start}-{actual_end}"
                bins.append((start, actual_end, label))

        def build_dist(counts_map, total):
            dist = []
            for start, end, label in bins:
                count = sum(counts_map.get(i, 0) for i in range(start, end + 1))
                dist.append({
                    "label": label,
                    "count": count,
                    "pct": round(count / total * 100, 1) if total > 0 else 0
                })
            return dist

        run_stats["upDist"] = build_dist(up_counts, len(up_runs))
        run_stats["dnDist"] = build_dist(dn_counts, len(dn_runs))

    # Calculate total UP and DN bars
    up_bars = int(is_up_bar.sum())
    dn_bars = int(is_down_bar.sum())

    # Calculate Type1 MFE stats (FX_clr_Bars decay for Type1 signals)
    type1_mfe_stats = {
        "upDecay": [], "dnDecay": [], "upTotal": 0, "dnTotal": 0,
        "upAdrDist": [], "dnAdrDist": [], "upRrDist": [], "dnRrDist": [],
        "upMa1RrDist": [], "dnMa1RrDist": [],
        "upMa2RrDist": [], "dnMa2RrDist": [],
        "upMa3RrDist": [], "dnMa3RrDist": []
    }
    if 'Type1' in df.columns and 'MFE_clr_Bars' in df.columns:
        # UP Type1: Type1 > 0 (UP bars in State +3 transitions)
        up_type1_mask = df['Type1'] > 0
        # DN Type1: Type1 < 0 (DN bars in State -3 transitions)
        dn_type1_mask = df['Type1'] < 0

        up_type1_mfe = df.loc[up_type1_mask, 'MFE_clr_Bars'].tolist()
        dn_type1_mfe = df.loc[dn_type1_mask, 'MFE_clr_Bars'].tolist()

        type1_mfe_stats["upTotal"] = len(up_type1_mfe)
        type1_mfe_stats["dnTotal"] = len(dn_type1_mfe)

        # Decay thresholds (same as Run Decay)
        thresholds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 20, 50, 100, 200, 500]

        if up_type1_mfe:
            type1_mfe_stats["upDecay"] = [
                {
                    "threshold": t,
                    "count": sum(1 for v in up_type1_mfe if v >= t),
                    "pct": round(sum(1 for v in up_type1_mfe if v >= t) / len(up_type1_mfe) * 100, 1)
                }
                for t in thresholds if sum(1 for v in up_type1_mfe if v >= t) > 0
            ]

        if dn_type1_mfe:
            type1_mfe_stats["dnDecay"] = [
                {
                    "threshold": t,
                    "count": sum(1 for v in dn_type1_mfe if v >= t),
                    "pct": round(sum(1 for v in dn_type1_mfe if v >= t) / len(dn_type1_mfe) * 100, 1)
                }
                for t in thresholds if sum(1 for v in dn_type1_mfe if v >= t) > 0
            ]

        # Auto-binned distribution for decimal values (ADR/RR)
        # use_abs=True for DN values to display as positive
        def calc_decimal_dist(values, use_abs=False):
            if not values:
                return []
            values = [v for v in values if not np.isnan(v)]
            if not values:
                return []
            if use_abs:
                values = [abs(v) for v in values]

            total = len(values)
            # Define bins for normalized values (positive only since DN uses abs)
            # First bin is exactly 0, then ranges use [low, high) means low <= v < high
            bin_edges = [
                (0, 0.5, '>0 to <0.5'),
                (0.5, 1, '0.5 to <1'),
                (1, 1.5, '1 to <1.5'),
                (1.5, 2, '1.5 to <2'),
                (2, 3, '2 to <3'),
                (3, 5, '3 to <5'),
                (5, float('inf'), '5+'),
            ]

            distribution = []
            # Special row for exactly 0
            zero_count = sum(1 for v in values if v == 0)
            distribution.append({
                "label": "0",
                "count": zero_count,
                "pct": round(zero_count / total * 100, 1)
            })
            # Show all bins even if count is 0
            for i, (low, high, label) in enumerate(bin_edges):
                # First bin excludes lower bound (>0), rest include lower bound
                if i == 0:
                    count = sum(1 for v in values if low < v < high)
                else:
                    count = sum(1 for v in values if low <= v < high)
                distribution.append({
                    "label": label,
                    "count": count,
                    "pct": round(count / total * 100, 1)
                })
            return distribution

        # Get ADR and RR values for Type1 signals
        if 'MFE_clr_ADR' in df.columns:
            up_adr = df.loc[up_type1_mask, 'MFE_clr_ADR'].tolist()
            dn_adr = df.loc[dn_type1_mask, 'MFE_clr_ADR'].tolist()
            type1_mfe_stats["upAdrDist"] = calc_decimal_dist(up_adr)
            type1_mfe_stats["dnAdrDist"] = calc_decimal_dist(dn_adr, use_abs=True)

        if 'MFE_clr_RR' in df.columns:
            up_rr = df.loc[up_type1_mask, 'MFE_clr_RR'].tolist()
            dn_rr = df.loc[dn_type1_mask, 'MFE_clr_RR'].tolist()
            type1_mfe_stats["upRrDist"] = calc_decimal_dist(up_rr)
            type1_mfe_stats["dnRrDist"] = calc_decimal_dist(dn_rr, use_abs=True)

        # MA RR distributions
        if 'REAL_MA1_RR' in df.columns:
            up_ma1_rr = df.loc[up_type1_mask, 'REAL_MA1_RR'].tolist()
            dn_ma1_rr = df.loc[dn_type1_mask, 'REAL_MA1_RR'].tolist()
            type1_mfe_stats["upMa1RrDist"] = calc_decimal_dist(up_ma1_rr)
            type1_mfe_stats["dnMa1RrDist"] = calc_decimal_dist(dn_ma1_rr, use_abs=True)

        if 'REAL_MA2_RR' in df.columns:
            up_ma2_rr = df.loc[up_type1_mask, 'REAL_MA2_RR'].tolist()
            dn_ma2_rr = df.loc[dn_type1_mask, 'REAL_MA2_RR'].tolist()
            type1_mfe_stats["upMa2RrDist"] = calc_decimal_dist(up_ma2_rr)
            type1_mfe_stats["dnMa2RrDist"] = calc_decimal_dist(dn_ma2_rr, use_abs=True)

        if 'REAL_MA3_RR' in df.columns:
            up_ma3_rr = df.loc[up_type1_mask, 'REAL_MA3_RR'].tolist()
            dn_ma3_rr = df.loc[dn_type1_mask, 'REAL_MA3_RR'].tolist()
            type1_mfe_stats["upMa3RrDist"] = calc_decimal_dist(up_ma3_rr)
            type1_mfe_stats["dnMa3RrDist"] = calc_decimal_dist(dn_ma3_rr, use_abs=True)

    # Wick Distribution (DD_RR split by bar direction)
    wick_dist = {"upDist": [], "dnDist": []}
    if 'DD_RR' in df.columns:
        up_wick = df.loc[is_up_bar, 'DD_RR'].dropna().tolist()
        dn_wick = df.loc[is_down_bar, 'DD_RR'].dropna().tolist()

        def calc_wick_dist(values):
            if not values:
                return []
            values = [v for v in values if not np.isnan(v)]
            if not values:
                return []
            total = len(values)
            bin_edges = [
                (0, 0.5, '>0 to <0.5'),
                (0.5, 1, '0.5 to <1'),
                (1, 1.5, '1 to <1.5'),
                (1.5, 2, '1.5 to <2'),
                (2, 3, '2 to <3'),
                (3, 5, '3 to <5'),
                (5, float('inf'), '5+'),
            ]
            distribution = []
            zero_count = sum(1 for v in values if v == 0)
            distribution.append({"label": "0", "count": zero_count, "pct": round(zero_count / total * 100, 1)})
            for i, (low, high, label) in enumerate(bin_edges):
                if i == 0:
                    count = sum(1 for v in values if low < v < high)
                else:
                    count = sum(1 for v in values if low <= v < high)
                distribution.append({"label": label, "count": count, "pct": round(count / total * 100, 1)})
            return distribution

        wick_dist["upDist"] = calc_wick_dist(up_wick)
        wick_dist["dnDist"] = calc_wick_dist(dn_wick)

    # EMA RR Distance decay tables
    ema_rr_decay = []
    rr_thresholds = [0.5, 1, 1.5, 2, 3, 5, 10, 20, 50]
    for period in ma_periods:
        col_name = f'EMA_rrDistance({period})'
        if col_name in df.columns:
            values = df[col_name].dropna()
            pos_values = values[values > 0]
            neg_values = values[values < 0].abs()
            up_total = len(pos_values)
            dn_total = len(neg_values)
            up_decay = []
            for t in rr_thresholds:
                cnt = int((pos_values >= t).sum())
                up_decay.append({"threshold": t, "count": cnt, "pct": round(cnt / up_total * 100) if up_total > 0 else 0})
            dn_decay = []
            for t in rr_thresholds:
                cnt = int((neg_values >= t).sum())
                dn_decay.append({"threshold": t, "count": cnt, "pct": round(cnt / dn_total * 100) if dn_total > 0 else 0})
            ema_rr_decay.append({
                "period": period,
                "upDecay": up_decay,
                "dnDecay": dn_decay,
                "upTotal": up_total,
                "dnTotal": dn_total
            })

    # Raw signal data for client-side filtering and cumulation
    signal_data = {}
    # Determine which extra metric columns are available
    extra_metric_cols = []
    for col_name, field_name in [
        ('MFE_clr_ADR', 'clr_adr'),
        ('REAL_clr_ADR', 'clr_adr_adj'),
        ('REAL_clr_RR', 'rr_adj'),
        ('REAL_MA1_RR', 'ma1_rr'),
        ('REAL_MA1_ADR', 'ma1_adr'),
        ('REAL_MA2_RR', 'ma2_rr'),
        ('REAL_MA2_ADR', 'ma2_adr'),
        ('REAL_MA3_RR', 'ma3_rr'),
        ('REAL_MA3_ADR', 'ma3_adr'),
    ]:
        if col_name in df.columns:
            extra_metric_cols.append((col_name, field_name))

    # EMA distance per MA (RR + ADR normalizations)
    for idx_i, period in enumerate(ma_periods, start=1):
        for col_sfx, fld_sfx in [('rrDistance', 'rr'), ('adrDistance', 'adr')]:
            col = f'EMA_{col_sfx}({period})'
            fld = f'ema{idx_i}Dist_{fld_sfx}'
            if col in df.columns:
                extra_metric_cols.append((col, fld))
    # DD (wick size) in RR and ADR
    for col, fld in [('DD_RR', 'dd_rr'), ('DD_ADR', 'dd_adr')]:
        if col in df.columns:
            extra_metric_cols.append((col, fld))
    # Integer signal context fields
    for col, fld in [('priorRunCount', 'prRunCnt'), ('Con_UP_bars', 'conUpBars'), ('Con_DN_bars', 'conDnBars'), ('stateDuration', 'stateDur'), ('barDuration', 'barDur')]:
        if col in df.columns:
            extra_metric_cols.append((col, fld))

    if 'MFE_clr_RR' in df.columns:
        # Columns to pull from the subset
        needed_cols_base = ['MFE_clr_RR'] + [c for c, _ in extra_metric_cols] + (['chop(rolling)'] if 'chop(rolling)' in df.columns else [])
        for key, col, cond in [
            ('type1Up', 'Type1', 'pos'),
            ('type1Dn', 'Type1', 'neg'),
            ('type2Up', 'Type2', 'pos'),
            ('type2Dn', 'Type2', 'neg'),
        ]:
            if col in df.columns:
                mask = df[col] > 0 if cond == 'pos' else df[col] < 0
                needed_cols = [col] + [c for c in needed_cols_base if c in df.columns]
                subset = df.loc[mask, needed_cols].dropna(subset=['MFE_clr_RR'])
                n_vals = subset[col].abs().astype(int).values
                rr_vals = subset['MFE_clr_RR'].round(2).values
                idx_vals = subset.index.values
                points = []
                for i in range(len(n_vals)):
                    pt = {"n": int(n_vals[i]), "rr": float(rr_vals[i]), "idx": int(idx_vals[i])}
                    for col_name, field_name in extra_metric_cols:
                        val = subset[col_name].iloc[i]
                        pt[field_name] = round(float(val), 2) if pd.notna(val) else None
                    if 'chop(rolling)' in subset.columns:
                        chop_val = subset['chop(rolling)'].iloc[i]
                        pt["chop"] = round(float(chop_val), 2) if pd.notna(chop_val) else None
                    points.append(pt)
                signal_data[key] = points

    # Extract settings stored in parquet columns
    settings = {}
    for col, key in [
        ('adr_period', 'adrPeriod'),
        ('brick_size', 'brickSize'),
        ('reversal_size', 'reversalSize'),
        ('wick_mode', 'wickMode'),
        ('ma1_period', 'ma1Period'),
        ('ma2_period', 'ma2Period'),
        ('ma3_period', 'ma3Period'),
        ('chopPeriod', 'chopPeriod'),
        ('smae1_period', 'smae1Period'),
        ('smae1_deviation', 'smae1Deviation'),
        ('smae2_period', 'smae2Period'),
        ('smae2_deviation', 'smae2Deviation'),
    ]:
        if col in df.columns:
            val = df[col].iloc[0]
            settings[key] = val.item() if hasattr(val, 'item') else val

    if 'pwap_sigmas' in df.columns:
        try:
            settings['pwapSigmas'] = json.loads(df['pwap_sigmas'].iloc[0])
        except Exception:
            settings['pwapSigmas'] = [1.0, 2.0, 2.5, 3.0]

    # Build per-bar column arrays for client-side chop filtering (Module 7)
    bar_data_cols = {
        'open': 'open', 'close': 'close', 'high': 'high', 'low': 'low',
        'State': 'state', 'prState': 'prState', 'fromState': 'fromState',
        'Con_UP_bars': 'conUp', 'Con_DN_bars': 'conDn',
        'MFE_clr_RR': 'mfeClrRR', 'DD_RR': 'ddRR',
        'chop(rolling)': 'chop',
        'REAL_clr_RR': 'realClrRR', 'REAL_clr_ADR': 'realClrADR',
        'MFE_clr_ADR': 'mfeClrADR',
        'REAL_MA1_RR': 'realMA1RR', 'REAL_MA1_ADR': 'realMA1ADR',
        'REAL_MA2_RR': 'realMA2RR', 'REAL_MA2_ADR': 'realMA2ADR',
        'REAL_MA3_RR': 'realMA3RR', 'REAL_MA3_ADR': 'realMA3ADR',
        'datetime': 'datetime',
        'brick_size': 'brickSizeArr', 'reversal_size': 'reversalSizeArr',
        'Type1': 'type1', 'Type2': 'type2',
    }
    bar_data = {}
    for src_col, dest_key in bar_data_cols.items():
        if src_col in df.columns:
            # Convert datetime columns to strings before serialization
            if pd.api.types.is_datetime64_any_dtype(df[src_col]):
                bar_data[dest_key] = df[src_col].dt.strftime('%Y-%m-%d %H:%M:%S').tolist()
            else:
                arr = df[src_col].tolist()
                # Convert NaN to None for JSON serialization
                bar_data[dest_key] = [None if (isinstance(v, float) and np.isnan(v)) else v for v in arr]

    # Add dynamic EMA columns based on detected MA periods
    for period in ma_periods:
        raw_col = f'EMA_rawDistance({period})'
        rr_col = f'EMA_rrDistance({period})'
        if raw_col in df.columns:
            arr = df[raw_col].tolist()
            bar_data[f'emaRaw{period}'] = [None if (isinstance(v, float) and np.isnan(v)) else v for v in arr]
        if rr_col in df.columns:
            arr = df[rr_col].tolist()
            bar_data[f'emaRr{period}'] = [None if (isinstance(v, float) and np.isnan(v)) else v for v in arr]

    # Add chart overlay columns (EMAs, SMAE, PWAP) from parquet
    overlay_cols = {
        'EMA1_Price': 'ema1Price', 'EMA2_Price': 'ema2Price', 'EMA3_Price': 'ema3Price',
        'SMAE1_Center': 'smae1Center', 'SMAE1_Upper': 'smae1Upper', 'SMAE1_Lower': 'smae1Lower',
        'SMAE2_Center': 'smae2Center', 'SMAE2_Upper': 'smae2Upper', 'SMAE2_Lower': 'smae2Lower',
        'PWAP_Mean': 'pwapMean',
        'PWAP_Upper1': 'pwapUpper1', 'PWAP_Upper2': 'pwapUpper2',
        'PWAP_Upper3': 'pwapUpper3', 'PWAP_Upper4': 'pwapUpper4',
        'PWAP_Lower1': 'pwapLower1', 'PWAP_Lower2': 'pwapLower2',
        'PWAP_Lower3': 'pwapLower3', 'PWAP_Lower4': 'pwapLower4',
    }
    for src_col, dest_key in overlay_cols.items():
        if src_col in df.columns:
            arr = df[src_col].tolist()
            bar_data[dest_key] = [None if (isinstance(v, float) and np.isnan(v)) else v for v in arr]

    # Compute session break indices from session_date column
    session_breaks = []
    if 'session_date' in df.columns:
        sd = df['session_date']
        for i in range(1, len(sd)):
            if sd.iloc[i] != sd.iloc[i - 1]:
                session_breaks.append(i)

    result = {
        "totalBars": total_bars,
        "upBars": up_bars,
        "dnBars": dn_bars,
        "maStats": ma_stats,
        "allMaStats": {
            "aboveAll": above_all,
            "belowAll": below_all,
            "aboveAllUp": above_all_up,
            "aboveAllDown": above_all_down,
            "belowAllUp": below_all_up,
            "belowAllDown": below_all_down
        },
        "runStats": run_stats,
        "chopStats": chop_stats,
        "stateStats": state_stats,
        "settings": settings,
        "type1MfeStats": type1_mfe_stats,
        "beyondMaStats": beyond_ma_stats,
        "beyondAllMaStats": {
            "aboveAll": beyond_above_all,
            "belowAll": beyond_below_all,
            "aboveAllUp": beyond_above_all_up,
            "aboveAllDown": beyond_above_all_down,
            "belowAllUp": beyond_below_all_up,
            "belowAllDown": beyond_below_all_down
        },
        "emaRrDecay": ema_rr_decay,
        "wickDist": wick_dist,
        "signalData": signal_data,
        "chopRegimeStats": chop_regime_stats,
        "stateConbarsHeatmap": state_conbars_heatmap,
        "stateTransitionMatrix": state_transition_matrix,
        "barData": bar_data,
        "maPeriods": ma_periods,
        "sessionSchedule": session_schedule,
        "sessionBreaks": session_breaks
    }

    # Serialize with allow_nan=True, then replace NaN/Infinity with null
    from starlette.responses import Response
    json_str = json.dumps(result, allow_nan=True, default=str)
    json_str = re.sub(r'\bNaN\b', 'null', json_str)
    json_str = re.sub(r'\b-?Infinity\b', 'null', json_str)
    return Response(content=json_str, media_type="application/json")


@app.post("/playground-signals")
def playground_signals(request: PlaygroundRequest):
    """Evaluate arbitrary pandas expressions against a parquet file and return signal data."""
    parquet_path = Path(request.filepath)
    if not parquet_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {request.filepath}")

    try:
        df = pd.read_parquet(parquet_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read parquet: {str(e)}")

    # Add MA1/MA2/MA3 value columns from stored EMA prices and previous-bar OHLC columns for query expressions
    ma1_period = int(df['ma1_period'].iloc[0]) if 'ma1_period' in df.columns else 20
    ma2_period = int(df['ma2_period'].iloc[0]) if 'ma2_period' in df.columns else 50
    ma3_period = int(df['ma3_period'].iloc[0]) if 'ma3_period' in df.columns else 200

    df['MA1'] = df['EMA1_Price']
    df['MA2'] = df['EMA2_Price']
    df['MA3'] = df['EMA3_Price']

    for col in ['open', 'high', 'low', 'close', 'direction']:
        df[f'{col}1'] = df[col].shift(1)
        df[f'{col}2'] = df[col].shift(2)

    for ma in ['MA1', 'MA2', 'MA3']:
        df[f'{ma}_1'] = df[ma].shift(1)
        df[f'{ma}_2'] = df[ma].shift(2)

    # Build extra_metric_cols (same mapping as parquet-stats)
    ma_periods = [ma1_period, ma2_period, ma3_period]

    extra_metric_cols = []
    for col_name, field_name in [
        ('MFE_clr_ADR', 'clr_adr'),
        ('REAL_clr_ADR', 'clr_adr_adj'),
        ('REAL_clr_RR', 'rr_adj'),
        ('REAL_MA1_RR', 'ma1_rr'),
        ('REAL_MA1_ADR', 'ma1_adr'),
        ('REAL_MA2_RR', 'ma2_rr'),
        ('REAL_MA2_ADR', 'ma2_adr'),
        ('REAL_MA3_RR', 'ma3_rr'),
        ('REAL_MA3_ADR', 'ma3_adr'),
    ]:
        if col_name in df.columns:
            extra_metric_cols.append((col_name, field_name))

    for idx_i, period in enumerate(ma_periods, start=1):
        for col_sfx, fld_sfx in [('rrDistance', 'rr'), ('adrDistance', 'adr')]:
            col = f'EMA_{col_sfx}({period})'
            fld = f'ema{idx_i}Dist_{fld_sfx}'
            if col in df.columns:
                extra_metric_cols.append((col, fld))
    for col, fld in [('DD_RR', 'dd_rr'), ('DD_ADR', 'dd_adr')]:
        if col in df.columns:
            extra_metric_cols.append((col, fld))
    for col, fld in [('priorRunCount', 'prRunCnt'), ('Con_UP_bars', 'conUpBars'), ('Con_DN_bars', 'conDnBars'), ('stateDuration', 'stateDur'), ('barDuration', 'barDur')]:
        if col in df.columns:
            extra_metric_cols.append((col, fld))

    signals_result = {}
    errors_result = {}

    for signal in request.signals:
        if not signal.expression.strip():
            continue
        try:
            subset = df.query(signal.expression)
            if 'MFE_clr_RR' not in subset.columns:
                errors_result[signal.name] = "MFE_clr_RR column not found in parquet"
                continue
            subset = subset.dropna(subset=['MFE_clr_RR'])
            idx_vals = subset.index.values
            rr_vals = subset['MFE_clr_RR'].round(2).values
            points = []
            for i in range(len(idx_vals)):
                pt = {"n": 1, "rr": float(rr_vals[i]), "idx": int(idx_vals[i])}
                for col_name, field_name in extra_metric_cols:
                    if col_name in subset.columns:
                        val = subset[col_name].iloc[i]
                        pt[field_name] = round(float(val), 2) if pd.notna(val) else None
                points.append(pt)
            signals_result[signal.name] = points
        except Exception as e:
            errors_result[signal.name] = str(e)

    return {"signals": signals_result, "errors": errors_result}


class SaveSignalRequest(BaseModel):
    filepath: str
    name: str
    expression: str


def _signals_json_path(filepath: str) -> Path:
    """Derive Panda/signals.json path from a parquet filepath inside a Stats/ folder."""
    p = Path(filepath)
    # Walk up until we find a Stats directory, then go to its parent
    for parent in [p.parent] + list(p.parents):
        if parent.name == "Stats":
            return parent.parent / "Panda" / "signals.json"
    # Fallback: sibling of the file's directory
    return p.parent.parent / "Panda" / "signals.json"


def _read_signals(json_path: Path) -> list:
    if json_path.exists():
        try:
            return json.loads(json_path.read_text(encoding="utf-8"))
        except Exception:
            return []
    return []


def _write_signals(json_path: Path, signals: list):
    json_path.parent.mkdir(parents=True, exist_ok=True)
    json_path.write_text(json.dumps(signals, indent=2), encoding="utf-8")


@app.get("/playground-saved-signals")
def get_saved_signals(filepath: str):
    """Return saved playground signals from Playground/signals.json."""
    json_path = _signals_json_path(filepath)
    return {"signals": _read_signals(json_path)}


@app.post("/playground-save-signal")
def save_signal(request: SaveSignalRequest):
    """Save (or overwrite) a named signal to Playground/signals.json."""
    json_path = _signals_json_path(request.filepath)
    signals = _read_signals(json_path)
    # Overwrite existing by name, or append
    found = False
    for s in signals:
        if s["name"] == request.name:
            s["expression"] = request.expression
            found = True
            break
    if not found:
        signals.append({"name": request.name, "expression": request.expression})
    _write_signals(json_path, signals)
    return {"signals": signals}


@app.delete("/playground-delete-signal")
def delete_signal(filepath: str, name: str):
    """Remove a named signal from Playground/signals.json."""
    json_path = _signals_json_path(filepath)
    signals = _read_signals(json_path)
    signals = [s for s in signals if s["name"] != name]
    _write_signals(json_path, signals)
    return {"signals": signals}


# ── Backtest Endpoint ──────────────────────────────────────────────────────────

@app.post("/backtest-signals")
def backtest_signals(request: BacktestRequest):
    """Run a forward-scanning backtest simulation over parquet data."""
    parquet_path = Path(request.filepath)
    if not parquet_path.exists():
        raise HTTPException(status_code=404, detail=f"Parquet file not found: {request.filepath}")

    try:
        df = pd.read_parquet(parquet_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read parquet: {str(e)}")

    if len(df) == 0:
        raise HTTPException(status_code=400, detail="Parquet file contains no data")

    # Add MA1/MA2/MA3 value columns from stored EMA prices and previous-bar OHLC columns for query expressions
    df['MA1'] = df['EMA1_Price']
    df['MA2'] = df['EMA2_Price']
    df['MA3'] = df['EMA3_Price']

    for col in ['open', 'high', 'low', 'close', 'direction']:
        df[f'{col}1'] = df[col].shift(1)
        df[f'{col}2'] = df[col].shift(2)

    for ma in ['MA1', 'MA2', 'MA3']:
        df[f'{ma}_1'] = df[ma].shift(1)
        df[f'{ma}_2'] = df[ma].shift(2)

    # Pre-compute arrays for fast scanning
    close_arr = df['close'].values.astype(float)
    is_up_arr = (df['close'] > df['open']).values
    rev_arr = df['reversal_size'].values.astype(float)
    adr_arr = df['currentADR'].values.astype(float)
    n = len(df)

    # Pre-compute datetime strings for results
    if 'datetime' in df.columns:
        dt_arr = df['datetime'].dt.strftime('%Y-%m-%d %H:%M:%S').values
    else:
        dt_arr = np.array(['' for _ in range(n)])

    # Pre-compute EMA if needed for ma_trail target
    ema_values = None
    if request.target_type == 'ma_trail':
        ema_col_map = {1: 'EMA1_Price', 2: 'EMA2_Price', 3: 'EMA3_Price'}
        ema_col = ema_col_map.get(request.target_ma, 'EMA1_Price')
        ema_values = df[ema_col].values

    signals_result = {}
    errors_result = {}

    # 1. Collect all (entry_index, signal_name) pairs across all signals
    all_entries = []
    for signal in request.signals:
        if not signal.expression.strip():
            continue
        try:
            subset = df.query(signal.expression)
            for i in subset.index.values:
                all_entries.append((int(i), signal.name))
        except Exception as e:
            errors_result[signal.name] = str(e)

    # 2. Sort chronologically by entry index (stable sort preserves signal order for ties)
    all_entries.sort(key=lambda x: x[0])

    # 3. Single pass with global next_allowed_entry
    trades_by_signal = {}
    next_allowed_entry = 0
    for i, sig_name in all_entries:
        if i >= n - 1:
            continue
        if not request.allow_overlap and i < next_allowed_entry:
            continue

        entry_close = close_arr[i]
        entry_rev = rev_arr[i]
        entry_adr = adr_arr[i]
        entry_is_up = bool(is_up_arr[i])
        direction = 'long' if entry_is_up else 'short'

        # Compute stop distance
        if request.stop_type == 'adr':
            stop_dist = max(request.stop_value * entry_adr, 1.0 * entry_rev)
        else:  # 'rr'
            stop_dist = request.stop_value * entry_rev

        # Stop price
        if entry_is_up:
            stop_price = entry_close - stop_dist
        else:
            stop_price = entry_close + stop_dist

        # Compute target distance for fixed types
        if request.target_type == 'fixed_rr':
            target_dist = request.target_value * entry_rev
        elif request.target_type == 'fixed_adr':
            target_dist = request.target_value * entry_adr
        else:
            target_dist = None  # ma_trail / color_change use different logic

        # Forward scan
        outcome = 'open'
        result = 0.0
        bars_held = 0
        exit_idx = None
        exit_dt = ''

        for j in range(i + 1, n):
            bars_held = j - i

            # Check STOP
            if entry_is_up:
                stopped = close_arr[j] <= stop_price
            else:
                stopped = close_arr[j] >= stop_price

            if stopped:
                outcome = 'stop'
                # Result is the stop distance in report units
                if request.report_unit == 'adr':
                    result = -(stop_dist / entry_adr)
                else:
                    result = -(stop_dist / entry_rev)
                exit_idx = j
                exit_dt = dt_arr[j]
                break

            # Check TARGET
            if request.target_type in ('fixed_rr', 'fixed_adr'):
                if entry_is_up:
                    hit = close_arr[j] >= entry_close + target_dist
                else:
                    hit = close_arr[j] <= entry_close - target_dist

                if hit:
                    outcome = 'target'
                    if request.report_unit == 'adr':
                        result = target_dist / entry_adr
                    else:
                        result = target_dist / entry_rev
                    exit_idx = j
                    exit_dt = dt_arr[j]
                    break

            elif request.target_type == 'ma_trail':
                # Opposite-color bar closes beyond the MA
                if is_up_arr[j] != entry_is_up and ema_values is not None:
                    ema_val = ema_values[j]
                    if not np.isnan(ema_val):
                        if entry_is_up and close_arr[j] < ema_val:
                            # Exit: down bar closed below MA
                            move = close_arr[j] - entry_close
                            outcome = 'target'
                            if request.report_unit == 'adr':
                                result = move / entry_adr
                            else:
                                result = move / entry_rev
                            exit_idx = j
                            exit_dt = dt_arr[j]
                            break
                        elif not entry_is_up and close_arr[j] > ema_val:
                            # Exit: up bar closed above MA
                            move = entry_close - close_arr[j]
                            outcome = 'target'
                            if request.report_unit == 'adr':
                                result = move / entry_adr
                            else:
                                result = move / entry_rev
                            exit_idx = j
                            exit_dt = dt_arr[j]
                            break

            elif request.target_type == 'color_change':
                # First opposite-color bar
                if is_up_arr[j] != entry_is_up:
                    if entry_is_up:
                        move = close_arr[j] - entry_close
                    else:
                        move = entry_close - close_arr[j]
                    outcome = 'target'
                    if request.report_unit == 'adr':
                        result = move / entry_adr
                    else:
                        result = move / entry_rev
                    exit_idx = j
                    exit_dt = dt_arr[j]
                    break

        # If still open, compute unrealized P&L
        if outcome == 'open':
            bars_held = n - 1 - i
            if entry_is_up:
                move = close_arr[n - 1] - entry_close
            else:
                move = entry_close - close_arr[n - 1]
            if request.report_unit == 'adr':
                result = move / entry_adr
            else:
                result = move / entry_rev
            exit_idx = n - 1
            exit_dt = dt_arr[n - 1]

        exit_price = close_arr[exit_idx] if exit_idx is not None else close_arr[n - 1]
        trade = {
            "idx": i,
            "entry_dt": dt_arr[i],
            "entry_price": round(float(entry_close), 5),
            "direction": direction,
            "outcome": outcome,
            "result": round(float(result), 2),
            "bars_held": bars_held,
            "exit_idx": exit_idx,
            "exit_dt": exit_dt,
            "exit_price": round(float(exit_price), 5),
        }
        if sig_name not in trades_by_signal:
            trades_by_signal[sig_name] = []
        trades_by_signal[sig_name].append(trade)
        if not request.allow_overlap and exit_idx is not None:
            next_allowed_entry = exit_idx + 1

    # 4. Compute summary stats per signal
    for signal in request.signals:
        if signal.name in errors_result:
            continue
        if not signal.expression.strip():
            continue
        trades = trades_by_signal.get(signal.name, [])

        # Compute summary stats
        count = len(trades)
        closed = [t for t in trades if t['outcome'] != 'open']
        wins = [t for t in closed if t['result'] > 0]
        losses = [t for t in closed if t['result'] <= 0]
        open_trades = [t for t in trades if t['outcome'] == 'open']
        win_results = [t['result'] for t in wins]
        loss_results = [t['result'] for t in losses]

        win_count = len(wins)
        loss_count = len(losses)
        open_count = len(open_trades)
        closed_count = win_count + loss_count

        win_rate = (win_count / closed_count) if closed_count > 0 else 0
        avg_win = (sum(win_results) / win_count) if win_count > 0 else 0
        avg_loss = (sum(loss_results) / loss_count) if loss_count > 0 else 0
        gross_profit = sum(win_results)
        gross_loss = abs(sum(loss_results))
        profit_factor = (gross_profit / gross_loss) if gross_loss > 0 else float('inf') if gross_profit > 0 else 0
        total_r = sum(t['result'] for t in trades)
        expectancy = (total_r / closed_count) if closed_count > 0 else 0

        # Max Drawdown
        cum = 0.0
        peak = 0.0
        max_drawdown = 0.0
        for t in trades:
            cum += t['result']
            if cum > peak:
                peak = cum
            dd = peak - cum
            if dd > max_drawdown:
                max_drawdown = dd

        # Sharpe Ratio
        closed_results = [t['result'] for t in trades if t['outcome'] in ('target', 'stop')]
        if len(closed_results) >= 2:
            cr_mean = sum(closed_results) / len(closed_results)
            cr_std = (sum((x - cr_mean) ** 2 for x in closed_results) / (len(closed_results) - 1)) ** 0.5
            sharpe = (cr_mean / cr_std) if cr_std > 0 else None
        else:
            sharpe = None

        # Max Consecutive Wins / Losses
        max_consec_wins = 0
        max_consec_losses = 0
        cur_wins = 0
        cur_losses = 0
        for t in trades:
            if t['outcome'] == 'open':
                continue
            if t['result'] > 0:
                cur_wins += 1
                cur_losses = 0
            elif t['result'] < 0:
                cur_losses += 1
                cur_wins = 0
            else:
                cur_wins = 0
                cur_losses = 0
            if cur_wins > max_consec_wins:
                max_consec_wins = cur_wins
            if cur_losses > max_consec_losses:
                max_consec_losses = cur_losses

        # Avg Bars Held
        avg_bars = (sum(t['bars_held'] for t in trades) / count) if count > 0 else 0

        signals_result[signal.name] = {
            "trades": trades,
            "summary": {
                "count": count,
                "wins": win_count,
                "losses": loss_count,
                "open": open_count,
                "win_rate": round(win_rate, 3),
                "avg_win": round(avg_win, 2),
                "avg_loss": round(avg_loss, 2),
                "profit_factor": round(profit_factor, 2) if profit_factor != float('inf') else 999.99,
                "expectancy": round(expectancy, 2),
                "total_r": round(total_r, 2),
                "max_drawdown": round(max_drawdown, 2),
                "sharpe": round(sharpe, 2) if sharpe is not None else None,
                "max_consec_wins": max_consec_wins,
                "max_consec_losses": max_consec_losses,
                "avg_bars_held": round(avg_bars, 1),
            },
        }

    return {
        "signals": signals_result,
        "errors": errors_result,
        "config": {
            "stop_type": request.stop_type,
            "stop_value": request.stop_value,
            "target_type": request.target_type,
            "target_value": request.target_value,
            "target_ma": request.target_ma,
            "report_unit": request.report_unit,
            "allow_overlap": request.allow_overlap,
        },
    }


@app.delete("/stats-file")
def delete_stats_file(filepath: str):
    """Delete a parquet stats file."""
    parquet_path = Path(filepath)

    if not parquet_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filepath}")

    # Security check: only allow deleting .parquet files from Stats directories
    if not parquet_path.suffix == '.parquet':
        raise HTTPException(status_code=400, detail="Only parquet files can be deleted")

    if 'Stats' not in parquet_path.parts:
        raise HTTPException(status_code=400, detail="Can only delete files from Stats directories")

    try:
        parquet_path.unlink()
        return {"message": f"Deleted {parquet_path.name}", "filepath": filepath}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete file: {str(e)}")


@app.delete("/stats-files")
def delete_all_stats_files(working_dir: Optional[str] = None):
    """Delete all parquet files in the Stats folder."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    stats_dir = base_dir / "Stats"

    if not stats_dir.exists():
        return {"message": "No Stats folder found", "deleted": 0}

    deleted_count = 0
    errors = []

    for filepath in stats_dir.iterdir():
        if filepath.is_file() and filepath.suffix.lower() == '.parquet':
            try:
                filepath.unlink()
                deleted_count += 1
            except Exception as e:
                errors.append(f"{filepath.name}: {str(e)}")

    if errors:
        return {"message": f"Deleted {deleted_count} files with {len(errors)} errors", "deleted": deleted_count, "errors": errors}

    return {"message": f"Deleted {deleted_count} parquet files", "deleted": deleted_count}


# ── ML Endpoints ──────────────────────────────────────────────────────────────

# Columns that must never be used as features (leakage / non-predictive)
ML_FEATURE_BLOCKLIST_PREFIXES = ("MFE_", "REAL_")
ML_FEATURE_BLOCKLIST_EXACT = {
    "close", "open", "high", "low", "datetime", "date", "time",
    "brick_size", "reversal_size", "wick_mode", "instrument",
    "ma1_period", "ma2_period", "ma3_period", "adr_period", "chop_period",
}


def _is_blocked_feature(col: str) -> bool:
    """Check if a column name is blocked from being used as a feature."""
    col_lower = col.lower()
    if col_lower in ML_FEATURE_BLOCKLIST_EXACT:
        return True
    for prefix in ML_FEATURE_BLOCKLIST_PREFIXES:
        if col.startswith(prefix):
            return True
    return False


@app.get("/ml/columns")
def get_ml_columns(filepath: str):
    """Read parquet schema and return columns split into features vs targets."""
    path = Path(filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {filepath}")

    try:
        schema = pq.read_schema(path)
        all_columns = [field.name for field in schema]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read parquet schema: {str(e)}")

    features = []
    targets = []

    for col in all_columns:
        if col.startswith("MFE_") or col.startswith("REAL_"):
            targets.append(col)
        elif not _is_blocked_feature(col):
            features.append(col)

    return {"features": sorted(features), "targets": sorted(targets), "all_columns": all_columns}


def _sse_event(data: dict) -> str:
    """Format a dict as an SSE data line."""
    return f"data: {json.dumps(data)}\n\n"


@app.post("/ml/train")
def train_ml_model(req: MLTrainRequest):
    """Full CatBoost training pipeline with SSE progress streaming."""

    def generate():
        from catboost import CatBoostClassifier
        from sklearn.model_selection import TimeSeriesSplit
        from sklearn.metrics import classification_report, confusion_matrix, accuracy_score

        yield _sse_event({"phase": "loading", "message": "Loading data...", "progress": 0})

        base_dir = Path(req.working_dir) if req.working_dir else WORKING_DIR
        ml_dir = base_dir / "ML"
        models_dir = ml_dir / "models"
        data_dir = ml_dir / "training_data"
        reports_dir = ml_dir / "reports"

        for d in [models_dir, data_dir, reports_dir]:
            d.mkdir(parents=True, exist_ok=True)

        source_path = Path(req.source_parquet)
        if not source_path.exists():
            yield _sse_event({"phase": "error", "message": f"Source parquet not found: {req.source_parquet}"})
            return

        try:
            df = pd.read_parquet(source_path)
        except Exception as e:
            yield _sse_event({"phase": "error", "message": f"Failed to read parquet: {str(e)}"})
            return

        # Add MA1/MA2/MA3 value columns from stored EMA prices and previous-bar OHLC columns for query expressions
        df['MA1'] = df['EMA1_Price']
        df['MA2'] = df['EMA2_Price']
        df['MA3'] = df['EMA3_Price']

        for col in ['open', 'high', 'low', 'close', 'direction']:
            df[f'{col}1'] = df[col].shift(1)
            df[f'{col}2'] = df[col].shift(2)

        for ma in ['MA1', 'MA2', 'MA3']:
            df[f'{ma}_1'] = df[ma].shift(1)
            df[f'{ma}_2'] = df[ma].shift(2)

        # Apply filter expression
        if req.filter_expr and req.filter_expr.strip():
            yield _sse_event({"phase": "filtering", "message": "Applying filter...", "progress": 2})
            try:
                df = df.query(req.filter_expr)
            except Exception as e:
                yield _sse_event({"phase": "error", "message": f"Invalid filter expression: {str(e)}"})
                return

        # Server-side leakage prevention
        safe_features = [f for f in req.features if not _is_blocked_feature(f)]
        if not safe_features:
            yield _sse_event({"phase": "error", "message": "No valid features selected after leakage filtering"})
            return

        missing = [f for f in safe_features if f not in df.columns]
        if missing:
            yield _sse_event({"phase": "error", "message": f"Missing feature columns: {missing}"})
            return

        if req.target_column not in df.columns:
            yield _sse_event({"phase": "error", "message": f"Target column not found: {req.target_column}"})
            return

        # Build binary target
        y = (df[req.target_column] >= req.win_threshold).astype(int)
        X = df[safe_features].copy()

        valid_mask = X.notna().all(axis=1) & y.notna()
        X = X[valid_mask].reset_index(drop=True)
        y = y[valid_mask].reset_index(drop=True)

        if len(X) < 10:
            yield _sse_event({"phase": "error", "message": f"Only {len(X)} valid rows after cleaning. Need at least 10."})
            return

        win_rate = float(y.mean())

        yield _sse_event({"phase": "preparing", "message": f"Prepared {len(X)} rows, starting CV...", "progress": 5})

        # Time-series cross-validation
        n_splits = min(req.n_splits, len(X) // 20)  # ensure reasonable fold size
        if n_splits < 2:
            n_splits = 2

        tscv = TimeSeriesSplit(n_splits=n_splits)
        fold_metrics = []
        all_val_preds = np.full(len(y), -1, dtype=int)
        all_val_true = np.full(len(y), -1, dtype=int)

        fold_pct_each = 80.0 / n_splits  # 5-85% range for folds

        for fold_idx, (train_idx, val_idx) in enumerate(tscv.split(X)):
            pct_start = 5 + fold_idx * fold_pct_each
            yield _sse_event({
                "phase": "fold",
                "message": f"Training fold {fold_idx + 1}/{n_splits}...",
                "progress": round(pct_start),
                "fold": fold_idx + 1,
                "total_folds": n_splits,
            })

            X_train, X_val = X.iloc[train_idx], X.iloc[val_idx]
            y_train, y_val = y.iloc[train_idx], y.iloc[val_idx]

            model = CatBoostClassifier(
                iterations=500,
                depth=6,
                learning_rate=0.05,
                early_stopping_rounds=50,
                auto_class_weights="Balanced",
                verbose=0,
                random_seed=42 + fold_idx,
            )
            model.fit(X_train, y_train, eval_set=(X_val, y_val), verbose=0)

            preds = model.predict(X_val).flatten().astype(int)
            acc = float(accuracy_score(y_val, preds))
            fold_metrics.append({
                "fold": fold_idx + 1,
                "train_size": len(train_idx),
                "val_size": len(val_idx),
                "accuracy": round(acc, 4),
                "val_win_rate": round(float(y_val.mean()), 4),
            })

            all_val_preds[val_idx] = preds
            all_val_true[val_idx] = y_val.values

            pct_done = 5 + (fold_idx + 1) * fold_pct_each
            yield _sse_event({
                "phase": "fold_done",
                "message": f"Fold {fold_idx + 1}/{n_splits} complete",
                "progress": round(pct_done),
                "fold": fold_idx + 1,
                "fold_accuracy": round(acc, 4),
            })

        # Aggregate CV metrics
        validated_mask = all_val_preds >= 0
        cv_preds = all_val_preds[validated_mask]
        cv_true = all_val_true[validated_mask]
        cv_accuracy = float(accuracy_score(cv_true, cv_preds))
        cv_report = classification_report(cv_true, cv_preds, output_dict=True, zero_division=0)
        cv_cm = confusion_matrix(cv_true, cv_preds).tolist()

        yield _sse_event({"phase": "final", "message": "Training final model on all data...", "progress": 85})

        final_model = CatBoostClassifier(
            iterations=500,
            depth=6,
            learning_rate=0.05,
            auto_class_weights="Balanced",
            verbose=0,
            random_seed=42,
        )
        final_model.fit(X, y, verbose=0)

        # Feature importance
        importance = final_model.get_feature_importance()
        feature_importance = sorted(
            [{"feature": f, "importance": round(float(imp), 4)} for f, imp in zip(safe_features, importance)],
            key=lambda x: x["importance"],
            reverse=True,
        )

        yield _sse_event({"phase": "saving", "message": "Saving model & report...", "progress": 95})

        model_path = models_dir / f"{req.model_name}.cbm"
        final_model.save_model(str(model_path))

        train_snapshot = df[valid_mask].reset_index(drop=True)
        snapshot_path = data_dir / f"{req.model_name}_data.parquet"
        train_snapshot.to_parquet(str(snapshot_path))

        report = {
            "model_name": req.model_name,
            "source_parquet": req.source_parquet,
            "target_column": req.target_column,
            "win_threshold": req.win_threshold,
            "filter_expr": req.filter_expr,
            "features": safe_features,
            "n_rows": len(X),
            "win_rate": round(win_rate, 4),
            "cv_accuracy": round(cv_accuracy, 4),
            "n_splits": n_splits,
            "classification_report": cv_report,
            "confusion_matrix": cv_cm,
            "feature_importance": feature_importance,
            "fold_metrics": fold_metrics,
            "model_path": str(model_path),
            "data_path": str(snapshot_path),
            "created_at": datetime.now().isoformat(),
        }

        report_path = reports_dir / f"{req.model_name}_report.json"
        with open(report_path, "w") as f:
            json.dump(report, f, indent=2)

        yield _sse_event({"phase": "done", "message": "Complete", "progress": 100, "report": report})

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/ml/models")
def list_ml_models(working_dir: Optional[str] = None):
    """List saved .cbm models with metadata from corresponding report JSONs."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    models_dir = base_dir / "ML" / "models"
    reports_dir = base_dir / "ML" / "reports"

    if not models_dir.exists():
        return []

    models = []
    for model_file in sorted(models_dir.glob("*.cbm")):
        name = model_file.stem
        report_path = reports_dir / f"{name}_report.json"

        entry = {
            "name": name,
            "model_path": str(model_file),
            "report_path": str(report_path) if report_path.exists() else None,
            "size_bytes": model_file.stat().st_size,
            "modified": datetime.fromtimestamp(model_file.stat().st_mtime).isoformat(),
        }

        if report_path.exists():
            try:
                with open(report_path) as f:
                    rpt = json.load(f)
                entry["cv_accuracy"] = rpt.get("cv_accuracy")
                entry["n_rows"] = rpt.get("n_rows")
                entry["target_column"] = rpt.get("target_column")
            except Exception:
                pass

        models.append(entry)

    return models


@app.get("/ml/report")
def get_ml_report(filepath: str):
    """Return a saved JSON report."""
    path = Path(filepath)
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Report not found: {filepath}")

    try:
        with open(path) as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read report: {str(e)}")


@app.delete("/ml/model")
def delete_ml_model(name: str, working_dir: Optional[str] = None):
    """Delete an ML model and all its associated files."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    model_path = base_dir / "ML" / "models" / f"{name}.cbm"
    report_path = base_dir / "ML" / "reports" / f"{name}_report.json"
    data_path = base_dir / "ML" / "training_data" / f"{name}_data.parquet"

    if not model_path.exists():
        raise HTTPException(status_code=404, detail=f"Model not found: {name}")

    deleted = []
    for p in [model_path, report_path, data_path]:
        if p.exists():
            p.unlink()
            deleted.append(str(p))

    return {"status": "deleted", "name": name, "files_deleted": deleted}


@app.delete("/ml/models")
def delete_all_ml_models(working_dir: Optional[str] = None):
    """Delete all ML models, reports, and training data."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    ml_dir = base_dir / "ML"
    deleted = 0
    errors = []

    for subdir in ["models", "reports", "training_data"]:
        d = ml_dir / subdir
        if d.exists():
            for f in d.iterdir():
                if f.is_file():
                    try:
                        f.unlink()
                        deleted += 1
                    except Exception as e:
                        errors.append(str(e))

    return {"status": "ok", "deleted": deleted, "errors": errors}


if __name__ == "__main__":
    import sys
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()

    is_frozen = getattr(sys, 'frozen', False)
    if is_frozen:
        uvicorn.run(app, host="127.0.0.1", port=args.port, reload=False)
    else:
        uvicorn.run("main:app", host="127.0.0.1", port=args.port, reload=True)
