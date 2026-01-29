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
    renko_data: dict  # Contains datetime, open, high, low, close arrays


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
    cache_dir = base_dir / "cache_performant"

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
    cache_dir = base_dir / "cache_performant"
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
    cache_dir = base_dir / "cache_performant"

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
    cache_dir = base_dir / "cache_performant"
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
                "processed_at": datetime.now().isoformat()
            }
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
    cache_dir = base_dir / "cache_performant"
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
        "displayed_rows": len(df)
    }


def get_pip_value(instrument: str) -> float:
    """Get pip value for instrument (assumes forex pairs)."""
    # JPY pairs have 2 decimal places, others have 4
    if 'JPY' in instrument.upper():
        return 0.01
    return 0.0001


def generate_renko_custom(df: pd.DataFrame, brick_size: float, reversal_multiplier: float = 2.0, wick_mode: str = "all") -> tuple[pd.DataFrame, dict]:
    """
    Generate Renko bricks with configurable reversal multiplier using threshold-based logic.

    Standard Renko uses reversal_multiplier=2 (need 2x brick size to reverse).
    This implementation allows custom reversal thresholds.

    wick_mode options:
        - "all": Show all wicks (any retracement)
        - "big": Only show wicks when retracement > brick_size
        - "none": No wicks at all

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
        if wick_mode == "none":
            return brick_open
        elif wick_mode == "all":
            return min(pending_low_val, brick_open)  # Always show wick
        elif wick_mode == "big":
            if not apply_wick:
                return brick_open
            retracement = brick_open - pending_low_val
            if retracement > brick_size:
                return pending_low_val
            return brick_open
        return brick_open

    def calc_down_brick_high(pending_high_val, brick_open, apply_wick=True):
        """Calculate high for down brick based on wick mode."""
        if wick_mode == "none":
            return brick_open
        elif wick_mode == "all":
            return max(pending_high_val, brick_open)  # Always show wick
        elif wick_mode == "big":
            if not apply_wick:
                return brick_open
            retracement = pending_high_val - brick_open
            if retracement > brick_size:
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
                    # For "all" wick mode, calculate per-brick min; otherwise use global pending
                    brick_pending_low = low_prices[cross_open:cross_close+1].min() if wick_mode == "all" and not first_brick else pending_low
                    bricks.append({
                        'datetime': timestamps[cross_open],
                        'open': brick_open,
                        'high': brick_close,
                        'low': calc_up_brick_low(brick_pending_low, brick_open, apply_wick=first_brick),
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
                    # For "all" wick mode, calculate per-brick max; otherwise use global pending
                    brick_pending_high = high_prices[cross_open:cross_close+1].max() if wick_mode == "all" and not first_brick else pending_high
                    bricks.append({
                        'datetime': timestamps[cross_open],
                        'open': brick_open,
                        'high': calc_down_brick_high(brick_pending_high, brick_open, apply_wick=first_brick),
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
                    # For "all" wick mode, calculate per-brick max; otherwise use global pending
                    brick_pending_high = high_prices[cross_open:cross_close+1].max() if wick_mode == "all" and not first_brick else pending_high
                    bricks.append({
                        'datetime': timestamps[cross_open],
                        'open': brick_open,
                        'high': calc_down_brick_high(brick_pending_high, brick_open, apply_wick=first_brick),
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
                    # For "all" wick mode, calculate per-brick min; otherwise use global pending
                    brick_pending_low = low_prices[cross_open:cross_close+1].min() if wick_mode == "all" and not first_brick else pending_low
                    bricks.append({
                        'datetime': timestamps[cross_open],
                        'open': brick_open,
                        'high': brick_close,
                        'low': calc_up_brick_low(brick_pending_low, brick_open, apply_wick=first_brick),
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

    # Use direct price values
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

    return {
        "instrument": instrument,
        "brick_size": brick_size,
        "reversal_size": reversal_size,
        "data": {
            "datetime": datetime_list,
            "open": renko_df['open'].tolist(),
            "high": renko_df['high'].tolist(),
            "low": renko_df['low'].tolist(),
            "close": renko_df['close'].tolist(),
            "volume": renko_df['volume'].tolist() if 'volume' in renko_df.columns else [1] * len(renko_df),
            "tick_index_open": renko_df['tick_index_open'].tolist() if 'tick_index_open' in renko_df.columns else None,
            "tick_index_close": renko_df['tick_index_close'].tolist() if 'tick_index_close' in renko_df.columns else None,
        },
        "pending_brick": pending_brick,
        "total_bricks": len(renko_df)
    }


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

    # Add settings columns
    df['adr_period'] = request.adr_period
    df['brick_size'] = request.brick_size
    df['reversal_size'] = request.reversal_size
    df['wick_mode'] = request.wick_mode
    df['ma1_period'] = request.ma1_period
    df['ma2_period'] = request.ma2_period
    df['ma3_period'] = request.ma3_period
    df['chopPeriod'] = request.chop_period

    # Calculate currentADR (Average Daily Range) from RAW price data
    # Load raw OHLC data for accurate daily range calculation
    cache_dir = base_dir / "cache_performant"
    feather_path = cache_dir / f"{instrument}.feather"
    raw_df = pd.read_feather(feather_path)
    raw_df['utc_date'] = raw_df['datetime'].dt.date

    # Calculate daily range from raw data (max high - min low per day)
    daily_stats = raw_df.groupby('utc_date').agg(
        day_high=('high', 'max'),
        day_low=('low', 'min')
    )
    daily_stats['daily_range'] = daily_stats['day_high'] - daily_stats['day_low']

    # Calculate rolling ADR (average of previous N days, excluding current)
    daily_stats['current_adr'] = daily_stats['daily_range'].shift(1).rolling(
        window=request.adr_period,
        min_periods=request.adr_period
    ).mean()

    # Map currentADR back to renko bars based on their UTC date
    df['datetime'] = pd.to_datetime(df['datetime'])
    df['utc_date'] = df['datetime'].dt.date
    df['currentADR'] = df['utc_date'].map(daily_stats['current_adr']).round(5)

    # Calculate EMA values and distances for each MA period
    ma_periods = [request.ma1_period, request.ma2_period, request.ma3_period]
    ema_columns = {}

    for period in ma_periods:
        ema_values = calculate_ema(df['close'], period)
        ema_columns[period] = ema_values  # Store for State calculation
        df[f'EMA_rawDistance({period})'] = (df['close'] - ema_values).round(5)
        df[f'EMA_adrDistance({period})'] = ((df['close'] - ema_values) / df['currentADR']).round(5)
        df[f'EMA_rrDistance({period})'] = ((df['close'] - ema_values) / request.reversal_size).round(5)

    # Calculate DD (drawdown/wick size in price units)
    # UP brick (close > open): wick extends below open -> DD = open - low
    # DOWN brick (close < open): wick extends above open -> DD = high - open
    df['DD'] = np.where(
        df['close'] > df['open'],
        df['open'] - df['low'],
        df['high'] - df['open']
    )
    df['DD'] = df['DD'].round(5)

    # Normalize DD by currentADR
    df['DD_ADR'] = (df['DD'] / df['currentADR']).round(5)
    # Normalize DD by reversal size
    df['DD_RR'] = (df['DD'] / request.reversal_size).round(5)

    # Calculate State based on MA order
    # Fast=ma1_period, Med=ma2_period, Slow=ma3_period
    fast_ema = ema_columns[request.ma1_period]
    med_ema = ema_columns[request.ma2_period]
    slow_ema = ema_columns[request.ma3_period]

    def get_state(fast, med, slow):
        if fast > med > slow: return 3
        if fast > slow > med: return 2
        if slow > fast > med: return 1    # 63% UP - transitional bullish
        if med > fast > slow: return -1   # 34% UP - transitional bearish
        if med > slow > fast: return -2   # Fast lowest (deep bearish)
        if slow > med > fast: return -3
        return 0  # Edge case: equal values

    df['State'] = [get_state(f, m, s) for f, m, s in zip(fast_ema, med_ema, slow_ema)]

    # Prior state (shifted by 1)
    df['prState'] = df['State'].shift(1)

    # Calculate Type1 and Type2 pullback counters
    # These accumulate only in +3/-3 states, reset on state change
    state_arr = df['State'].values
    prstate_arr = df['prState'].values
    is_up_arr_t = (df['close'] > df['open']).values
    open_arr = df['open'].values
    high_arr = df['high'].values
    low_arr = df['low'].values
    ma1_values = ema_columns[request.ma1_period]

    n = len(df)
    type1_count = np.zeros(n, dtype=int)
    type2_count = np.zeros(n, dtype=int)

    # Internal counters track cumulative count, display arrays show only when conditions met
    internal_type1 = 0
    internal_type2 = 0

    for i in range(n):
        state = state_arr[i]
        prstate = prstate_arr[i] if i > 0 else np.nan
        state_changed = (i == 0 or state != prstate)

        # Reset internal counters on state change
        if state_changed:
            internal_type1 = 0
            internal_type2 = 0

        current_is_up = is_up_arr_t[i]
        prior_is_up = is_up_arr_t[i - 1] if i > 0 else None

        # Type1 logic - pattern depends on reversal vs brick size
        # reversal > brick: 3-bar pattern (DOWN, UP, UP or UP, DOWN, DOWN)
        # reversal == brick: 2-bar pattern (DOWN, UP or UP, DOWN)
        # MA1 touch can be on ANY bar in the pattern (current, prior, or prior2)
        use_3bar = request.reversal_size > request.brick_size

        if use_3bar and i > 1 and state == 3:
            prior2_is_up = is_up_arr_t[i - 2]
            # 3-bar pattern: DOWN, UP, UP - with MA1 touch on current, prior, or prior2
            ma1_touched = (low_arr[i] <= ma1_values[i] or
                           low_arr[i - 1] <= ma1_values[i - 1] or
                           low_arr[i - 2] <= ma1_values[i - 2])
            if current_is_up and prior_is_up and not prior2_is_up and ma1_touched:
                internal_type1 += 1
            # Display only when full pattern matches
            type1_count[i] = internal_type1 if (current_is_up and prior_is_up and not prior2_is_up) else 0
        elif use_3bar and i > 1 and state == -3:
            prior2_is_up = is_up_arr_t[i - 2]
            # 3-bar pattern: UP, DOWN, DOWN - with MA1 touch on current, prior, or prior2
            ma1_touched = (high_arr[i] >= ma1_values[i] or
                           high_arr[i - 1] >= ma1_values[i - 1] or
                           high_arr[i - 2] >= ma1_values[i - 2])
            if not current_is_up and not prior_is_up and prior2_is_up and ma1_touched:
                internal_type1 -= 1
            # Display only when full pattern matches
            type1_count[i] = internal_type1 if (not current_is_up and not prior_is_up and prior2_is_up) else 0
        elif not use_3bar and i > 0 and state == 3:
            # 2-bar pattern: DOWN, UP - with MA1 touch on current or prior
            ma1_touched = (low_arr[i] <= ma1_values[i] or
                           low_arr[i - 1] <= ma1_values[i - 1])
            if current_is_up and not prior_is_up and ma1_touched:
                internal_type1 += 1
            # Display only on transition bar (UP following DOWN)
            type1_count[i] = internal_type1 if (current_is_up and not prior_is_up) else 0
        elif not use_3bar and i > 0 and state == -3:
            # 2-bar pattern: UP, DOWN - with MA1 touch on current or prior
            ma1_touched = (high_arr[i] >= ma1_values[i] or
                           high_arr[i - 1] >= ma1_values[i - 1])
            if not current_is_up and prior_is_up and ma1_touched:
                internal_type1 -= 1
            # Display only on transition bar (DOWN following UP)
            type1_count[i] = internal_type1 if (not current_is_up and prior_is_up) else 0
        else:
            type1_count[i] = 0

        # Type2 logic - when reversal > brick, prior bar must be same direction
        if state == 3:
            has_wick = current_is_up and open_arr[i] > low_arr[i]
            prior_ok = not use_3bar or prior_is_up  # No check needed if equal, else prior must be UP
            if has_wick and prior_ok:
                internal_type2 += 1
            type2_count[i] = internal_type2 if (current_is_up and prior_ok) else 0
        elif state == -3:
            has_wick = not current_is_up and high_arr[i] > open_arr[i]
            prior_ok = not use_3bar or not prior_is_up  # No check needed if equal, else prior must be DOWN
            if has_wick and prior_ok:
                internal_type2 -= 1
            type2_count[i] = internal_type2 if (not current_is_up and prior_ok) else 0
        else:
            type2_count[i] = 0

    df['Type1'] = type1_count
    df['Type2'] = type2_count

    # Calculate consecutive bar counters
    is_up = df['close'] > df['open']

    # Con_UP_bars and Con_DN_bars - reset on direction change only
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

    # Con_UP_bars(state) and Con_DN_bars(state) - reset on state change OR direction change
    state_values = df['State'].tolist()
    con_up_state = []
    con_dn_state = []
    up_count_state = 0
    dn_count_state = 0
    prev_state = None

    for i, (up, state) in enumerate(zip(is_up, state_values)):
        # Reset on state change
        if prev_state is not None and state != prev_state:
            up_count_state = 0
            dn_count_state = 0

        # Then apply direction logic
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

    # Calculate bar duration (time between consecutive bars) in minutes
    bar_duration_td = df['datetime'] - df['datetime'].shift(1)
    df['barDuration'] = (bar_duration_td.dt.total_seconds() / 60).round(2)

    # Calculate stateBarCount and stateDuration
    state_values = df['State'].tolist()
    bar_durations = df['barDuration'].tolist()
    state_bar_count = []
    state_duration = []
    bar_count = 0
    duration_sum = 0.0
    prev_state_dur = None

    for i, (state, bar_dur) in enumerate(zip(state_values, bar_durations)):
        # Reset on state change
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

    # Calculate reversal bars and rolling chop index
    # A reversal bar occurs when current direction differs from previous direction
    # Direction: UP if close > open, DOWN if close < open
    directions = (df['close'] > df['open']).astype(int)
    reversals = (directions != directions.shift(1)).astype(int)
    # First bar cannot be a reversal
    reversals.iloc[0] = 0

    # Rolling sum of reversals over chop_period, then divide by period
    df['chop(rolling)'] = (reversals.rolling(window=request.chop_period, min_periods=request.chop_period).sum() / request.chop_period).round(2)

    # Calculate FX_clr_Bars (forward-looking consecutive same-color bars)
    # For each bar, count how many subsequent bars match its color
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
            mfe_clr_bars[i] = -int(request.reversal_size / request.brick_size)
        else:
            mfe_clr_bars[i] = count

    df['FX_clr_Bars'] = mfe_clr_bars

    # Calculate FX_clr_price (price move during consecutive same-color run)
    # For each bar, find price difference to the last consecutive same-color bar
    close_arr = df['close'].values
    mfe_clr_price = np.zeros(n, dtype=float)

    for i in range(n):
        if mfe_clr_bars[i] > 0:
            last_match_idx = i + mfe_clr_bars[i]
            mfe_clr_price[i] = abs(close_arr[last_match_idx] - close_arr[i])
        else:
            mfe_clr_price[i] = -request.reversal_size

    df['FX_clr_price'] = pd.Series(mfe_clr_price).round(5).values

    # Calculate FX_clr_ADR (ADR-normalized version)
    df['FX_clr_ADR'] = (df['FX_clr_price'] / df['currentADR']).round(2)

    # Calculate FX_clr_RR (Reversal-normalized version)
    df['FX_clr_RR'] = (df['FX_clr_price'] / df['reversal_size']).round(2)

    # Calculate FX_MA columns (price move until first opposite-color bar closes beyond MA)
    for idx, period in enumerate(ma_periods, start=1):
        # Get EMA values for this period
        ema_values = calculate_ema(df['close'], period)

        mfe_ma_price = np.full(n, np.nan, dtype=float)

        for i in range(n):
            current_is_up = is_up_arr[i]
            current_close = close_arr[i]
            rev_size = df['reversal_size'].iloc[i]

            # Look forward for first opposite-color bar closing beyond MA
            for j in range(i + 1, n):
                if is_up_arr[j] != current_is_up:  # Opposite color
                    if current_is_up:
                        # Current is UP, looking for DOWN bar closing below MA
                        if close_arr[j] < ema_values[j]:
                            mfe_ma_price[i] = max(close_arr[j] - current_close, -rev_size)
                            break
                    else:
                        # Current is DOWN, looking for UP bar closing above MA
                        if close_arr[j] > ema_values[j]:
                            mfe_ma_price[i] = max(current_close - close_arr[j], -rev_size)
                            break
            # If no qualifying bar found, remains NaN

        df[f'FX_MA{idx}_Price'] = pd.Series(mfe_ma_price).round(5).values
        df[f'FX_MA{idx}_ADR'] = (mfe_ma_price / df['currentADR']).round(2)
        df[f'FX_MA{idx}_RR'] = (mfe_ma_price / df['reversal_size']).round(2)

    # Drop rows where currentADR or EMA distances couldn't be calculated (insufficient history)
    required_columns = ['currentADR'] + [f'EMA_rawDistance({p})' for p in ma_periods] + [f'FX_MA{idx}_Price' for idx in range(1, len(ma_periods) + 1)]
    df = df.dropna(subset=required_columns)

    # Clean up helper column
    df = df.drop(columns=['utc_date'])

    # Write to parquet
    df.to_parquet(output_path, engine='pyarrow', index=False)

    return {
        "status": "success",
        "filepath": str(output_path),
        "rows": len(df),
        "instrument": instrument
    }


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

    return {"columns": columns, "rows": rows, "totalRows": len(rows)}


@app.get("/parquet-stats")
def get_parquet_stats(filepath: str):
    """
    Calculate MA statistics from a parquet file.

    Returns counts and percentages of bars above/below each MA,
    and bars above/below ALL MAs.
    """
    parquet_path = Path(filepath)

    if not parquet_path.exists():
        raise HTTPException(status_code=404, detail=f"Parquet file not found: {filepath}")

    try:
        df = pd.read_parquet(parquet_path)
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
    if 'Type1' in df.columns and 'FX_clr_Bars' in df.columns:
        # UP Type1: Type1 > 0 (UP bars in State +3 transitions)
        up_type1_mask = df['Type1'] > 0
        # DN Type1: Type1 < 0 (DN bars in State -3 transitions)
        dn_type1_mask = df['Type1'] < 0

        up_type1_mfe = df.loc[up_type1_mask, 'FX_clr_Bars'].tolist()
        dn_type1_mfe = df.loc[dn_type1_mask, 'FX_clr_Bars'].tolist()

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
        if 'FX_clr_ADR' in df.columns:
            up_adr = df.loc[up_type1_mask, 'FX_clr_ADR'].tolist()
            dn_adr = df.loc[dn_type1_mask, 'FX_clr_ADR'].tolist()
            type1_mfe_stats["upAdrDist"] = calc_decimal_dist(up_adr)
            type1_mfe_stats["dnAdrDist"] = calc_decimal_dist(dn_adr, use_abs=True)

        if 'FX_clr_RR' in df.columns:
            up_rr = df.loc[up_type1_mask, 'FX_clr_RR'].tolist()
            dn_rr = df.loc[dn_type1_mask, 'FX_clr_RR'].tolist()
            type1_mfe_stats["upRrDist"] = calc_decimal_dist(up_rr)
            type1_mfe_stats["dnRrDist"] = calc_decimal_dist(dn_rr, use_abs=True)

        # MA RR distributions
        if 'FX_MA1_RR' in df.columns:
            up_ma1_rr = df.loc[up_type1_mask, 'FX_MA1_RR'].tolist()
            dn_ma1_rr = df.loc[dn_type1_mask, 'FX_MA1_RR'].tolist()
            type1_mfe_stats["upMa1RrDist"] = calc_decimal_dist(up_ma1_rr)
            type1_mfe_stats["dnMa1RrDist"] = calc_decimal_dist(dn_ma1_rr, use_abs=True)

        if 'FX_MA2_RR' in df.columns:
            up_ma2_rr = df.loc[up_type1_mask, 'FX_MA2_RR'].tolist()
            dn_ma2_rr = df.loc[dn_type1_mask, 'FX_MA2_RR'].tolist()
            type1_mfe_stats["upMa2RrDist"] = calc_decimal_dist(up_ma2_rr)
            type1_mfe_stats["dnMa2RrDist"] = calc_decimal_dist(dn_ma2_rr, use_abs=True)

        if 'FX_MA3_RR' in df.columns:
            up_ma3_rr = df.loc[up_type1_mask, 'FX_MA3_RR'].tolist()
            dn_ma3_rr = df.loc[dn_type1_mask, 'FX_MA3_RR'].tolist()
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
    # Determine which extra RR columns are available
    extra_rr_cols = []
    for col_name, field_name in [
        ('FX_MA1_RR', 'ma1_rr'),
        ('FX_MA2_RR', 'ma2_rr'),
        ('FX_MA3_RR', 'ma3_rr'),
    ]:
        if col_name in df.columns:
            extra_rr_cols.append((col_name, field_name))

    if 'FX_clr_RR' in df.columns:
        # Columns to pull from the subset
        needed_cols_base = ['FX_clr_RR'] + [c for c, _ in extra_rr_cols]
        for key, col, cond in [
            ('type1Up', 'Type1', 'pos'),
            ('type1Dn', 'Type1', 'neg'),
            ('type2Up', 'Type2', 'pos'),
            ('type2Dn', 'Type2', 'neg'),
        ]:
            if col in df.columns:
                mask = df[col] > 0 if cond == 'pos' else df[col] < 0
                needed_cols = [col] + [c for c in needed_cols_base if c in df.columns]
                subset = df.loc[mask, needed_cols].dropna(subset=['FX_clr_RR'])
                n_vals = subset[col].abs().astype(int).values
                rr_vals = subset['FX_clr_RR'].round(2).values
                idx_vals = subset.index.values
                points = []
                for i in range(len(n_vals)):
                    pt = {"n": int(n_vals[i]), "rr": float(rr_vals[i]), "idx": int(idx_vals[i])}
                    # rr_adj = FX_clr_RR - 1
                    pt["rr_adj"] = round(rr_vals[i] - 1, 2)
                    for col_name, field_name in extra_rr_cols:
                        pt[field_name] = round(float(subset[col_name].iloc[i]), 2)
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
    ]:
        if col in df.columns:
            val = df[col].iloc[0]
            settings[key] = val.item() if hasattr(val, 'item') else val

    return {
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
        "signalData": signal_data
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
