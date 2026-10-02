import { BAR,regime,freshQuote,markRisk,riskStatus } from '../src/risk.js';
import { openPaper,closePaper } from '../src/engine.js';
import { askFromPrice,bidFromPrice,candleExit,sale } from '../src/execution.js';
import { performance,fixedTradeStress } from '../src/performance.js';
import { candidateSignal } from './candidates.js';

export function candidateExit(position,bar,c,policy) {
  // Infinity is only an internal comparison sentinel, never a stored target/order.
  return candleExit({...position,stop:Math.max(position.stop,position.trailingStop??0),
    target:policy.exit==='trailing'?Infinity:position.target},bar,c);
}

export function updateTrailingStop(position,completedBid,c) {
  if(!Number.isFinite(completedBid)||completedBid<=0)throw Error('Invalid completed trail price');
  const breakeven=position.entry*(1+position.fee)/((1-position.fee)*(1-position.slippage));
  if(completedBid>=breakeven*(1+c.stop))position.trailActive=true;
  if(position.trailActive)position.trailingStop=Math.max(position.trailingStop??position.stop,breakeven,completedBid*(1-c.stop));
}

export function replayCandidate(all,prepared,c,policy,{from,to,costMultiplier=1,spreadMultiplier=1,delayBars=0}={}) {
  const bars=all[c.symbols[0]],start=bars.findIndex(b=>b.time>=from),stop=bars.findIndex(b=>b.time>=to);
  const end=stop<0?bars.length:stop;
  if(start<1||end<=start)throw Error('Invalid replay range');
  const costs={...c,fee:c.fee*costMultiplier,slippage:c.slippage*costMultiplier,backtestSpread:c.backtestSpread*spreadMultiplier,horizon:policy.maxBars};
  const state={version:2,initialBalance:c.initialBalance,cash:c.initialBalance,enabled:true,position:null,trades:[],lastSignals:{},lastPoll:0};
  const curve=[],rejections={};let candidates=0,peak=c.initialBalance,intrabarDrawdownBound=0;
  const reject=reason=>{rejections[reason]=(rejections[reason]??0)+1;};
  const record=(at,bid)=>{const p=state.position,equity=state.cash+(p?sale(p.qty,bid,p.fee,p.slippage).proceeds:0);markRisk(state,equity,c);peak=Math.max(peak,equity);curve.push({at,equity});};
  record(bars[start].time,null);
  for(let i=start;i<end;i++) {
    const b=bars[i],gap=b.time!==bars[i-1].time+BAR;
    if(gap&&state.position) {closePaper(state,bidFromPrice(all[state.position.symbol][i].open,costs),b.time,'recovery_quote');record(b.time,null);}
    for(const symbol of c.symbols) {
      const index=i-1-delayBars,row=prepared[symbol][index];
      if(!candidateSignal(row,policy,c))continue;
      candidates++;
      if(gap||index<0||row.bar.time+(delayBars+1)*BAR!==b.time){reject('data_gap');continue;}
      if(state.position){reject('existing_exposure');continue;}
      const risk=riskStatus(state,b.time,c);if(risk.blocked){reject(risk.reason);continue;}
      const quote={ask:askFromPrice(all[symbol][i].open,costs),bid:bidFromPrice(all[symbol][i].open,costs),at:b.time};
      if(!freshQuote(quote,b.time,c)){reject('spread');continue;}
      if(Math.abs(quote.ask/row.bar.close-1)>c.maxEntryDrift){reject('entry_drift');continue;}
      if(openPaper(state,symbol,quote.ask,b.time,costs,{setup:policy.setup,strategy:policy.id,signalAt:row.bar.time,regime:row.legacy?regime(row.legacy,c):'unknown',researchOnly:true}))record(b.time,quote.bid);
      else reject('stake_or_budget');
    }
    if(state.position) {
      const p=state.position,candle=all[p.symbol][i],fill=candidateExit(p,candle,costs,policy);
      const lowEquity=state.cash+sale(p.qty,bidFromPrice(candle.low,costs),p.fee,p.slippage).proceeds;
      intrabarDrawdownBound=Math.max(intrabarDrawdownBound,1-lowEquity/peak);
      if(fill){const t=closePaper(state,fill.bid,fill.at,fill.reason);t.timing=fill.timing;t.ambiguous=!!fill.ambiguous;record(fill.at,null);}
      else if(policy.exit==='trailing')updateTrailingStop(p,bidFromPrice(candle.close,costs),c);
    }
    record(b.end,state.position?bidFromPrice(all[state.position.symbol][i].close,costs):null);
  }
  if(state.position){const b=all[state.position.symbol][end-1];closePaper(state,bidFromPrice(b.close,costs),b.end,'end_of_test');record(b.end,null);}
  let riskViolations=0;
  for(let i=0;i<state.trades.length;i++) {
    const prior=state.trades.slice(0,i),cash=c.initialBalance+prior.reduce((n,t)=>n+t.pnl,0),trade=state.trades[i];
    if(riskStatus({initialBalance:c.initialBalance,cash,trades:prior},trade.openedAt,c).blocked||trade.qty*trade.entry>cash*c.maxAllocation+1e-7||trade.cost>cash+1e-7)riskViolations++;
  }
  return {policy,from:bars[start].time,to:bars[end-1].end,costMultiplier,spreadMultiplier,delayBars,candidates,rejections,
    trades:state.trades,metrics:performance(state.trades,curve,c.initialBalance),netReturn:state.cash/c.initialBalance-1,
    riskViolations,intrabarDrawdownBound,drawdownHalt:!!state.risk?.drawdownHalt,fixedTradeStress:fixedTradeStress(state.trades),equityCurve:curve};
}

export function passiveBenchmark(bars,c,{from,to}={}) {
  const sample=bars.filter(b=>b.time>=from&&b.time<to),first=sample[0],last=sample.at(-1);
  const cost=c.initialBalance*c.maxAllocation,entry=askFromPrice(first.open,c)*(1+c.slippage),qty=cost/(1+c.fee)/entry;
  const cash=c.initialBalance-cost,curve=[{at:first.time,equity:c.initialBalance},...sample.map(b=>({at:b.end,equity:cash+sale(qty,bidFromPrice(b.close,c),c.fee,c.slippage).proceeds}))];
  const metrics=performance([],curve,c.initialBalance);
  return {from:first.time,to:last.end,netReturn:curve.at(-1).equity/c.initialBalance-1,maxDrawdown:metrics.maxDrawdown,
    note:'Passive reference with 20% initial capital committed, remaining cash idle; no rebalancing or active stop/loss gates. Exposure can drift. Entry and terminal exit costs included.'};
}
