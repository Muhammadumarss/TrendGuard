const average=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
export function tradeMetrics(trades) {
  const wins=trades.filter(t=>t.pnl>0),losses=trades.filter(t=>t.pnl<0);
  const gains=wins.reduce((s,t)=>s+t.pnl,0),loss=-losses.reduce((s,t)=>s+t.pnl,0);
  let consecutiveWins=0,consecutiveLosses=0,maxConsecutiveWins=0,maxConsecutiveLosses=0;
  for(const t of trades){consecutiveWins=t.pnl>0?consecutiveWins+1:0;consecutiveLosses=t.pnl<0?consecutiveLosses+1:0;maxConsecutiveWins=Math.max(maxConsecutiveWins,consecutiveWins);maxConsecutiveLosses=Math.max(maxConsecutiveLosses,consecutiveLosses);}
  return {count:trades.length,netPnl:gains-loss,winRate:trades.length?wins.length/trades.length:null,averageWin:average(wins.map(t=>t.pnl)),averageLoss:average(losses.map(t=>t.pnl)),profitFactor:loss?gains/loss:null,expectancy:average(trades.map(t=>t.pnl)),averageDurationMs:average(trades.map(t=>t.closedAt-t.openedAt)),maxConsecutiveWins,maxConsecutiveLosses,fees:trades.reduce((s,t)=>s+t.fees,0)};
}
export function performance(trades,curve,initialBalance) {
  let peak=initialBalance,drawdown=0;for(const r of curve){peak=Math.max(peak,r.equity);drawdown=Math.max(drawdown,1-r.equity/peak);}
  const days=new Map();for(const r of curve)days.set(Math.floor(r.at/86400000),r.equity);
  const lastAt=curve.at(-1)?.at??0;
  const closes=[...days].filter(([day])=>lastAt>=(day+1)*86400000-1).map(([,equity])=>equity),returns=closes.slice(1).map((e,i)=>e/closes[i]-1),mu=average(returns);
  const sd=returns.length>1?Math.sqrt(returns.reduce((s,r)=>s+(r-mu)**2,0)/(returns.length-1)):0;
  const downside=returns.length?Math.sqrt(returns.reduce((s,r)=>s+Math.min(0,r)**2,0)/returns.length):0;
  const duration=curve.length?curve.at(-1).at-curve[0].at:0,ending=curve.at(-1)?.equity??initialBalance;
  const annualReturn=duration>0&&ending>0?Math.pow(ending/initialBalance,365*86400000/duration)-1:null;
  const group=key=>Object.fromEntries([...new Set(trades.map(key))].map(k=>[k,tradeMetrics(trades.filter(t=>key(t)===k))]));
  return {...tradeMetrics(trades),maxDrawdown:drawdown,sharpe:sd>0?mu/sd*Math.sqrt(365):null,sortino:downside>0?mu/downside*Math.sqrt(365):null,calmar:drawdown>0&&Number.isFinite(annualReturn)?annualReturn/drawdown:null,ratioSampleDays:returns.length,ratioWarning:returns.length<90?'Short sample; annualized ratios unstable':null,byAsset:group(t=>t.symbol),byRegime:group(t=>t.context?.regime??'unknown'),byMonth:group(t=>new Date(t.closedAt).toISOString().slice(0,7)),long:tradeMetrics(trades),short:{count:0,note:'Not implemented: long-only spot'}};
}
export function fixedTradeStress(trades,multiplier=2) {
  const pnls=trades.map(t=>{
    const entryAsk=t.entry/(1+t.slippage),exitBid=t.exit/(1-t.slippage);
    return t.qty*exitBid*(1-t.slippage*multiplier)*(1-t.fee*multiplier)-t.qty*entryAsk*(1+t.slippage*multiplier)*(1+t.fee*multiplier);
  });
  return {count:trades.length,netPnl:pnls.reduce((a,b)=>a+b,0),method:'Fixed quantities and quote exit times; doubled fees/slippage only; not a resimulated strategy'};
}
