import { BAR,markRisk,riskStatus } from './risk.js';
import { features } from './features.js';
import { trainModel } from './training.js';
import { openPaper,closePaper } from './engine.js';
import { trainingWindow,trainingDue } from './lifecycle.js';
import { alignedHistory } from './data.js';
import { askFromPrice,bidFromPrice,candleExit,sale } from './execution.js';
import { tradeDecision } from './decision.js';
import { performance,fixedTradeStress } from './performance.js';
import { provenance } from './provenance.js';

export function backtest(all,c,{costMultiplier=1,startAt=null,trainer=trainModel,modelSchedule=null}={}) {
  const symbols=c.symbols,bars=alignedHistory(all,symbols);
  if(bars.length<3500)throw Error('Backtest needs at least 3500 aligned candles per symbol');
  const warmup=c.trainingDays*96;
  const start=startAt===null?Math.max(Math.floor(bars.length*.65),warmup):bars.findIndex(b=>b.time===startAt);
  if(start<warmup||start>=bars.length-1)throw Error('Insufficient complete rolling training history before evaluation period');
  const rows=Object.fromEntries(symbols.map(s=>[s,features(all[s])]));
  const state={version:2,initialBalance:c.initialBalance,cash:c.initialBalance,enabled:true,position:null,trades:[],lastSignals:{},lastPoll:0};
  const costs={...c,fee:c.fee*costMultiplier,slippage:c.slippage*costMultiplier,backtestSpread:c.backtestSpread*costMultiplier};
  const models={},pending={},attempts={},folds=[],equityCurve=[],decisions=[],schedule=[];
  let intrabarDrawdownBound=0,peak=c.initialBalance;
  const record=(at,bid)=>{
    const p=state.position,equity=state.cash+(p?sale(p.qty,bid,p.fee,p.slippage).proceeds:0);
    markRisk(state,equity,c);peak=Math.max(peak,equity);equityCurve.push({at,equity});
  };
  record(bars[start].time,null);
  for(let i=start;i<bars.length;i++) {
    const b=bars[i],now=b.time;
    for(const s of symbols) {
      if(pending[s]?.availableAt<=now){if(pending[s].model)models[s]=pending[s].model;delete pending[s];}
      if(!pending[s]&&trainingDue(models[s],c,now)&&(!attempts[s]||now-attempts[s]>=3600000)) {
        attempts[s]=now;
        const cached=modelSchedule?.find(r=>r.symbol===s&&r.time===now);
        let m=null,error=null;
        try {if(modelSchedule&&!cached)throw Error('Missing frozen model schedule');if(cached?.error)throw Error(cached.error);m=cached?cached.model:trainer(trainingWindow(all[s],c,now),c,now);}
        catch(e){error=e.message;}
        const availableAt=now+c.trainingLatencyBars*BAR;
        pending[s]={availableAt,model:m};schedule.push({symbol:s,time:now,availableAt,model:m,error});
        folds.push({time:now,symbol:s,availableAt,validation:m?.validation??null,error});
      }
    }
    if(!state.position)for(const s of symbols) {
      const row=rows[s][i-1],quote={bid:bidFromPrice(all[s][i].open,costs),ask:askFromPrice(all[s][i].open,costs),at:now};
      const decision=tradeDecision({model:models[s],row,quote,state,now,c});
      decisions.push({symbol:s,at:now,signalAt:row?.time,modelId:models[s]?.id??null,...decision});
      if(decision.trade&&openPaper(state,s,quote.ask,now,costs,{modelId:models[s].id,signalAt:row.time,regime:decision.marketRegime,score:decision.score})) {record(now,quote.bid);break;}
    }
    if(state.position) {
      const p=state.position,candle=all[p.symbol][i],fill=candleExit(p,candle,costs);
      const lowEquity=state.cash+sale(p.qty,bidFromPrice(candle.low,costs),p.fee,p.slippage).proceeds;
      intrabarDrawdownBound=Math.max(intrabarDrawdownBound,1-lowEquity/peak);
      if(fill) {const t=closePaper(state,fill.bid,fill.at,fill.reason);t.timing=fill.timing;t.ambiguous=!!fill.ambiguous;record(fill.at,null);}
    }
    const p=state.position;record(b.end,p?bidFromPrice(all[p.symbol][i].close,costs):null);
  }
  if(state.position){const p=state.position,b=all[p.symbol].at(-1);closePaper(state,bidFromPrice(b.close,costs),b.end,'end_of_test');record(b.end,null);}
  const result=performance(state.trades,equityCurve,c.initialBalance);
  let lockViolations=0;
  for(let i=0;i<state.trades.length;i++){const prior=state.trades.slice(0,i),t=state.trades[i];if(riskStatus({initialBalance:c.initialBalance,cash:c.initialBalance+prior.reduce((s,r)=>s+r.pnl,0),trades:prior},t.openedAt,c).blocked)lockViolations++;}
  return {version:3,mode:'historical OHLC simulation',createdAt:Date.now(),costMultiplier,from:bars[start].time,to:bars.at(-1).end,trades:state.trades,netPnl:state.cash-c.initialBalance,endingBalance:state.cash,maxDrawdown:result.maxDrawdown,profitFactor:result.profitFactor,metrics:result,intrabarDrawdownBound,lockViolations,folds,equityCurve,decisions,modelSchedule:schedule,fixedTradeStress:fixedTradeStress(state.trades),provenance:provenance(c,all),assumptions:{spread:costs.backtestSpread,trainingLatencyBars:c.trainingLatencyBars,entry:'next open after a completed signal; no within-bar latency path available',intrabar:'stop first; interval-censored exits booked at candle end',stress:'Resimulation changes spread/fees/slippage, stake and target; labels remain base-cost'},note:'No quote/depth/partial-fill replay. No trades is not profitability evidence. Current audited history is not an untouched test.'};
}
