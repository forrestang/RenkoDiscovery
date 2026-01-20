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
    brick_method: str = "ticks"  # "ticks" | "percentage" | "atr"
    brick_size: float = 0.0010  # raw price value for ticks, percentage for percentage, multiplier for atr
    reversal_size: float = 0.0020  # raw price value for reversal threshold
    atr_period: int = 14  # only used for ATR method
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
    """List all cached parquet files."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    cache_dir = base_dir / "cache"

    if not cache_dir.exists():
        return []

    parquets = []
    for filepath in cache_dir.iterdir():
        if filepath.is_file() and filepath.suffix.lower() == '.parquet':
            stat = filepath.stat()
            parquets.append({
                "filename": filepath.name,
                "filepath": str(filepath),
                "instrument": filepath.stem,
                "size_bytes": stat.st_size,
                "modified": datetime.fromtimestamp(stat.st_mtime).isoformat()
            })

    return parquets


@app.delete("/cache/{instrument}")
def delete_cache_instrument(instrument: str, working_dir: Optional[str] = None):
    """Delete a specific cached parquet file."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    cache_dir = base_dir / "cache"
    parquet_path = cache_dir / f"{instrument}.parquet"

    if not parquet_path.exists():
        raise HTTPException(status_code=404, detail=f"No cached data for {instrument}")

    parquet_path.unlink()
    return {"status": "deleted", "instrument": instrument}


@app.delete("/cache")
def delete_cache_all(working_dir: Optional[str] = None):
    """Delete all cached parquet files."""
    base_dir = Path(working_dir) if working_dir else WORKING_DIR
    cache_dir = base_dir / "cache"

    if not cache_dir.exists():
        return {"status": "ok", "deleted": 0}

    deleted = 0
    for filepath in cache_dir.iterdir():
        if filepath.is_file() and filepath.suffix.lower() == '.parquet':
            filepath.unlink()
            deleted += 1

    return {"status": "ok", "deleted": deleted}


@app.post("/process")
def process_files(request: ProcessRequest):
    """Process selected files into parquet format, stitching by instrument."""
    base_dir = Path(request.working_dir) if request.working_dir else WORKING_DIR
    cache_dir = base_dir / "cache"
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
                # Read CSV - handle NinjaTrader format (semicolon-delimited, YYYYMMDD HHMMSS)
                df = pd.read_csv(
                    fp,
                    sep=';',
                    header=None,
                    names=['datetime', 'open', 'high', 'low', 'close', 'volume'],
                )
                # Parse custom datetime format: "20220102 170300" -> proper datetime
                df['datetime'] = pd.to_datetime(df['datetime'], format='%Y%m%d %H%M%S')
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

            # Save as parquet
            output_path = cache_dir / f"{instrument}.parquet"
            combined.to_parquet(output_path, engine='pyarrow', index=False)

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
    cache_dir = base_dir / "cache"
    parquet_path = cache_dir / f"{instrument}.parquet"

    if not parquet_path.exists():
        raise HTTPException(status_code=404, detail=f"No cached data for {instrument}")

    df = pd.read_parquet(parquet_path)
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


def calculate_atr(df: pd.DataFrame, period: int = 14) -> float:
    """Calculate Average True Range."""
    high = df['high']
    low = df['low']
    close = df['close']

    # True Range components
    tr1 = high - low
    tr2 = abs(high - close.shift(1))
    tr3 = abs(low - close.shift(1))

    tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
    atr = tr.rolling(window=period).mean()

    return float(atr.iloc[-1])


def get_pip_value(instrument: str) -> float:
    """Get pip value for instrument (assumes forex pairs)."""
    # JPY pairs have 2 decimal places, others have 4
    if 'JPY' in instrument.upper():
        return 0.01
    return 0.0001


