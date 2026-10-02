import { BAR } from './risk.js';

export function validateBars(rows) {
  if (!Array.isArray(rows)) throw Error('Invalid candle response');
  for (let i=0;i<rows.length;i++) {
    const b=rows[i];
    if (!b || !['time','end','open','high','low','close','volume'].every(k=>Number.isFinite(b[k])) ||
        !Number.isSafeInteger(b.time) || b.time<0 || b.time%BAR!==0 || b.end!==b.time+BAR-1 ||
        Math.min(b.open,b.close,b.low)<=0 || b.high<Math.max(b.open,b.close) ||
        b.low>Math.min(b.open,b.close) || b.volume<0) throw Error('Malformed 15-minute candle');
    if (i && b.time!==rows[i-1].time+BAR) throw Error('Candle history has gaps or duplicates');
  }
  return rows;
}

export function alignedHistory(all,symbols) {
  for (const s of symbols) validateBars(all[s]);
  const reference=all[symbols[0]];
  if (!reference?.length || symbols.some(s=>all[s].length!==reference.length || all[s].some((b,i)=>b.time!==reference[i].time)))
    throw Error('Historical assets must have identical contiguous timestamps');
  return reference;
}
