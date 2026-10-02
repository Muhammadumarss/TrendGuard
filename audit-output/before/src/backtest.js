import { BAR,lockUntil,signal } from './risk.js';
import { features } from './features.js';
import { predict } from './model.js';
import { trainModel } from './training.js';
import { openPaper,closePaper } from './engine.js';
export function backtest(all,c,{costMultiplier=1}={}) {
  const symbols=Object.keys(all);
  const sets=Object.fromEntries(symbols.map(s=>[s,new Set(all[s].map(b=>b.time))]));
  const common=all[symbols[0]].map(b=>b.time).filter(t=>symbols.every(s=>sets[s].has(t)));
  if(common.length<3500)throw Error('Backtest needs at least 3500 aligned candles per symbol; run training/data download first.');
  const bySymbol=Object.fromEntries(symbols.map(s=>[s,new Map(features(all[s]).filter(Boolean).map(r=>[r.time,r]))]));
  const start=Math.floor(common.length*.65),window=7*24*4;
  const state={initialBalance:c.initialBalance,cash:c.initialBalance,enabled:true,position:null,trades:[],lastPoll:0};
  const costs={...c,fee:c.fee*costMultiplier,slippage:c.slippage*costMultiplier};
  let models={},peak=c.initialBalance,maxDrawdown=0,folds=[],violations=0;
  for(let i=start;i<common.length;i++) {
    const time=common[i];
    if((i-start)%window===0) {
      models={};const fold={time,models:{}};
      for(const s of symbols) {
        const historical=all[s].filter(b=>b.time<time),m=trainModel(historical,c,time);
        fold.models[s]={...m.validation,selection:m.selection};
        if(m.validation.passed)models[s]=m;
      }
      folds.push(fold);
    }
    // Existing positions are processed on this candle. Gaps fill at opening price;
    // ambiguous high/low ordering assumes stop first. Expiry exits at open.
    if(state.position) {
      const p=state.position,b=bySymbol[p.symbol].get(time);
      let price,reason;
      if(b.open<=p.stop){price=b.open;reason='gap_stop';}
      else if(time>=p.expiresAt){price=b.open;reason='time_barrier';}
      else if(b.open>=p.target){price=b.open;reason='gap_target';}
      else if(b.low<=p.stop){price=p.stop;reason='stop_loss';}
      else if(b.high>=p.target){price=p.target;reason='take_profit';}
      if(reason)closePaper(state,price,time+BAR-1,reason);
    }
    const p=state.position,mark=p?bySymbol[p.symbol].get(time)?.close:0;
    const equity=state.cash+(p?p.qty*(mark||p.entry)*(1-p.fee)*(1-p.slippage):0);
    peak=Math.max(peak,equity);maxDrawdown=Math.max(maxDrawdown,1-equity/peak);
    if(i<common.length-1&&!state.position&&!lockUntil(state.trades,time+BAR)) {
      for(const s of symbols) {
        const row=bySymbol[s].get(time),m=models[s];
        if(!row||!m||!signal(row,predict(m,row.x),c))continue;
        const next=bySymbol[s].get(common[i+1]);
        if(!next||Math.abs(next.open/row.close-1)>c.maxEntryDrift)continue;
        if(openPaper(state,s,next.open,time+BAR,costs))break;
      }
    }
  }
  if(state.position){const p=state.position,b=all[p.symbol].at(-1);closePaper(state,b.close,b.end,'end_of_test');}
  let until=0;
  const dailyLosses=new Map();
  for(const t of state.trades){
    if(t.openedAt<until)violations++;
    if(t.pnl<0){
      const d=new Date(t.closedAt),reset=Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()+1,0,5);
      const count=(dailyLosses.get(reset)||0)+1;dailyLosses.set(reset,count);
      if(count>=2)until=Math.max(until,reset);
    }
  }
  const gains=state.trades.reduce((n,t)=>n+Math.max(0,t.pnl),0),losses=-state.trades.reduce((n,t)=>n+Math.min(0,t.pnl),0);
  return {version:2,mode:'historical simulation',createdAt:Date.now(),costMultiplier,from:common[start],to:common.at(-1),trades:state.trades,netPnl:state.cash-c.initialBalance,endingBalance:state.cash,maxDrawdown,profitFactor:losses?gains/losses:null,lockViolations:violations,folds,note:'15-minute OHLC approximation; no order book or partial fills. Zero trades do not validate a strategy.'};
}
