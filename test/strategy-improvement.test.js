import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { BAR,exitLevels } from '../src/risk.js';
import { validateState } from '../src/account.js';
import { modelReady } from '../src/lifecycle.js';
import { modelDiagnostics } from '../src/model-diagnostics.js';
import { economicEvidence } from '../src/statistics.js';
import { acceptedModel } from '../verification/accepted-model-fixture.js';
import { parseArchive } from '../research/history.js';
import { aggregate,prepareCandidates,candidateSignal } from '../research/candidates.js';
import { candidateExit,updateTrailingStop,replayCandidate } from '../research/replay.js';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { createApp } from '../src/server.js';
import { once } from 'node:events';

const bars=(n,start=0)=>Array.from({length:n},(_,i)=>({time:(start+i)*BAR,end:(start+i+1)*BAR-1,open:100,high:101,low:99,close:100,volume:100}));
test('Archive parser handles microsecond migration and quarantines only explicit truncated empty bars',()=>{
  const t=Date.UTC(2025,0,1),row=(time,end)=>`${time},100,101,99,100,10,${end},0,0,0,0,0`;
  assert.deepEqual(parseArchive(row(t,t+BAR-1)),parseArchive(row(t*1000,(t+BAR)*1000-1)));
  assert.throws(()=>parseArchive(`${t},100,100,100,100,0,${t+1000}`),/Malformed/);
  const quarantine=[];assert.deepEqual(parseArchive(`${t},100,100,100,100,0,${t+1000}`,{quarantine}),[]);assert.equal(quarantine.length,1);
  assert.throws(()=>parseArchive(`${t},100,100,100,100,1,${t+1000}`,{quarantine}),/Malformed/);
});
test('Aggregation never exposes incomplete or gap-spanning higher-timeframe candles',()=>{
  const b=bars(12);assert.equal(aggregate(b.slice(0,3),4).length,0);assert.equal(aggregate(b.slice(0,4),4).length,1);
  const gapped=b.filter((_,i)=>i!==5),a=aggregate(gapped,4);assert.deepEqual(a.map(r=>r.time),[0,8*BAR]);
  assert.equal(aggregate(b.slice(1,4),4).length,0);
});
test('Higher-timeframe strategy inputs are identical on full history and completed prefixes',()=>{
  const b=bars(202*96+32).map((r,i)=>({...r,open:100+i*.01,close:100+i*.01,high:101+i*.01,low:99+i*.01,volume:100+i%17}));
  const full=prepareCandidates(b),i=b.length-17,prefix=prepareCandidates(b.slice(0,i+1));
  assert.deepEqual(full[i],prefix.at(-1));assert.ok(full[i].day);assert.ok(full[i].fourHour);
  const changed=b.map((r,j)=>j>i?{...r,high:1e6,low:1,close:1e5}:r);
  assert.deepEqual(prepareCandidates(changed)[i],full[i]);
  for(const r of [full[i],full[i-1]])for(const k of ['hour','fourHour','day'])assert.ok(r[k].end<=r.bar.end);
});
test('Hourly rebound is separately confirmed and never a reversed bullish breakout',()=>{
  const b=bars(4).at(-1),row={bar:b,hour:{...b,close:100,lower:99,rsi:31,volumeMean:50},previousHour:{time:b.time-4*BAR,close:98,lower:99,rsi:20,high:99},fourHour:{end:b.end,sma50:105,sma200:110,close:102}};
  const p={signal:'hourly_rebound'};assert.equal(candidateSignal(row,p,config),true);
  for(const change of [{rsi:29},{close:98},{volume:1}])assert.equal(candidateSignal({...row,hour:{...row.hour,...change}},p,config),false);
  assert.equal(candidateSignal({...row,fourHour:{...row.fourHour,sma50:115}},p,config),false);
  assert.equal(candidateSignal({...row,bar:{...b,end:b.end+BAR}},p,config),false);
});
test('Trailing exits retain the hard stop, only ratchet after completed closes and fill gaps adversely',()=>{
  const p={entry:100,fee:config.fee,slippage:config.slippage,...exitLevels(100,config),expiresAt:100*BAR};
  const policy={exit:'trailing'},c={...config,backtestSpread:0};
  const first={time:BAR,end:2*BAR-1,open:100,high:104,low:99.5,close:103};
  assert.equal(candidateExit(p,first,c,policy),null);assert.equal(p.trailingStop,undefined);
  updateTrailingStop(p,103,c);const trail=p.trailingStop;assert.ok(trail>100);assert.equal(p.stop,99);
  updateTrailingStop(p,102,c);assert.equal(p.trailingStop,trail);
  const fill=candidateExit(p,{...first,time:2*BAR,end:3*BAR-1,open:101,low:100},c,policy);assert.equal(fill.reason,'gap_stop');assert.equal(fill.bid,101);
  assert.equal(candidateExit({...p,trailingStop:undefined},first,c,{exit:'fixed'}).reason,'take_profit');
});
test('New research exit profiles still expire and prioritize stops over time exits',()=>{
  const p={...exitLevels(100,config),expiresAt:BAR},b={time:BAR,end:2*BAR-1,open:100,low:99.5,high:120},c={...config,backtestSpread:0};
  assert.equal(candidateExit(p,b,c,{exit:'trailing'}).reason,'time_barrier');
  assert.equal(candidateExit(p,{...b,open:98,low:97},c,{exit:'trailing'}).reason,'gap_stop');
});
test('Model diagnostics identify independent failure gates without mutating readiness or scores',()=>{
  const m=acceptedModel(config,1000),before=structuredClone(m);assert.equal(modelReady(m,config,1000),true);
  assert.deepEqual(modelDiagnostics(m,config).failures,[]);assert.deepEqual(m,before);
  m.validation.economic.count=0;m.validation.economic.interval.lower=null;
  const d=modelDiagnostics(m,config);assert.ok(d.failures.includes('Too few independent selected trades'));assert.ok(d.failures.includes('Positive net payoff not established'));
  assert.equal(modelReady(m,config,1000),false);
});
test('Evidence funnel exposes score starvation while preserving the acceptance gates',()=>{
  const row={close:100,breakout:99,ema50:98,ema200:97,volume:200,volumeMean:100,x:Array(8).fill(0)};
  const m=acceptedModel(config,1000),rs=Array.from({length:100},(_,i)=>({row,x:row.x,time:i*30*BAR,netReturn:.01,executionEligible:true}));
  const yes=economicEvidence(m,rs,config);assert.equal(yes.count,100);assert.equal(yes.supported,true);assert.equal(yes.selectionFunnel.ruleCandidates,100);
  m.base=-3;const no=economicEvidence(m,rs,config);assert.equal(no.selectionFunnel.ruleCandidates,100);assert.equal(no.selectionFunnel.scoreQualified,0);assert.equal(no.count,0);assert.equal(no.supported,false);
});
test('Candidate replay preserves global loss locks, sizing, fees and accounting',()=>{
  const b=bars(400),prepared=b.map(bar=>({bar,legacy:null}));
  for(const i of [319,343,367]) {
    prepared[i].legacy={...b[i],close:100,breakout:99,ema50:98,ema200:97,volumeMean:50,x:Array(8).fill(0)};
    b[i+1].low=97;
  }
  const policy={id:'baseline_rules',setup:'trend_following',signal:'legacy',exit:'fixed',maxBars:24};
  const all={BTCUSDT:b,ETHUSDT:b},ready={BTCUSDT:prepared,ETHUSDT:prepared};
  const r=replayCandidate(all,ready,config,policy,{from:320*BAR,to:400*BAR});
  assert.equal(r.trades.length,2);assert.equal(r.riskViolations,0);assert.ok(r.rejections['Daily loss lock active']);
  assert.ok(r.trades.every(t=>t.fees>0&&t.qty*t.entry<=200&&t.reason==='stop_loss'));
  validateState({version:2,initialBalance:1000,cash:1000+r.metrics.netPnl,enabled:true,position:null,trades:r.trades,lastSignals:{},lastPoll:400*BAR});
  const stress=replayCandidate(all,ready,config,policy,{from:320*BAR,to:400*BAR,costMultiplier:2});
  assert.ok(stress.trades.length>0,'Cost-only stress must not be silently swallowed by spread rejection');
  const spread=replayCandidate(all,ready,config,policy,{from:320*BAR,to:400*BAR,costMultiplier:2,spreadMultiplier:2});assert.equal(spread.trades.length,0);
});
test('Dashboard status explains old model artifacts without rewriting or publishing models',async()=>{
  const store=new Store(':memory:');
  store.putModel('BTCUSDT',acceptedModel(config,Date.now()));
  const before=store.model('BTCUSDT'),state=store.read(),app=createApp(store,new Engine(store,config));
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  try {
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/status`);
    assert.equal(response.status,200);const result=await response.json();
    assert.equal(result.models.BTCUSDT.ready,true);assert.deepEqual(result.models.BTCUSDT.diagnostics.failures,[]);
    assert.equal(result.models.BTCUSDT.diagnostics.selected,100);
    assert.deepEqual(store.model('BTCUSDT'),before);assert.deepEqual(store.read(),state);
  } finally {await new Promise(resolve=>server.close(resolve));store.close();}
});
