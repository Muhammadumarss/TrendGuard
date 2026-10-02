import { acceptedModel } from '../verification/accepted-model-fixture.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { config,signature,validateConfig } from '../src/config.js';
import { unlockAt,lockUntil,stakeSize,BAR } from '../src/risk.js';
import { Store } from '../src/store.js';
import { openPaper,closePaper,modelReady } from '../src/engine.js';
import { features,barrierLabel } from '../src/features.js';
import { fit,predict } from '../src/model.js';
import { parseBars } from '../src/market.js';
const at=s=>Date.parse(s+'Z');
const state=()=>({cash:1000,enabled:true,position:null,trades:[],lastPoll:0});
test('Loss reset is next calendar day at 00:05 UTC, including year boundary',()=>{
 for(const [a,b] of [['2026-09-21T00:01','2026-09-22T00:05'],['2026-09-21T23:59','2026-09-22T00:05'],['2026-12-31T13:00','2027-01-01T00:05']])assert.equal(unlockAt(at(a)),at(b));
});
test('Two daily losses lock entries despite intervening wins; exact reset allows eligibility',()=>{
 const trades=[{closedAt:at('2026-09-21T13:00'),pnl:-.01},{closedAt:at('2026-09-21T14:00'),pnl:5}];
 assert.equal(lockUntil(trades,at('2026-09-21T14:01')),0);
 trades.push({closedAt:at('2026-09-21T15:00'),pnl:-1},{closedAt:at('2026-09-21T16:00'),pnl:10});
 assert.equal(lockUntil(trades,at('2026-09-22T00:04:59')),at('2026-09-22T00:05'));
 assert.equal(lockUntil(trades,at('2026-09-22T00:05')),0);
});
test('Losses on different UTC days do not combine; break-even trades do not count',()=>{
 const trades=[{closedAt:at('2026-12-31T23:59'),pnl:-1},{closedAt:at('2027-01-01T00:01'),pnl:-1},{closedAt:at('2027-01-01T00:02'),pnl:0}];
 assert.equal(lockUntil(trades,at('2027-01-01T00:03')),0);
 trades.push({closedAt:at('2027-01-01T00:03'),pnl:-1});
 assert.equal(lockUntil(trades,at('2027-01-01T00:05')),at('2027-01-02T00:05'));
 assert.equal(lockUntil([...trades].reverse(),at('2027-01-01T00:05')),at('2027-01-02T00:05'));
});
test('Unknown profit and clock rollback block entries',()=>{
 assert.equal(lockUntil([{closedAt:100,pnl:NaN}],200),Infinity);
 assert.equal(lockUntil([{closedAt:100,pnl:1}],50),Infinity);
 assert.equal(lockUntil([{closedAt:100,pnl:0}],200),0);
});
test('Sizing respects fees, available cash and exchange minimum',()=>{
 assert.equal(stakeSize(10,10,config),0);
 assert.ok(stakeSize(1000,1000,config)<200);
 assert.ok(stakeSize(1000,30,config)*(1+config.fee)<=30);
 assert.equal(stakeSize(NaN,30,config),0);
});
test('First fee-inclusive loss allows another pair; second loss blocks both pairs',()=>{
 const s=state(),now=at('2026-09-21T12:00');
 assert.ok(openPaper(s,'BTCUSDT',100,now,config));
 assert.equal(openPaper(s,'ETHUSDT',100,now,config),false);
 const t=closePaper(s,100.05,now+60_000,'test');
 assert.ok(t.pnl<0);assert.ok(t.fees>0);
 assert.ok(Math.abs(s.cash-(1000+t.pnl))<1e-8);
 assert.equal(openPaper(s,'ETHUSDT',100,now+120_000,config),true);
 closePaper(s,99,now+180_000,'test');
 assert.equal(openPaper(s,'BTCUSDT',100,now+240_000,config),false);
 assert.equal(openPaper(s,'ETHUSDT',100,now+240_000,config),false);
});
test('Position and loss lock persist across database restart',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'tg-')),file=path.join(dir,'paper.sqlite'),now=at('2026-09-21T12:00');
 let st=new Store(file);st.change(s=>{s.enabled=true;openPaper(s,'BTCUSDT',100,now,config);});st.close();
 st=new Store(file);assert.equal(st.read().position.symbol,'BTCUSDT');st.change(s=>closePaper(s,99,now+60_000,'stop_loss'));st.close();
 st=new Store(file);assert.equal(lockUntil(st.read().trades,now+120_000),0);
 st.change(s=>{assert.ok(openPaper(s,'ETHUSDT',100,now+120_000,config));closePaper(s,99,now+180_000,'stop_loss');});st.close();
 st=new Store(file);assert.ok(lockUntil(st.read().trades,now+240_000));st.close();rmSync(dir,{recursive:true});
});
test('Transaction failure leaves cash and trades unchanged',()=>{
 const s=new Store(':memory:');assert.throws(()=>s.change(st=>{st.cash=0;throw Error('disk-like failure');}));assert.equal(s.read().cash,1000);s.close();
});
test('Existing missing account state cannot silently reset risk history',()=>{
 const dir=mkdtempSync(path.join(tmpdir(),'tg-')),file=path.join(dir,'paper.sqlite');const s=new Store(file);s.db.exec('DELETE FROM state');s.close();assert.throws(()=>new Store(file),/missing/);rmSync(dir,{recursive:true});
});
const bars=()=>Array.from({length:60},(_,i)=>({time:i*BAR,end:(i+1)*BAR-1,open:100,high:100.1,low:99.9,close:100,volume:10}));
test('Triple barrier assumes stop first for ambiguous candles',()=>{const b=bars();b[1].high=104;b[1].low=97;assert.equal(barrierLabel(b,0,config),0);});
test('Next open entry, positive barrier, and censored horizon',()=>{const b=bars();b[1].high=104;assert.equal(barrierLabel(b,0,config),1);assert.equal(barrierLabel(b,50,config),null);for(let i=1;i<b.length;i++)Object.assign(b[i],{open:110,high:110.1,low:109.9,close:110});assert.equal(barrierLabel(b,0,config),0);});
test('Changing future candles does not change historical feature vector',()=>{
 const b=Array.from({length:400},(_,i)=>({time:i*BAR,end:(i+1)*BAR-1,open:100+i/10,high:101+i/10,low:99+i/10,close:100+i/10,volume:10+i}));
 const a=features(b)[350];for(let i=351;i<b.length;i++)b[i].close=900;assert.deepEqual(features(b)[350],a);
});
test('Actual JavaScript boosted trees learn and survive JSON serialization',()=>{
 const rows=Array.from({length:800},(_,i)=>({x:Array(8).fill(i/800),y:i>=400?1:0}));
 const m=fit(rows,30),r=JSON.parse(JSON.stringify(m));assert.ok(predict(r,Array(8).fill(.9))>.8);assert.ok(predict(r,Array(8).fill(.1))<.2);assert.equal(predict(r,Array(8).fill(.9)),predict(m,Array(8).fill(.9)));
});
test('Insufficient class coverage refuses training',()=>assert.throws(()=>fit(Array.from({length:600},()=>({x:Array(8).fill(0),y:1}))),/both outcomes/));
test('Stale, failed-validation and mismatched models cannot trade',()=>{
 const now=Date.now(),m=acceptedModel(config,now);
 assert.ok(modelReady(m,config,now));assert.ok(!modelReady({...m,trainedAt:now-48*3600_000},config,now));assert.ok(!modelReady({...m,validation:{passed:false}},config,now));assert.ok(!modelReady({...m,signature:'other'},config,now));
});
test('Malformed/gapped market data and live mode are rejected',()=>{
 const a=[0,'100','101','99','100','1',BAR-1];assert.equal(parseBars([a],BAR).length,1);assert.throws(()=>parseBars([a,[BAR*2,'100','101','99','100','1',BAR*3-1]],BAR*4),/gaps/);assert.throws(()=>validateConfig({...config,mode:'live'}),/paper execution only/);
});
