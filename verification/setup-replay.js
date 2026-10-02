// Offline diagnostic, deliberately outside src/. It does not publish models or
// access an account. Model/evidence gates are OMITTED to measure the hypothesis,
// so its trades must never be described as deployable strategy performance.
import { features } from '../src/features.js';
import { alignedHistory } from '../src/data.js';
import { signal,regime,markRisk,riskStatus,freshQuote } from '../src/risk.js';
import { openPaper,closePaper } from '../src/engine.js';
import { askFromPrice,bidFromPrice,candleExit,sale } from '../src/execution.js';
import { performance } from '../src/performance.js';
import { counterTrendCandidate,researchRows } from './counter-trend.js';

export function setupReplay(all,c,{startAt,setup,costMultiplier=1}={}) {
  if(!['trend_following','counter_trend'].includes(setup))throw Error('Unknown research setup');
  const bars=alignedHistory(all,c.symbols),start=bars.findIndex(b=>b.time===startAt);
  if(start<299 || start>=bars.length-1)throw Error('Invalid research evaluation boundary');
  const rows=Object.fromEntries(c.symbols.map(s=>[s,researchRows(all[s],features(all[s]))]));
  const costs={...c,fee:c.fee*costMultiplier,slippage:c.slippage*costMultiplier,backtestSpread:c.backtestSpread*costMultiplier};
  const state={version:2,initialBalance:c.initialBalance,cash:c.initialBalance,enabled:true,position:null,trades:[],lastSignals:{},lastPoll:0};
  const curve=[],candidates=[],rejections={};
  const reject=reason=>{rejections[reason]=(rejections[reason]??0)+1;};
  const mark=(at,bid)=>{const p=state.position,equity=state.cash+(p?sale(p.qty,bid,p.fee,p.slippage).proceeds:0);markRisk(state,equity,c);curve.push({at,equity});};
  mark(startAt,null);
  for(let i=start;i<bars.length;i++) {
    const b=bars[i];
    for(const symbol of c.symbols) {
      const row=rows[symbol][i-1];
      // p=1 is a rules-only screen, NOT a fabricated model prediction.
      if(!(setup==='trend_following'?signal(row,1,c):counterTrendCandidate(row)))continue;
      candidates.push({symbol,at:b.time,signalAt:row.time,regime:regime(row,c)});
      if(state.position){reject('existing_exposure');continue;}
      const risk=riskStatus(state,b.time,c);if(risk.blocked){reject(risk.reason);continue;}
      const quote={ask:askFromPrice(all[symbol][i].open,costs),bid:bidFromPrice(all[symbol][i].open,costs),at:b.time};
      if(!freshQuote(quote,b.time,c)){reject('spread');continue;}
      if(Math.abs(quote.ask/row.close-1)>c.maxEntryDrift){reject('entry_drift');continue;}
      if(openPaper(state,symbol,quote.ask,b.time,costs,{setup,regime:regime(row,c),signalAt:row.time,researchOnly:true}))mark(b.time,quote.bid);
      else reject('stake_or_risk_budget');
    }
    if(state.position) {
      const p=state.position,fill=candleExit(p,all[p.symbol][i],costs);
      if(fill){const t=closePaper(state,fill.bid,fill.at,fill.reason);t.timing=fill.timing;t.ambiguous=!!fill.ambiguous;mark(fill.at,null);}
    }
    mark(b.end,state.position?bidFromPrice(all[state.position.symbol][i].close,costs):null);
  }
  if(state.position){const b=all[state.position.symbol].at(-1);closePaper(state,bidFromPrice(b.close,costs),b.end,'end_of_test');mark(b.end,null);}
  let lockViolations=0;
  for(let i=0;i<state.trades.length;i++) {
    const prior=state.trades.slice(0,i);
    if(riskStatus({initialBalance:c.initialBalance,cash:c.initialBalance+prior.reduce((n,t)=>n+t.pnl,0),trades:prior},state.trades[i].openedAt,c).blocked)lockViolations++;
  }
  return {setup,costMultiplier,from:startAt,to:bars.at(-1).end,candidates,rejections,trades:state.trades,
    metrics:performance(state.trades,curve,c.initialBalance),netReturn:state.cash/c.initialBalance-1,equityCurve:curve,lockViolations,
    warning:'Rules-only hypothesis diagnostic: model validation and score gates omitted; production counter-trend remains disabled.'};
}
