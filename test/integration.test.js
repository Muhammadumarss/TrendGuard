import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { config,signature } from '../src/config.js';
import { Store } from '../src/store.js';
import { createApp } from '../src/server.js';
import { Engine,openPaper } from '../src/engine.js';
import { BAR } from '../src/risk.js';
import { trainModel,fitWithTuning } from '../src/training.js';
import { backtest } from '../src/backtest.js';
function trendBars(now) {
 const end=Math.floor(now/BAR)*BAR;
 return Array.from({length:300},(_,i)=>{const close=100+i*.1;return {time:end-(300-i)*BAR,end:end-(299-i)*BAR-1,open:close-.05,close,high:close+.02,low:close-.08,volume:i===299?1000:100};});
}
function fixture(now) {
 const st=new Store(':memory:');st.change(s=>{s.enabled=true;});
 const b=trendBars(now),q={bid:b.at(-1).close,ask:b.at(-1).close+.001,at:now};
 for(const symbol of config.symbols)st.putModel(symbol,{version:2,base:Math.log(4),trees:[],rate:.08,signature:signature(config),trainedAt:now,dataThrough:now-1000,validation:{passed:true}});
 const api={exchangeTime:async()=>now,recent:async()=>b,quote:async()=>q};
 return {st,q,api};
}
test('Engine opens only one paper position even with simultaneous ticks',async t=>{
 const now=Date.UTC(2026,8,21,12,0,10);t.mock.method(Date,'now',()=>now);
 const {st,api}=fixture(now),e=new Engine(st,config,api);
 await Promise.all([e.tick(),e.tick()]);assert.ok(st.read().position);assert.equal(st.read().position.symbol,'BTCUSDT');assert.ok(st.read().cash<1000);st.close();
});
test('Exits continue while entries are paused; loss blocks both pairs',async t=>{
 const now=Date.UTC(2026,8,21,12,0,10);t.mock.method(Date,'now',()=>now);
 const {st,api,q}=fixture(now),e=new Engine(st,config,api);
 st.change(s=>{openPaper(s,'BTCUSDT',100,now-30_000,config);s.enabled=false;});
 q.bid=98;q.ask=98.01;
 await e.tick();assert.equal(st.read().position,null);assert.equal(st.read().trades.length,1);assert.ok(st.read().trades[0].pnl<0);
 st.change(s=>{s.enabled=true;});await e.tick();assert.equal(st.read().position,null);assert.match(e.health.message,/loss lock/);st.close();
});
test('Stale data and network failure produce no entry',async t=>{
 const now=Date.UTC(2026,8,21,12,0,10);t.mock.method(Date,'now',()=>now);
 const {st,api}=fixture(now),e=new Engine(st,config,api);
 api.recent=async()=>trendBars(now-3*BAR);await e.tick();assert.equal(st.read().position,null);assert.equal(e.health.ok,false);
 api.recent=async()=>{throw Error('offline');};await e.tick();assert.equal(st.read().position,null);assert.match(e.health.message,/offline/);st.close();
});
test('A paused position after downtime is reconciled at a current paper quote',async t=>{
 const now=Date.UTC(2026,8,21,12,0,10);t.mock.method(Date,'now',()=>now);
 const {st,api,q}=fixture(now),e=new Engine(st,config,api);
 st.change(s=>{openPaper(s,'BTCUSDT',100,now-300_000,config);s.enabled=false;});q.bid=100.1;q.ask=100.11;
 await e.tick();assert.equal(st.read().position,null);assert.equal(st.read().trades[0].reason,'recovery_quote');st.close();
});
test('Express serves dashboard; mutation requires token and same origin',async()=>{
 const st=new Store(':memory:'),engine=new Engine(st,config),app=createApp(st,engine);
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
 const headers={host:`localhost:${config.port}`};
 try {
  const home=await fetch(url,{headers});assert.equal(home.status,200);assert.match(await home.text(),/TrendGuard/);
  const r=await fetch(url+'/api/status',{headers}),d=await r.json();assert.equal(d.mode,'paper');assert.equal(d.totalTrades,0);
  assert.equal((await fetch(url+'/api/start',{method:'POST',headers})).status,403);
  assert.equal((await fetch(url+'/api/start',{method:'POST',headers:{...headers,'X-Trendguard-Token':d.token,origin:'https://evil.example'}})).status,403);
  assert.equal((await fetch(url+'/api/start',{method:'POST',headers:{...headers,'X-Trendguard-Token':d.token}})).status,200);assert.equal(st.read().enabled,true);
  assert.equal((await fetch(url+'/api/pause',{method:'POST',headers:{...headers,'X-Trendguard-Token':d.token}})).status,200);assert.equal(st.read().enabled,false);
  const badHost=await new Promise((resolve,reject)=>{const r=request(url+'/api/status',{headers:{host:'evil.example'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);r.end();});assert.equal(badHost,403);
 }finally{await new Promise(resolve=>server.close(resolve));st.close();}
});
function synthetic(n) {
 let seed=42,price=100;
 const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;};
 return Array.from({length:n},(_,i)=>{const open=price,drift=Math.floor(i/150)%2?.0015:-.0015;price*=Math.exp(drift+(rand()-.5)*.008);return {time:i*BAR,end:(i+1)*BAR-1,open,close:price,high:Math.max(open,price)*1.001,low:Math.min(open,price)*.999,volume:100+rand()*1000};});
}
test('Training uses chronological holdout with a full event-horizon purge',()=>{
 const b=synthetic(2400),m=trainModel(b,config,b.at(-1).end+1);
 assert.ok(m.validation.count>=100);assert.ok(m.validation.trainLastSignal+(config.horizon+1)*BAR<m.validation.validationFirstSignal);assert.ok(Number.isFinite(m.validation.brier));
 assert.ok(m.selection.trainLastSignal+(config.horizon+1)*BAR<m.selection.tuningFirstSignal);
});
test('Final holdout changes cannot select trees or change fitted parameters',()=>{
 const b=synthetic(2400),now=b.at(-1).end+1,m=trainModel(b,config,now);
 const changed=b.map(r=>r.time>=m.validation.validationFirstSignal?{...r,high:r.high*1.1,low:r.low*.9}:r);
 const other=trainModel(changed,config,now);
 assert.deepEqual(other.trees,m.trees);assert.equal(other.base,m.base);assert.deepEqual(other.selection,m.selection);
 assert.notEqual(other.validation.holdoutPositiveRate,m.validation.holdoutPositiveRate);
});
test('Tuning allows no trees when features have no predictive information',()=>{
 const rows=Array.from({length:1600},(_,i)=>({time:i*BAR,x:Array(8).fill(0),y:i%2}));
 const m=fitWithTuning(rows,config);
 assert.equal(m.selection.rounds,0);assert.equal(m.trees.length,0);
});
test('Walk-forward backtest executes and preserves daily loss rule',()=>{
 const b=synthetic(4000),r=backtest({BTCUSDT:b,ETHUSDT:b},config);
 assert.ok(r.folds.length>0);assert.ok(r.trades.length>0, "Synthetic test must exercise actual trade execution");assert.equal(r.lockViolations,0);assert.ok(Number.isFinite(r.netPnl));assert.ok(r.maxDrawdown>=0);
 for(const t of r.trades){assert.ok(t.closedAt>=t.openedAt);assert.ok(t.fees>0);}
});
