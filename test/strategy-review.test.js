import { test } from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { Engine,openPaper } from '../src/engine.js';
import { Store } from '../src/store.js';
import { tradeDecision } from '../src/decision.js';
import { acceptedModel } from '../verification/accepted-model-fixture.js';
import { counterTrendCandidate,researchRows } from '../verification/counter-trend.js';
import { features } from '../src/features.js';
import { BAR } from '../src/risk.js';
import { setupReplay } from '../verification/setup-replay.js';
import { validateState } from '../src/account.js';

function positionStore(now) {
  const store=new Store(':memory:');
  store.change(s=>{s.enabled=true;openPaper(s,'BTCUSDT',100,now-60000,config);s.enabled=false;});
  return store;
}

test('Automatic exits reject stale/future/malformed quotes without refreshing recovery time',async t=>{
  const now=Date.UTC(2026,8,28,12);t.mock.method(Date,'now',()=>now);
  for(const quote of [{bid:98,ask:98.1,at:now-15001},{bid:98,ask:98.1,at:now+1},{bid:98,ask:97,at:now},{bid:NaN,ask:98,at:now}]) {
    const store=positionStore(now);
    try {
      const before=store.read(),engine=new Engine(store,config,{quote:async()=>quote});
      await engine.tick();assert.deepEqual(store.read(),before);assert.equal(engine.health.ok,false);
      assert.match(engine.health.message,/quote/i);
    } finally {store.close();}
  }
});

test('Manual close rejects stale quotes; wide fresh spreads never block a protective exit',async t=>{
  const now=Date.UTC(2026,8,28,12);t.mock.method(Date,'now',()=>now);
  const store=positionStore(now),quote={bid:98,ask:110,at:now-15001};
  try {
    const engine=new Engine(store,config,{quote:async()=>quote}),before=store.read();
    await assert.rejects(engine.closeNow(),/quote/i);assert.deepEqual(store.read(),before);
    quote.at=now;await engine.tick();assert.equal(store.read().position,null);
    assert.equal(store.read().trades[0].reason,'stop_loss');assert.ok(store.read().trades[0].pnl<0);
  } finally {store.close();}
});

const rebound=()=>({time:399*BAR,end:400*BAR-1,open:99,close:100,high:100.1,low:98.5,
  ema50:101,ema200:102,breakout:104,volume:200,volumeMean:100,
  previousHigh:99.8,previousLow:98,previousOpen:99.7,previousClose:98.8,priorSupport:98.4,
  x:[.012,.001,-.01,.001,-.01,-.02,1,.016]});

test('Counter-trend hypothesis requires a downside sweep, recovery confirmation and volume',()=>{
  assert.equal(counterTrendCandidate(rebound()),true);
  for(const change of [{ema50:103},{close:99.5},{volume:100},{previousLow:98.5},{previousClose:100},{previousHigh:NaN},{open:100.1}])
    assert.equal(counterTrendCandidate({...rebound(),...change}),false);
});

test('A bullish model acceptance cannot authorize counter-trend trades, even at a high score',()=>{
  const now=400*BAR;
  const result=tradeDecision({model:acceptedModel(config,now),row:rebound(),quote:{bid:100,ask:100.01,at:now},
    state:{initialBalance:1000,cash:1000,enabled:true,position:null,trades:[]},now,c:config});
  assert.equal(result.trade,false);assert.match(result.reason,/Trend or score/);
});

test('Counter-trend research features are causal and preserve the model feature vector',()=>{
  const bars=Array.from({length:330},(_,i)=>({time:i*BAR,end:(i+1)*BAR-1,open:100+i*.01,close:100+i*.01,high:101+i*.01,low:99+i*.01,volume:100}));
  const rows=features(bars),a=researchRows(bars,rows)[310];
  assert.deepEqual(a.x,rows[310].x);
  for(let i=311;i<bars.length;i++)bars[i]={...bars[i],close:1000,low:1,high:2000};
  assert.deepEqual(researchRows(bars,features(bars))[310],a);
  assert.deepEqual(researchRows(bars.slice(0,311),features(bars.slice(0,311))).at(-1),a);
});

test('Both research setups preserve shared sizing, stop execution and the cross-asset loss lock',()=>{
  for(const setup of ['trend_following','counter_trend']) {
    const bars=Array.from({length:380},(_,i)=>{const price=setup==='counter_trend'?130-i*.1:70+i*.1;return {time:i*BAR,end:(i+1)*BAR-1,open:price,close:price,high:price+.05,low:price-.05,volume:100};});
    for(const i of [319,343,367]) {
      const price=bars[i].close;
      if(setup==='counter_trend') {
        Object.assign(bars[i-1],{open:price+.3,close:price-.2,high:price+.35,low:price-.4});
        Object.assign(bars[i],{open:price-.2,close:price+.4,high:price+.45,low:price-.25,volume:1000});
      } else Object.assign(bars[i],{volume:1000});
      const entry=bars[i].close;
      Object.assign(bars[i+1],{open:entry,high:Math.max(entry,bars[i+1].close)+.1,low:Math.min(entry*.97,bars[i+1].close)});
    }
    const result=setupReplay({BTCUSDT:bars,ETHUSDT:bars},config,{startAt:320*BAR,setup});
    assert.equal(result.trades.length,2,setup);assert.equal(result.lockViolations,0);
    assert.ok(result.rejections['Daily loss lock active']>0);
    assert.ok(result.trades.every(t=>t.reason==='stop_loss'&&t.fees>0&&t.pnl<0&&t.qty*t.entry<=200));
    assert.ok(result.metrics.maxDrawdown>0);assert.ok(result.metrics.expectancy<0);assert.equal(result.metrics.profitFactor,0);
    validateState({version:2,initialBalance:1000,cash:1000+result.metrics.netPnl,enabled:true,position:null,trades:result.trades,lastSignals:{},lastPoll:bars.at(-1).end});
  }
});
