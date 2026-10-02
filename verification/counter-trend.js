// Research hypothesis only. Never imported by the paper execution path.
// A downside sweep followed by a completed, volume-confirmed recovery is not
// itself evidence of an edge. Thresholds are fixed before this replay.
export function counterTrendCandidate(row) {
  return !!(row && [row.open,row.close,row.ema50,row.ema200,row.volume,row.volumeMean,
    row.previousHigh,row.previousLow,row.previousClose,row.previousOpen,row.priorSupport].every(Number.isFinite) &&
    row.ema50<row.ema200 && row.close<row.ema50 &&
    row.previousClose<row.previousOpen && row.previousLow<row.priorSupport &&
    row.close>row.previousHigh && row.close>row.open &&
    row.volumeMean>0 && row.volume>row.volumeMean);
}

export function researchRows(bars,rows) {
  return rows.map((row,i)=>row && i>=21 ? {...row,
    previousHigh:bars[i-1].high,previousLow:bars[i-1].low,
    previousClose:bars[i-1].close,previousOpen:bars[i-1].open,
    priorSupport:Math.min(...bars.slice(i-21,i-1).map(b=>b.low))
  } : null);
}
