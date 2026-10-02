import { acceptedModel } from '../verification/accepted-model-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config,signature,validateConfig } from '../src/config.js';
import { Store } from '../src/store.js';
import { features,FEATURE_WINDOW,labelOutcome } from '../src/features.js';
import { BAR,regime,riskStatus,markRisk,stakeSize,exitLevels } from '../src/risk.js';
import { Engine,openPaper,closePaper } from '../src/engine.js';
import { predict } from '../src/model.js';
import { tradeDecision } from '../src/decision.js';
import { parseBars } from '../src/market.js';
import { validateBars } from '../src/data.js';
import { candleExit,sale,askFromPrice } from '../src/execution.js';
import { performance,fixedTradeStress } from '../src/performance.js';
import { calibrate,predictionMetrics,blockInterval,economicEvidence } from '../src/statistics.js';
import { trainingDue,trainingWindow,modelReady } from '../src/lifecycle.js';
import { backtest } from '../src/backtest.js';
import { trainModel } from '../src/training.js';

function candles(n=400,end=n*BAR) {
 return Array.from({length:n},(_,i)=>{const close=100+i*.1;return {time:end-(n-i)*BAR,end:end-(n-i-1)*BAR-1,open:close-.04,close,high:close+.01,low:close-.08,volume:i%3?200:100};});
}
const accepted=acceptedModel;
function fixture(t) {
 let now=Date.UTC(2026,8,25,12,0,10);t.mock.method(Date,'now',()=>now);
 const start=now,b=candles(300,Math.floor(now/BAR)*BAR);b.at(-1).volume=1000;
 const st=new Store(':memory:');st.change(s=>{s.enabled=true;});for(const s of config.symbols)st.putModel(s,accepted(config,now));
 const q={bid:b.at(-1).close,ask:b.at(-1).close+.001,at:now};
 return {st,start,b,q,setNow:v=>{now=v;},api:{exchangeTime:async()=>now,recent:async()=>b,quote:async()=>({...q})}};
}
test('H1 exact rolling/prefix feature parity with a non-null warmup boundary',()=>{
 const b=candles(700),full=features(b);assert.equal(full[FEATURE_WINDOW-2],null);assert.ok(full[FEATURE_WINDOW-1]);
 for(const i of [298,299,350,600,699])assert.deepEqual(features(b.slice(i-298,i+1)).at(-1),full[i]);
 const future=b.map((r,i)=>i>400?{...r,close:1000}:r);assert.deepEqual(features(future)[400],full[400]);
});
test('H3 delayed second symbol cannot fill first stale quote or expired signal',async t=>{
 const f=fixture(t);f.api.recent=async s=>{if(s==='ETHUSDT'){await new Promise(r=>setImmediate(r));f.setNow(f.start+140000);f.q.at=f.start+140000;}return f.b;};
 await new Engine(f.st,config,f.api).tick();assert.equal(f.st.read().position,null);f.st.close();
});
test('H3 newly rejected model replaces an earlier accepted snapshot before entry',async t=>{
 const f=fixture(t);f.api.recent=async s=>{if(s==='ETHUSDT'){await new Promise(r=>setImmediate(r));for(const symbol of config.symbols)f.st.putModel(symbol,{...accepted(config,f.start),validation:{passed:false}});}return f.b;};
 await new Engine(f.st,config,f.api).tick();assert.equal(f.st.read().position,null);f.st.close();
});
test('H3 one expired market also blocks entry on the other fresh market',async t=>{
 const f=fixture(t);f.api.quote=async s=>{if(s==='ETHUSDT'){await new Promise(r=>setImmediate(r));f.setNow(f.start+20000);return {...f.q,at:f.start+20000};}return {...f.q};};
 const e=new Engine(f.st,config,f.api);await e.tick();assert.equal(f.st.read().position,null);assert.match(e.health.message,/expired/);f.st.close();
});
test('H4 missing fee/expiry and negative qty roll back before corrupting state',()=>{
 const st=new Store(':memory:');st.change(s=>{s.enabled=true;openPaper(s,'BTCUSDT',100,1,config);});const before=st.read();
 for(const k of ['fee','slippage','expiresAt','entryFee'])assert.throws(()=>st.change(s=>{delete s.position[k];}),/Invalid/);
 assert.throws(()=>st.change(s=>s.position.qty=-1),/Invalid/);assert.deepEqual(st.read(),before);st.close();
});
test('H4 post-mutation NaN, cash conservation and duplicate history cannot commit',()=>{
 const st=new Store(':memory:');assert.throws(()=>st.change(s=>s.cash=NaN));assert.throws(()=>st.change(s=>s.cash++));
 st.change(s=>{s.enabled=true;openPaper(s,'ETHUSDT',100,1,config);closePaper(s,101,2,'test');});
 assert.throws(()=>st.change(s=>s.trades.push(s.trades[0])));assert.ok(Number.isFinite(st.read().cash));st.close();
});
test('M6 raw malformed terminal timestamps are rejected before filtering',()=>{
 const b=[0,'100','101','99','100','1',BAR-1];
 for(const value of [NaN,null,'',undefined])assert.throws(()=>parseBars([[...b.slice(0,6),value]],BAR));
 assert.throws(()=>parseBars([[1,'100','101','99','100','1',BAR]],BAR*2));
 for(const invalid of [0,-1])assert.throws(()=>validateBars([{...candles(1)[0],low:invalid}]));
 assert.throws(()=>validateBars([...candles(2)].reverse()));assert.throws(()=>validateBars([candles(1)[0],candles(1)[0]]));
});
test('M4 one-asset and both-asset gaps are rejected by backtest',()=>{
 const b=candles(3500),missing=b.filter((_,i)=>i!==3300),c={...config,trainingDays:30};
 assert.throws(()=>backtest({BTCUSDT:missing,ETHUSDT:b},c),/gaps/);
 assert.throws(()=>backtest({BTCUSDT:missing,ETHUSDT:missing},c),/gaps/);
 assert.throws(()=>backtest({BTCUSDT:b,ETHUSDT:b.slice(1)},c),/identical/);
});
test('Labels and execution share spread, stop-first, timeout and exact net return',()=>{
 const b=Array.from({length:40},(_,i)=>({time:i*BAR,end:(i+1)*BAR-1,open:100,high:100.1,low:99.9,close:100,volume:1}));
 const entry=askFromPrice(100,config)*(1+config.slippage),p={...exitLevels(entry,config),expiresAt:(1+config.horizon)*BAR};
 b[1].high=110;b[1].low=90;const fill=candleExit(p,b[1],config),label=labelOutcome(b,0,config);
 assert.equal(label.outcome,'stop_loss');assert.equal(fill.ambiguous,true);assert.equal(label.netReturn,sale(1,fill.bid,config.fee,config.slippage).proceeds/(entry*(1+config.fee))-1);
 b[1].high=100.1;b[1].low=99.9;assert.equal(labelOutcome(b,0,config).outcome,'time_barrier');
 b[25].open=110;b[25].high=110;b[25].close=110;assert.equal(labelOutcome(b,0,config).y,0);assert.equal(candleExit(p,b[25],config).at,b[25].time);
});
test('A profitable timeout remains TP-negative and carries its actual payoff',()=>{
 const b=Array.from({length:40},(_,i)=>({time:i*BAR,end:(i+1)*BAR-1,open:i===25?101:100,high:101,low:99.9,close:100,volume:1}));
 const label=labelOutcome(b,0,config);assert.equal(label.y,0);assert.equal(label.outcome,'time_barrier');assert.ok(label.netReturn>0);
});
test('Risk money budgets, weekly periods, drawdown latch and cross-day streaks',()=>{
 const now=Date.UTC(2026,8,25,12),base={initialBalance:1000,cash:990,trades:[{pnl:-10,closedAt:now-1}]};assert.match(riskStatus(base,now,config).reason,/Daily monetary/);
 const weekly={initialBalance:1000,cash:970,trades:[{pnl:-30,closedAt:now-86400000}]};assert.match(riskStatus(weekly,now,config).reason,/Weekly/);
 const s={initialBalance:1000,cash:1000,trades:[]};markRisk(s,899,config);markRisk(s,1100,config);assert.match(riskStatus(s,now,config).reason,/Drawdown/);
 const streak={initialBalance:1000,cash:999.6,trades:Array.from({length:4},(_,i)=>({pnl:-.1,closedAt:now-(3-i)*86400000-1}))};assert.match(riskStatus(streak,now,config).reason,/Consecutive/);
});
test('High confidence cannot bypass exposure, risk, evidence or invalid score',()=>{
 const now=400*BAR,b=candles(400),row=features(b).at(-1);row.volume=1000;const m=accepted(config,now),s={initialBalance:1000,cash:1000,enabled:true,position:null,trades:[]},q={bid:row.close,ask:row.close+.001,at:now};
 const check=(state=s,model=m)=>tradeDecision({model,row,quote:q,state,now,c:config});
 assert.equal(check().trade,true);assert.equal(check({...s,position:{}}).trade,false);assert.equal(check({...s,risk:{drawdownHalt:true}}).trade,false);
 assert.equal(check(s,{...m,validation:{passed:true}}).trade,false);assert.equal(check(s,{...m,base:NaN}).trade,false);
 assert.equal(openPaper({...s,position:{}},'BTCUSDT',100,now,config),false);assert.equal(openPaper({...s},'SHORT',100,now,config),false);
});
test('Financial conservation and exact net target across prices and fees',()=>{
 for(const ask of [.01,100,60000])for(const fee of [0,.001,.01]){
  const c={...config,fee},s={initialBalance:1000,cash:1000,enabled:true,trades:[],position:null};assert.ok(openPaper(s,'BTCUSDT',ask,1,c));const p=s.position;
  assert.ok(p.cost<=1000*c.maxAllocation*(1+c.fee));assert.equal(openPaper(s,'ETHUSDT',ask,2,c),false);
  const t=closePaper(s,p.target,3,'take_profit');assert.ok(Math.abs(t.pnl/p.cost-c.takeProfit)<1e-12);assert.ok(Math.abs(s.cash-1000-t.pnl)<1e-9);
 }
 assert.equal(stakeSize(0,0,config),0);assert.equal(stakeSize(-1,10,config),0);
});
test('Calibration never pretends insufficient classes are supported',()=>{
 const m=accepted(config,1),rows=Array.from({length:150},()=>({x:Array(8).fill(0),y:0}));assert.equal(calibrate(m,rows).status,'insufficient_class_coverage');
 const r=predictionMetrics(m,rows);assert.equal(r.precision,0);assert.equal(r.recall,null);assert.ok(r.ece>.7);
 assert.equal(economicEvidence(m,[],config).supported,false);assert.equal(blockInterval([1,2],25).lower,null);
});
test('Calibration on independent synthetic outcomes improves an overconfident score',()=>{
 const m=accepted(config,1),rows=Array.from({length:400},(_,i)=>({x:Array(8).fill(0),y:i%5===0?1:0}));
 const calibrated={...m,calibration:calibrate(m,rows)};assert.ok(Math.abs(predict(calibrated,rows[0].x)-.2)<Math.abs(predict(m,rows[0].x)-.2));
});
test('Regime description is finite for very low/high volatility, without future inputs',()=>{
 const r=features(candles()).at(-1);assert.match(regime(r,config),/low_volatility/);r.x[3]=.2;assert.match(regime(r,config),/high_volatility/);
 assert.ok(Number.isNaN(predict({...accepted(config,1),trees:[{feature:9}]},r.x)));
});
test('Lifecycle uses exact rolling training history and expires stale models',()=>{
 const b=candles(6000),now=b.at(-1).end+1,w=trainingWindow(b,config,now);assert.equal(w.length,5760);assert.ok(w.every(r=>r.end<now));
 const m=accepted(config,now);assert.equal(trainingDue(m,config,now+12*3600000),true);assert.equal(modelReady(m,config,now+24*3600000+1),false);
 assert.throws(()=>validateConfig({...config,dailyLossFraction:NaN}));
});
test('Backtest cadence, latency, bounded history and failed-training fallback',()=>{
 const b=candles(3500),c={...config,trainingDays:30},calls=[];
 const trainer=(history,c,now)=>{calls.push(now);assert.equal(history.length,2880);assert.ok(history.at(-1).end<now);return accepted(c,now);};
 const r=backtest({BTCUSDT:b,ETHUSDT:b},c,{trainer});assert.ok(calls.length>2);assert.equal(calls[2]-calls[0],12*3600000);
 assert.equal(r.decisions[0].trade,false);assert.ok(r.folds.every(f=>f.availableAt-f.time===BAR));assert.equal(r.equityCurve.at(-1).equity,r.endingBalance);
 const failed=backtest({BTCUSDT:b,ETHUSDT:b},c,{trainer:()=>{throw Error('download failure');}});assert.equal(failed.trades.length,0);assert.match(failed.folds[0].error,/download/);
});
test('Final holdout cannot alter calibration, selection, or fitted trees',()=>{
 const b=candles(2400);for(let i=0;i<b.length;i++){b[i].high=b[i].close*(Math.floor(i/60)%2?1.04:1.001);b[i].low=b[i].open*(Math.floor(i/60)%2?.995:.97);}
 const now=b.at(-1).end+1,m=trainModel(b,config,now),changed=b.map(r=>r.time>=m.validation.validationFirstSignal?{...r,high:r.high*1.2,low:r.low*.8}:r),other=trainModel(changed,config,now);
 assert.deepEqual(m.calibration,other.calibration);assert.deepEqual(m.trees,other.trees);assert.deepEqual(m.selection,other.selection);
 assert.deepEqual(m.featureDomain,other.featureDomain);
 assert.ok(m.validation.trainLastSignal+25*BAR<m.validation.calibrationFirstSignal);assert.ok(m.validation.calibrationLastSignal+25*BAR<m.validation.validationFirstSignal);
});
test('Terminal liquidation and undefined ratios are represented honestly',()=>{
 const p=performance([],[{at:0,equity:1000},{at:BAR,equity:990}],1000);assert.ok(Math.abs(p.maxDrawdown-.01)<1e-10);assert.equal(p.winRate,null);assert.equal(p.sharpe,null);assert.equal(p.sortino,null);
 assert.equal(performance([],[{at:0,equity:1000},{at:BAR,equity:1000}],1000).calmar,null);assert.equal(fixedTradeStress([]).netPnl,0);
});
test('Backtest final-entry liquidation updates balance/equity and handles ambiguous first candle',()=>{
 const b=candles(3500);for(const r of b)r.volume=100;b.at(-2).volume=1000;
 const c={...config,trainingDays:30},trainer=(history,c,now)=>accepted(c,now);
 const result=backtest({BTCUSDT:b,ETHUSDT:b},c,{trainer});
 assert.equal(result.trades.length,1);assert.equal(result.trades[0].reason,'end_of_test');assert.ok(result.netPnl<0);assert.ok(result.maxDrawdown>0);
 assert.equal(result.equityCurve.at(-1).equity,result.endingBalance);assert.equal(result.trades[0].closedAt,b.at(-1).end);
 const changed=b.map(r=>({...r}));changed.at(-1).high*=1.1;changed.at(-1).low*=.9;
 const ambiguous=backtest({BTCUSDT:changed,ETHUSDT:changed},c,{trainer});assert.equal(ambiguous.trades[0].reason,'stop_loss');assert.equal(ambiguous.trades[0].ambiguous,true);
});
test('Remaining monetary budget reduces stake before a permitted entry',()=>{
 const now=Date.UTC(2026,8,25,12),s={initialBalance:1000,cash:995.1,enabled:true,position:null,trades:[{pnl:-4.9,closedAt:now-1}]};
 assert.equal(openPaper(s,'BTCUSDT',100,now,config),false); // Remaining 0.10 risk cannot fund minimum stake.
 const other={...s,cash:996,trades:[{pnl:-4,closedAt:now-1}]};assert.ok(openPaper(other,'BTCUSDT',100,now,config));assert.ok(other.position.cost<80);
 const legacy={initialBalance:1000,cash:800,trades:[{pnl:-200,closedAt:now-10*86400000}]};assert.match(riskStatus(legacy,now,config).reason,/drawdown/);
});
test('Entry boundaries, unsupported regimes, and same-candle restart suppression',async t=>{
 const f=fixture(t),e=new Engine(f.st,config,f.api);await e.tick();assert.ok(f.st.read().position);
 f.st.change(s=>closePaper(s,f.q.bid,f.start+1,'test'));f.setNow(f.start+2);await new Engine(f.st,config,f.api).tick();
 // Both pairs can have separate signals: consume ETH too, then neither repeats.
 if(f.st.read().position)f.st.change(s=>closePaper(s,f.q.bid,f.start+3,'test'));
 f.setNow(f.start+4);await new Engine(f.st,config,f.api).tick();assert.equal(f.st.read().position,null);f.st.close();
 const row=features(f.b).at(-1),m=accepted(config,f.start),state={initialBalance:1000,cash:1000,enabled:true,position:null,trades:[]};
 const call=(now,q=f.q)=>tradeDecision({model:m,row,quote:q,state,now,c:config});
 assert.equal(call(row.end+120001,{...f.q,at:row.end+120001}).trade,false);
 assert.equal(call(f.start+15001).trade,false);assert.equal(call(f.start,{...f.q,ask:f.q.bid*1.1}).trade,false);
});
test('Raw corrupt persistent state is rejected on read and trade archive is immutable',()=>{
 const st=new Store(':memory:');st.change(s=>{s.enabled=true;openPaper(s,'BTCUSDT',100,1,config);closePaper(s,101,2,'test');});
 assert.throws(()=>st.change(s=>{s.trades[0].reason='rewritten';}),/immutable/);
 const s=st.read();s.lastPoll=null;st.db.prepare('UPDATE state SET body=?').run(JSON.stringify(s));assert.throws(()=>st.read(),/invalid/);st.close();
});
test('Model/decision/trade provenance survives restart and lease excludes second server',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'tg-audit-')),file=path.join(dir,'paper.sqlite');let a=new Store(file),b=new Store(file);
 try{a.acquireLease();assert.throws(()=>b.acquireLease(),/Another server/);a.putModel('BTCUSDT',accepted(config,1));a.putModel('BTCUSDT',{...accepted(config,2),id:'second'});
 a.change(s=>{s.enabled=true;const id=a.decision({at:1,symbol:'BTCUSDT',score:.8});openPaper(s,'BTCUSDT',100,1,config,{decisionId:id});closePaper(s,101,2,'test');});
 assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM model_archive').get().n,2);a.close();a=new Store(file);assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM decisions').get().n,1);assert.equal(a.db.prepare('SELECT COUNT(*) AS n FROM trade_archive').get().n,1);b.acquireLease();
 }finally{a.close();b.close();rmSync(dir,{recursive:true});}
});
