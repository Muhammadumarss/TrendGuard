import { randomUUID } from 'node:crypto';
import { BAR,lockUntil,stakeSize,exitLevels,freshQuote,signal } from './risk.js';
import { signature } from './config.js';
import { features } from './features.js';
import { predict } from './model.js';
import * as market from './market.js';
export function openPaper(s,symbol,ask,now,c) {
  if(!Number.isFinite(ask)||ask<=0||!Number.isFinite(now))return false;
  if(!s.enabled||s.position||lockUntil(s.trades,now))return false;
  const stake=stakeSize(s.cash,s.cash,c);if(!stake)return false;
  const entry=ask*(1+c.slippage),qty=stake/entry,cost=stake*(1+c.fee);
  s.cash-=cost;
  s.position={id:randomUUID(),symbol,entry,qty,cost,entryFee:stake*c.fee,openedAt:now,...exitLevels(entry,c),fee:c.fee,slippage:c.slippage,expiresAt:now+c.horizon*BAR};
  s.lastPoll=now;
  return true;
}
export function closePaper(s,bid,now,reason) {
  const p=s.position;
  if(!p)return null;
  if(!Number.isFinite(bid)||bid<=0||!Number.isFinite(now)||now<p.openedAt)throw Error('Invalid close price/time');
  const price=bid*(1-p.slippage),gross=p.qty*price,exitFee=gross*p.fee,proceeds=gross-exitFee,pnl=proceeds-p.cost;
  s.cash+=proceeds;
  const t={...p,exit:price,closedAt:now,pnl,exitFee,fees:p.entryFee+exitFee,reason};
  s.trades.push(t);s.position=null;s.lastPoll=now;
  return t;
}
export function modelReady(m,c,now) {
  return m && m.signature===signature(c) && m.version===2 && m.validation?.passed===true && Number.isFinite(m.trainedAt) && now>=m.trainedAt && now-m.trainedAt<=c.modelMaxAgeHours*3600_000 && now>=m.dataThrough && now-m.dataThrough<=c.modelMaxAgeHours*3600_000;
}
export class Engine {
  constructor(store,c,api=market) {this.store=store;this.c=c;this.api=api;this.busy=false;this.health={ok:false,message:'Waiting to start',at:0};this.markets={};}
  async closeNow(reason='manual') {
    if(this.busy)throw Error('A market update is in progress; try again in a moment.');
    this.busy=true;
    try{const s=this.store.read();if(!s.position)return;
      const q=await this.api.quote(s.position.symbol);
      const t=this.store.change(state=>closePaper(state,q.bid,Date.now(),reason));
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
        this.markets[p.symbol]={...this.markets[p.symbol],quote:q};
        let reason=null;
        if(q.bid<=p.stop)reason='stop_loss';else if(q.bid>=p.target)reason='take_profit';else if(now>=p.expiresAt)reason='time_barrier';
        else if(now-s.lastPoll>90_000)reason='recovery_quote';
        this.store.change(state=>{if(state.position?.id!==p.id)return;if(reason)closePaper(state,q.bid,now,reason);state.lastPoll=now;});
        if(reason)this.store.event(`${p.symbol} exited: ${reason}${reason==='recovery_quote'?' (missed price path; current quote used)':''}`);
        s=this.store.read();
      }
      if(!s.enabled||s.position)return;
      const now=await this.api.exchangeTime();
      if(lockUntil(s.trades,now)){this.health={ok:true,message:'Daily loss lock active: two losing trades in one UTC day',at:Date.now()};return;}
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
      for(const {symbol,row,q,m,p} of snapshots) {
        if(!modelReady(m,this.c,now)||now-row.end>120_000)continue;
        const opened=this.store.change(state=>{
          if(state.lastSignals[symbol]>=row.time)return false;
          state.lastSignals[symbol]=row.time;
          if(!signal(row,p,this.c)||Math.abs(q.ask/row.close-1)>this.c.maxEntryDrift)return false;
          return openPaper(state,symbol,q.ask,Date.now(),this.c);
        });
        if(opened){this.store.event(`Paper entry: ${symbol}; model score ${p.toFixed(3)}`);break;}
      }
      this.health={ok:true,message:snapshots.some(a=>!modelReady(a.m,this.c,now))?'Waiting for validated, fresh models':'Monitoring completed candles',at:Date.now()};
    }catch(e){this.health={ok:false,message:e.message,at:Date.now()};}
    finally{this.busy=false;}
  }
}
