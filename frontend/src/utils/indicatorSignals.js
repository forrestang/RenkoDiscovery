function calculateSMA(data, period) {
  const result = []
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else {
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += data[i - j]
      }
      result.push(sum / period)
    }
  }
  return result
}

function calculateEMA(data, period) {
  const result = []
  const multiplier = 2 / (period + 1)
  let ema = null

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null)
    } else if (i === period - 1) {
      let sum = 0
      for (let j = 0; j < period; j++) {
        sum += data[i - j]
      }
      ema = sum / period
      result.push(ema)
    } else {
      ema = (data[i] - ema) * multiplier + ema
      result.push(ema)
    }
  }
  return result
}

const round = (v, d) => { const m = Math.pow(10, d); return Math.round(v * m) / m }

export function computeIndicatorSignals(renkoData, maSettings, renkoSettings, pricePrecision = 5) {
  const { open, high, low, close, datetime, brick_size, reversal_size } = renkoData.data
  const brickSize = renkoSettings.brickSize
  const reversalSize = renkoSettings.reversalSize
  const renkoPerBrickSizes = brick_size || null
  const renkoPerReversalSizes = reversal_size || null

  const ma1Values = maSettings.ma1.type === 'ema'
    ? calculateEMA(close, maSettings.ma1.period)
    : calculateSMA(close, maSettings.ma1.period)
  const ma2Values = maSettings.ma2.type === 'ema'
    ? calculateEMA(close, maSettings.ma2.period)
    : calculateSMA(close, maSettings.ma2.period)
  const ma3Values = maSettings.ma3.type === 'ema'
    ? calculateEMA(close, maSettings.ma3.period)
    : calculateSMA(close, maSettings.ma3.period)

  const rows = []
  let type1Counter = 0
  let type2Counter = 0
  let prevState = null

  for (let i = 0; i < close.length; i++) {
    const fast = ma1Values[i]
    const med = ma2Values[i]
    const slow = ma3Values[i]

    if (fast === null || med === null || slow === null) {
      rows.push({ datetime: datetime[i], state: 0, type1: 0, type2: 0 })
      continue
    }

    let state = 0
    if (fast > med && med > slow) state = 3
    else if (fast > slow && slow > med) state = 2
    else if (slow > fast && fast > med) state = 1
    else if (med > fast && fast > slow) state = -1
    else if (med > slow && slow > fast) state = -2
    else if (slow > med && med > fast) state = -3

    // Reset counters on state change
    if (state !== prevState) {
      type1Counter = 0
      type2Counter = 0
      prevState = state
    }

    const isUp = close[i] > open[i]
    const isDown = close[i] < open[i]

    let type1 = 0
    let type2 = 0

    // Type1 Logic - 3-bar pattern
    const use3bar = renkoPerReversalSizes && renkoPerBrickSizes
      ? renkoPerReversalSizes[i] > renkoPerBrickSizes[i]
      : reversalSize > brickSize

    if (i > 1) {
      const priorIsUp = close[i - 1] > open[i - 1]
      const priorIsDown = close[i - 1] < open[i - 1]
      const prior2IsUp = close[i - 2] > open[i - 2]
      const prior2IsDown = close[i - 2] < open[i - 2]

      // Long T1: DOWN -> UP -> UP in state +3
      if (state === 3 && isUp && priorIsUp && prior2IsDown) {
        type1Counter++
        type1 = type1Counter
      }
      // Short T1: UP -> DOWN -> DOWN in state -3
      if (state === -3 && isDown && priorIsDown && prior2IsUp) {
        type1Counter++
        type1 = -type1Counter
      }
    }

    // Type2 Logic - wick > brick_size
    if (use3bar) {
      const brickSizeAtI = renkoPerBrickSizes ? renkoPerBrickSizes[i] : brickSize
      const priorIsUpT2 = i > 0 ? close[i - 1] > open[i - 1] : false
      if (state === 3 && isUp && round(open[i] - low[i], pricePrecision) > brickSizeAtI) {
        if (priorIsUpT2) {
          type2Counter++
          type2 = type2Counter
        }
      }
      if (state === -3 && isDown && round(high[i] - open[i], pricePrecision) > brickSizeAtI) {
        if (!priorIsUpT2) {
          type2Counter++
          type2 = -type2Counter
        }
      }
    }

    rows.push({ datetime: datetime[i], state, type1, type2 })
  }

  return rows
}
