import { randomUUID } from 'node:crypto';
import { BAR,stakeSize,exitLevels,freshQuote,freshExitQuote,signal,riskStatus,markRisk,remainingRiskBudget } from './risk.js';
import { sale,quoteExit } from './execution.js';
import { modelReady } from './lifecycle.js';
import { tradeDecision } from './decision.js';
import { hash } from './provenance.js';
export { modelReady } from './lifecycle.js';
import { features } from './features.js';
import { predict } from './model.js';
import * as market from './market.js';
export function openPaper(s,symbol,ask,now,c,context={}) {
  if(!Number.isFinite(ask)||ask<=0||!Number.isFinite(now))return false;
  if(!s.enabled||s.position||riskStatus(s,now,c).blocked||!c.symbols.includes(symbol))return false;
  const budget=remainingRiskBudget(s,now,c);
  const stake=stakeSize(s.cash,s.cash,{...c,riskFraction:budget/s.cash});if(!stake)return false;
  const entry=ask*(1+c.slippage),qty=stake/entry,cost=stake*(1+c.fee);
  s.cash-=cost;
  s.position={id:randomUUID(),symbol,entry,qty,cost,entryFee:stake*c.fee,openedAt:now,...exitLevels(entry,c),fee:c.fee,slippage:c.slippage,expiresAt:now+c.horizon*BAR,context};
  s.lastPoll=now;
  return true;
}
export function closePaper(s,bid,now,reason) {
  const p=s.position;
  if(!p)return null;
  if(!Number.isFinite(bid)||bid<=0||!Number.isFinite(now)||now<p.openedAt)throw Error('Invalid close price/time');
  const {price,exitFee,proceeds}=sale(p.qty,bid,p.fee,p.slippage),pnl=proceeds-p.cost;
  s.cash+=proceeds;
  const t={...p,exit:price,closedAt:now,pnl,exitFee,fees:p.entryFee+exitFee,reason};
  s.trades.push(t);s.position=null;s.lastPoll=now;
  return t;
}
export class Engine {
  constructor(store,c,api=market) {this.store=store;this.c=c;this.api=api;this.busy=false;this.health={ok:false,message:'Waiting to start',at:0};this.markets={};}
  async closeNow(reason='manual') {
    if(this.busy)throw Error('A market update is in progress; try again in a moment.');
    this.busy=true;
    try{const s=this.store.read();if(!s.position)return;
      const q=await this.api.quote(s.position.symbol),now=Date.now();
      if(!freshExitQuote(q,now))throw Error('Exit quote stale or invalid');
      const t=this.store.change(state=>{const trade=closePaper(state,q.bid,now,reason);markRisk(state,state.cash,this.c);return trade;});
      this.store.event(`${reason}: ${t.symbol}, net P&L ${t.pnl.toFixed(4)} USDT`);
    } finally{this.busy=false;}
  }
  async tick() {
    if(this.busy)return;
    this.busy=true;
    try {
      let s=this.store.read();
      if(!s.enabled&&!s.position){this.health={ok:true,message:'Entries paused',at:Date.now()};return;}
      // Exits remain active when entries are paused or training/data checks fail.
      if(s.position) {
        const q=await this.api.quote(s.position.symbol),now=Date.now(),p=s.position;
        if(!freshExitQuote(q,now))throw Error('Exit quote stale or invalid');
        this.markets[p.symbol]={...this.markets[p.symbol],quote:q};
        let reason=null;
        reason=quoteExit(p,q.bid,now);
        if(!reason&&now-s.lastPoll>90_000)reason='recovery_quote';
        this.store.change(state=>{if(state.position?.id!==p.id)return;const equity=state.cash+sale(p.qty,q.bid,p.fee,p.slippage).proceeds;markRisk(state,equity,this.c);this.store.mark(now,{equity,estimated:false});if(reason)closePaper(state,q.bid,now,reason);state.lastPoll=now;});
        if(reason)this.store.event(`${p.symbol} exited: ${reason}${reason==='recovery_quote'?' (missed price path; current quote used)':''}`);
        s=this.store.read();
      }
      if(!s.enabled||s.position)return;
      const now=await this.api.exchangeTime(),offset=now-Date.now();
      const risk=riskStatus(s,now,this.c);
      if(risk.blocked){this.health={ok:true,message:risk.reason,at:Date.now()};return;}
      // Both markets must be healthy before opening either position.
      const snapshots=await Promise.all(this.c.symbols.map(async symbol=>{
        const [bars,q]=await Promise.all([this.api.recent(symbol,now),this.api.quote(symbol)]);
        const row=features(bars).at(-1),m=this.store.model(symbol),p=row&&m?predict(m,row.x):NaN;
        if(!row||now-row.end<0||now-row.end>BAR+120_000)throw Error(`${symbol}: stale or insufficient completed candles`);
        if(!freshQuote(q,Date.now(),this.c))throw Error(`${symbol}: spread too wide or quote stale`);
        return {symbol,row,q,m,p};
      }));
      for(const a of snapshots) {
        this.markets[a.symbol]={quote:a.q,close:a.row.close,score:Number.isFinite(a.p)?a.p:null,signal:signal(a.row,a.p,this.c),ready:!!modelReady(a.m,this.c,now),candleAt:a.row.time};
      }
      if(!snapshots.every(a=>freshQuote(a.q,Date.now(),this.c)))throw Error('A market snapshot expired while waiting for the other symbol');
      for(const {symbol,row,q} of snapshots) {
        const opened=this.store.change(state=>{
          if(state.lastSignals[symbol]>=row.time)return false;
          const localNow=Date.now(),currentNow=localNow+offset,m=this.store.model(symbol);
          const decision=tradeDecision({model:m,row,quote:q,state,now:currentNow,localNow,c:this.c});
          const decisionId=this.store.decision({at:localNow,symbol,signalAt:row.time,row,quote:q,modelId:m?.id??(m?hash(m):null),config:this.c,...decision});
          // Invalid transient snapshots can be retried; a valid evaluated candle is consumed once.
          if(!modelReady(m,this.c,currentNow)||!freshQuote(q,localNow,this.c)||currentNow-row.end>120000)return false;
          state.lastSignals[symbol]=row.time;
          if(!decision.trade)return false;
          return openPaper(state,symbol,q.ask,localNow,this.c,{decisionId,modelId:m.id,signalAt:row.time,regime:decision.marketRegime,setup:'trend_following',score:decision.score});
        });
        if(opened){this.store.event(`Paper entry: ${symbol}; decision recorded`);break;}
      }
      this.health={ok:true,message:snapshots.some(a=>!modelReady(a.m,this.c,now))?'Waiting for validated, fresh models':'Monitoring completed candles',at:Date.now()};
    }catch(e){this.health={ok:false,message:e.message,at:Date.now()};}
    finally{this.busy=false;}
  }
}
