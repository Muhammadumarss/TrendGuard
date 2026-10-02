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
export function freshExitQuote(q,now) {
  return !!(q && Number.isFinite(now) && [q.bid,q.ask,q.at].every(Number.isFinite) &&
    q.bid>0 && q.ask>=q.bid && q.at>=0 && now-q.at>=0 && now-q.at<=15_000);
}
export function freshQuote(q,now,c) {
  // Wide spreads block entries, but must not suppress protective liquidations.
  return freshExitQuote(q,now) && (q.ask/q.bid-1)<=c.maxSpread;
}
export function signal(row,p,c) {
  return row && Number.isFinite(p) && p>=c.threshold && p<=1 && row.close>row.breakout && row.ema50>row.ema200 && row.close>row.ema50 && row.volume>row.volumeMean && row.volume>0;
}

export function regime(row,c) {
  const trend=row.ema50>row.ema200&&row.close>row.ema50?'bullish':row.ema50<row.ema200&&row.close<row.ema50?'bearish':'range';
  // Relative to the existing stop budget, not an optimized volatility threshold.
  return `${trend}:${row.x[3]*Math.sqrt(c.horizon)>c.stop?'high_volatility':'low_volatility'}`;
}
export function markRisk(s,equity,c) {
  if(!Number.isFinite(equity)||equity<0)throw Error('Invalid marked equity');
  s.risk??={peakEquity:s.initialBalance??s.cash,drawdownHalt:false};
  s.risk.peakEquity=Math.max(s.risk.peakEquity,equity);
  if(1-equity/s.risk.peakEquity>=(c.maxDrawdownFraction??.10))s.risk.drawdownHalt=true;
}
export function riskStatus(s,now,c) {
  if(!Number.isFinite(now))return {blocked:true,reason:'Invalid risk timestamp'};
  const until=lockUntil(s.trades,now);
  if(until)return {blocked:true,reason:'Daily loss lock active',until};
  if(s.risk?.drawdownHalt)return {blocked:true,reason:'Drawdown halt: review required'};
  let realized=s.initialBalance??s.cash,realizedPeak=realized;
  for(const t of s.trades){realized+=t.pnl;realizedPeak=Math.max(realizedPeak,realized);}
  if(1-realized/Math.max(realizedPeak,s.risk?.peakEquity??0)>=(c.maxDrawdownFraction??.10))return {blocked:true,reason:'Realized drawdown limit reached'};
  const day=Math.floor(now/86400000)*86400000,d=new Date(day),week=day-((d.getUTCDay()+6)%7)*86400000;
  for(const [start,fraction,name] of [[day,c.dailyLossFraction??.005,'Daily'],[week,c.weeklyLossFraction??.02,'Weekly']]) {
    const base=(s.initialBalance??s.cash)+s.trades.filter(t=>t.closedAt<start).reduce((n,t)=>n+t.pnl,0);
    const loss=s.trades.filter(t=>t.closedAt>=start).reduce((n,t)=>n+Math.max(0,-t.pnl),0);
    if(loss>=base*fraction)return {blocked:true,reason:`${name} monetary loss budget reached`};
  }
  let consecutive=0,last=0;
  for(const t of [...s.trades].sort((a,b)=>a.closedAt-b.closedAt)){consecutive=t.pnl<0?consecutive+1:0;last=t.closedAt;}
  if(consecutive>=(c.maxConsecutiveLosses??4)&&now<last+86400000)return {blocked:true,reason:'Consecutive-loss cooldown',until:last+86400000};
  return {blocked:false,reason:null};
}

export function remainingRiskBudget(s,now,c) {
  const day=Math.floor(now/86400000)*86400000,week=day-((new Date(day).getUTCDay()+6)%7)*86400000;
  let budget=s.cash*c.riskFraction;
  for(const [start,fraction] of [[day,c.dailyLossFraction??.005],[week,c.weeklyLossFraction??.02]]) {
    const base=(s.initialBalance??s.cash)+s.trades.filter(t=>t.closedAt<start).reduce((n,t)=>n+t.pnl,0);
    const loss=s.trades.filter(t=>t.closedAt>=start).reduce((n,t)=>n+Math.max(0,-t.pnl),0);
    budget=Math.min(budget,Math.max(0,base*fraction-loss));
  }
  return budget;
}
