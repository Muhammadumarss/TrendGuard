export const MINUTE = 60_000, BAR = 15*MINUTE;
export function unlockAt(closedAt) {
  const d=new Date(closedAt);
  return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1,0,5);
}
export function lockUntil(trades, now) {
  let until=0;
  const lossesByDay=new Map();
  for(const t of trades) {
    if(!Number.isFinite(t.closedAt)||!Number.isFinite(t.pnl)) return Infinity;
    if(t.closedAt>now) return Infinity; // Clock rollback must not bypass a lock.
    if(t.pnl<0) {
      const reset=unlockAt(t.closedAt),count=(lossesByDay.get(reset)||0)+1;
      lossesByDay.set(reset,count);
      if(count>=2)until=Math.max(until,reset);
    }
  }
  return until>now?until:0;
}
export function stakeSize(equity,cash,c) {
  if(!Number.isFinite(equity)||!Number.isFinite(cash)||equity<=0||cash<=0) return 0;
  const riskCost=c.stop+2*c.fee+2*c.slippage;
  const n=Math.min(equity*c.riskFraction/riskCost,equity*c.maxAllocation,cash/(1+c.fee));
  return n>=c.minStake?n:0;
}
export function exitLevels(entry,c) {
  return {stop:entry*(1-c.stop),target:entry*(1+c.fee)*(1+c.takeProfit)/((1-c.fee)*(1-c.slippage))};
}
export function freshQuote(q,now,c) {
  return q && [q.bid,q.ask,q.at].every(Number.isFinite) && q.bid>0 && q.ask>=q.bid && now-q.at>=0 && now-q.at<=15_000 && (q.ask/q.bid-1)<=c.maxSpread;
}
export function signal(row,p,c) {
  return row && Number.isFinite(p) && p>=c.threshold && p<=1 && row.close>row.breakout && row.ema50>row.ema200 && row.close>row.ema50 && row.volume>row.volumeMean && row.volume>0;
}