def generate_renko_custom(df: pd.DataFrame, brick_size: float, reversal_multiplier: float = 2.0, wick_mode: str = "all") -> tuple[pd.DataFrame, dict]:
    """
    Generate Renko bricks with configurable reversal multiplier.

    Standard Renko uses reversal_multiplier=2 (need 2x brick size to reverse).
    This implementation allows custom reversal thresholds.

    wick_mode options:
        - "all": Show all wicks (any retracement)
        - "big": Only show wicks when retracement > brick_size
        - "none": No wicks at all

    Returns:
        tuple: (completed_bricks_df, pending_brick_dict)
    """
    def calc_up_brick_low(brick_low_val, brick_open):
        """Calculate low for up bar based on wick mode."""
        if wick_mode == "none":
            return brick_open
        elif wick_mode == "big":
            retracement = brick_open - brick_low_val
            if retracement > brick_size:
                return min(brick_low_val, brick_open)
            return brick_open
        else:  # "all"
            return min(brick_low_val, brick_open)

    def calc_down_brick_high(brick_high_val, brick_open):
        """Calculate high for down bar based on wick mode."""
        if wick_mode == "none":
            return brick_open
        elif wick_mode == "big":
            retracement = brick_high_val - brick_open
            if retracement > brick_size:
                return max(brick_high_val, brick_open)
            return brick_open
        else:  # "all"
            return max(brick_high_val, brick_open)

    close_prices = df['close'].values
    high_prices = df['high'].values
    low_prices = df['low'].values
    timestamps = df.index

    if len(close_prices) < 2:
        return pd.DataFrame(), None

    reversal_size = brick_size * reversal_multiplier
    bricks = []

    # Find starting reference price (round to brick boundary)
    first_price = close_prices[0]
    ref_price = np.floor(first_price / brick_size) * brick_size

    # Track state
    direction = 0  # 0 = undetermined, 1 = up, -1 = down
    brick_high = first_price
    brick_low = first_price
    tick_idx_open = 0
    last_brick_close = ref_price
    # Track pending brick high/low using actual M1 high/low values
    pending_high = high_prices[0]
    pending_low = low_prices[0]

    for i, price in enumerate(close_prices):
        brick_high = max(brick_high, price)
        brick_low = min(brick_low, price)
        pending_high = max(pending_high, high_prices[i])
        pending_low = min(pending_low, low_prices[i])

        if direction == 0:
            # Determine initial direction
            if price >= ref_price + brick_size:
                # First brick is up
                direction = 1
                brick_close = ref_price + brick_size
                bricks.append({
                    'datetime': timestamps[tick_idx_open],
                    'open': ref_price,
                    'high': brick_close,  # Up bar: high = close (no upper wick)
                    'low': calc_up_brick_low(brick_low, ref_price),
                    'close': brick_close,
                    'direction': 1,
                    'is_reversal': 0,
                    'tick_index_open': tick_idx_open,
                    'tick_index_close': i
                })
                last_brick_close = brick_close
                brick_high = price
                brick_low = price
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i
            elif price <= ref_price - brick_size:
                # First brick is down
                direction = -1
                brick_close = ref_price - brick_size
                bricks.append({
                    'datetime': timestamps[tick_idx_open],
                    'open': ref_price,
                    'high': calc_down_brick_high(brick_high, ref_price),
                    'low': brick_close,  # Down bar: low = close (no lower wick)
                    'close': brick_close,
                    'direction': -1,
                    'is_reversal': 0,
                    'tick_index_open': tick_idx_open,
                    'tick_index_close': i
                })
                last_brick_close = brick_close
                brick_high = price
                brick_low = price
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i

        elif direction == 1:
            # Check for continuation bricks (up)
            while price >= last_brick_close + brick_size:
                brick_open = last_brick_close
                brick_close = brick_open + brick_size
                bricks.append({
                    'datetime': timestamps[tick_idx_open],
                    'open': brick_open,
                    'high': brick_close,  # Up bar: high = close (no upper wick)
                    'low': calc_up_brick_low(brick_low, brick_open),
                    'close': brick_close,
                    'direction': 1,
                    'is_reversal': 0,
                    'tick_index_open': tick_idx_open,
                    'tick_index_close': i
                })
                last_brick_close = brick_close
                brick_high = price
                brick_low = price
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i

            # Check for reversal (need to drop by reversal_size)
            if price <= last_brick_close - reversal_size:
                direction = -1
                brick_open = last_brick_close
                brick_close = brick_open - brick_size
                bricks.append({
                    'datetime': timestamps[tick_idx_open],
                    'open': brick_open,
                    'high': calc_down_brick_high(brick_high, brick_open),
                    'low': brick_close,  # Down bar: low = close (no lower wick)
                    'close': brick_close,
                    'direction': -1,
                    'is_reversal': 1,
                    'tick_index_open': tick_idx_open,
                    'tick_index_close': i
                })
                last_brick_close = brick_close
                brick_high = price
                brick_low = price
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i

        else:  # direction == -1
            # Check for continuation bricks (down)
            while price <= last_brick_close - brick_size:
                brick_open = last_brick_close
                brick_close = brick_open - brick_size
                bricks.append({
                    'datetime': timestamps[tick_idx_open],
                    'open': brick_open,
                    'high': calc_down_brick_high(brick_high, brick_open),
                    'low': brick_close,  # Down bar: low = close (no lower wick)
                    'close': brick_close,
                    'direction': -1,
                    'is_reversal': 0,
                    'tick_index_open': tick_idx_open,
                    'tick_index_close': i
                })
                last_brick_close = brick_close
                brick_high = price
                brick_low = price
                pending_high = high_prices[i]
                pending_low = low_prices[i]
                tick_idx_open = i

            # Check for reversal (need to rise by reversal_size)
            if price >= last_brick_close + reversal_size:
                direction = 1
                brick_open = last_brick_close
                brick_close = brick_open + brick_size
                bricks.append({
                    'datetime': timestamps[tick_idx_open],
                    'open': brick_open,
                    'high': brick_close,  # Up bar: high = close (no upper wick)
                    'low': calc_up_brick_low(brick_low, brick_open),
                    'close': brick_close,
                    'direction': 1,
                    'is_reversal': 1,
                    'tick_index_open': tick_idx_open,
                    'tick_index_close': i
                })
                last_brick_close = brick_close
                brick_high = price
                brick_low = price
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
            # Pending up brick: high = close (no upper wick), low based on wick_mode
            if wick_mode == "none":
                pending_low_val = brick_open
            elif wick_mode == "big":
                retracement = brick_open - pending_low
                pending_low_val = min(pending_low, brick_open) if retracement > brick_size else brick_open
            else:  # "all"
                pending_low_val = min(pending_low, brick_open)
            pending_brick = {
                'open': brick_open,
                'high': current_price,  # Up bar: high = close
                'low': pending_low_val,
                'close': current_price,
                'direction': direction,
                'tick_index_open': tick_idx_open,
                'tick_index_close': last_idx
            }
        else:
            # Pending down brick: low = close (no lower wick), high based on wick_mode
            if wick_mode == "none":
                pending_high_val = brick_open
            elif wick_mode == "big":
                retracement = pending_high - brick_open
                pending_high_val = max(pending_high, brick_open) if retracement > brick_size else brick_open
            else:  # "all"
                pending_high_val = max(pending_high, brick_open)
            pending_brick = {
                'open': brick_open,
                'high': pending_high_val,
                'low': current_price,  # Down bar: low = close
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
    cache_dir = base_dir / "cache"
    parquet_path = cache_dir / f"{instrument}.parquet"

    if not parquet_path.exists():
        raise HTTPException(status_code=404, detail=f"No cached data for {instrument}")

    # Read source data
    df = pd.read_parquet(parquet_path)

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
    if request.brick_method == "ticks":
        # Direct raw price value
        brick_size = request.brick_size
        reversal_size = request.reversal_size
    elif request.brick_method == "percentage":
        # Use percentage of current price
        current_price = df['close'].iloc[-1]
        brick_size = current_price * (request.brick_size / 100)
        reversal_size = current_price * (request.reversal_size / 100)
    elif request.brick_method == "atr":
        # Use ATR-based calculation
        atr_value = calculate_atr(df.reset_index(), request.atr_period)
        brick_size = atr_value * request.brick_size
        reversal_size = atr_value * request.reversal_size
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
        renko_df, pending_brick = generate_renko_custom(df, brick_size, reversal_mult, request.wick_mode)

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
        "brick_method": request.brick_method,
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
