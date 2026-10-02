import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { acceptedModel } from '../verification/accepted-model-fixture.js';
import { config,signature } from '../src/config.js';
import { predict,fit } from '../src/model.js';
import { modelReady } from '../src/lifecycle.js';
import { features,labelOutcome } from '../src/features.js';
import { economicEvidence,blockInterval } from '../src/statistics.js';
import { tradeDecision } from '../src/decision.js';
import { BAR } from '../src/risk.js';
import { Store } from '../src/store.js';
import { runJob } from '../src/jobs.js';
import { hash,compatibleReport } from '../src/provenance.js';
import { createRequester } from '../src/market.js';
import { trainModel } from '../src/training.js';
import { trainingDue } from '../src/lifecycle.js';

function entry() {
  const now=400*BAR,row={time:now-BAR,end:now-1,close:100,ema50:99,ema200:98,breakout:99.9,volume:200,volumeMean:100,x:[.001,.002,.003,.001,.01,.02,1,.001]};
  return {now,row,model:acceptedModel(config,now),quote:{bid:100,ask:100.01,at:now},state:{initialBalance:1000,cash:1000,enabled:true,position:null,trades:[]},c:config};
}
test('Malformed calibration cannot saturate into a high-confidence trade',()=>{
  const m=acceptedModel(config,100);
  for(const calibration of [{slope:Infinity,intercept:0},{slope:1,intercept:Infinity},{slope:-1,intercept:0},{slope:'1',intercept:0},{slope:1}]) {
    assert.ok(Number.isNaN(predict({...m,calibration},Array(8).fill(0))));assert.equal(modelReady({...m,calibration},config,100),false);
  }
});
test('A passed flag cannot substitute for supported validation evidence',()=>{
  const m=acceptedModel(config,100);assert.equal(modelReady(m,config,100),true);
  for(const invalid of [{...m,validation:{passed:true}},{...m,trees:[]},{...m,rate:-.08},{...m,validation:{...m.validation,brier:NaN}},{...m,validation:{...m.validation,qualityPassed:false}},{...m,calibration:null},{...m,featureDomain:[]}])assert.equal(modelReady(invalid,config,100),false);
});
test('Training rejects invalid feature dimensions, labels and complexity inputs',()=>{
  const rows=Array.from({length:600},(_,i)=>({x:Array(8).fill(0),y:i%2}));
  for(const corrupt of [{x:[0],y:0},{x:Array(8).fill(Infinity),y:1},{x:Array(8).fill(0),y:2}])assert.throws(()=>fit([corrupt,...rows]),/Invalid/);
  for(const rounds of [-1,1.5,81])assert.throws(()=>fit(rows,rounds),/Invalid/);
  assert.throws(()=>blockInterval([1,2],0),/Invalid/);
});
test('Unsupported feature envelope and score ranges fail closed',()=>{
  const a=entry();assert.equal(tradeDecision(a).trade,true);
  a.model.featureDomain[0]={min:1,max:2};assert.match(tradeDecision(a).reason,/outside observed training/);
  const b=entry();b.model.validation.economic.regimes['bullish:low_volatility'].maxScore=.7;assert.match(tradeDecision(b).reason,/outside observed regime/);
  const c=entry();c.model.validation.economic.regimes['bullish:low_volatility'].count=1;assert.equal(tradeDecision(c).trade,false);
});
test('Invalid candle metadata cannot bypass comparisons with NaN',()=>{
  for(const field of ['end','close','volumeMean','ema50']){const a=entry();a.row[field]=NaN;assert.equal(tradeDecision(a).trade,false);}
  const a=entry();a.row.x=null;assert.doesNotThrow(()=>tradeDecision(a));assert.equal(tradeDecision(a).trade,false);
});
test('Zero historical volume produces an unsupported feature rather than invented ratio',()=>{
  const bars=Array.from({length:300},(_,i)=>({time:i*BAR,end:(i+1)*BAR-1,open:100,high:101,low:99,close:100,volume:i===299?100:0}));
  const row=features(bars).at(-1);assert.ok(Number.isNaN(row.x[6]));assert.equal(tradeDecision({...entry(),row}).trade,false);
});
test('Payoff evidence excludes non-executable entries and keeps supported ones',()=>{
  const a=entry(),rows=Array.from({length:200},(_,i)=>({row:a.row,x:a.row.x,time:i*30*BAR,netReturn:.01,executionEligible:false}));
  assert.equal(economicEvidence(a.model,rows,config).count,0);
  for(const r of rows)r.executionEligible=true;const e=economicEvidence(a.model,rows,config);assert.equal(e.count,200);assert.equal(e.supported,true);assert.ok(e.minScore>=.6);assert.ok(e.maxScore<=1);
  a.model.featureDomain[0]={min:5,max:6};assert.equal(economicEvidence(a.model,rows,config).count,0);
});
test('Label execution eligibility agrees with drift/spread rules',()=>{
  const bars=Array.from({length:40},(_,i)=>({time:i*BAR,end:(i+1)*BAR-1,open:100,high:100.1,low:99.9,close:100,volume:100}));
  assert.equal(labelOutcome(bars,0,config).executionEligible,true);bars[1].open=101;bars[1].high=101.1;assert.equal(labelOutcome(bars,0,config).executionEligible,false);
  bars[1].open=100;assert.equal(labelOutcome(bars,0,{...config,backtestSpread:.01}).executionEligible,false);
});
test('Model publication refuses older jobs and derives immutable content identity',()=>{
  const st=new Store(':memory:');try {
    st.putModel('BTCUSDT',{...acceptedModel(config,2000),id:'untrusted'});const first=st.model('BTCUSDT');const {id,...body}=first;assert.equal(id,hash(body));
    assert.throws(()=>st.putModel('BTCUSDT',acceptedModel(config,1000)),/older/);assert.equal(st.model('BTCUSDT').id,id);
    const rejected=acceptedModel(config,3000);rejected.validation.passed=false;st.putModel('BTCUSDT',rejected);assert.equal(st.model('BTCUSDT').validation.passed,false);
    assert.throws(()=>st.putModel('BTCUSDT',{...acceptedModel(config,4000),calibration:{slope:Infinity,intercept:0}}),/Invalid/);
  }finally{st.close();}
});
test('One asset training failure does not prevent the other asset refreshing',async()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'tg-job-')),now=1000*BAR;
  try {
    await assert.rejects(runJob('train',dir,config,{readTime:async()=>now,fetchHistory:async symbol=>{if(symbol==='BTCUSDT')throw Error('BTC offline');return [{time:now-BAR,end:now-1,open:100,high:101,low:99,close:100,volume:1}];},train:()=>acceptedModel(config,now)}),/BTC offline/);
    const st=new Store(path.join(dir,'data','paper.sqlite'));try{assert.equal(st.model('BTCUSDT'),null);assert.equal(st.model('ETHUSDT').trainedAt,now);}finally{st.close();}
  }finally{rmSync(dir,{recursive:true});}
});
test('Changed execution acceptance invalidates model identity and stale reports',()=>{
  assert.notEqual(signature(config),signature({...config,maxEntryDrift:.005}));assert.notEqual(signature(config),signature({...config,maxSpread:.003}));
  const current={configHash:'c',sourceHash:'s'},report={normal:{version:3,provenance:current},stress:{version:3,provenance:current}};assert.equal(compatibleReport(report,current),true);assert.equal(compatibleReport(report,{...current,sourceHash:'new'}),false);assert.equal(compatibleReport({normal:{version:2}},current),false);
});
test('Market-data retries honor rate-limit cooldown across endpoints',async()=>{
  let now=1000,calls=0;
  const request=createRequester({clock:()=>now,sleep:async()=>{},fetchImpl:async()=>{calls++;return calls===1?{ok:false,status:429,headers:{get:()=> '120'}}:{ok:true,json:async()=>({ok:true})};}});
  await assert.rejects(request('/one'),/429/);now+=119999;await assert.rejects(request('/two'),/cooldown/);assert.equal(calls,1);
  now++;assert.deepEqual(await request('/two'),{ok:true});assert.equal(calls,2);
});
test('Transient market failures retry only within the bounded attempt budget',async()=>{
  let calls=0;const waits=[];
  const request=createRequester({sleep:async ms=>waits.push(ms),fetchImpl:async()=>{calls++;throw Error('offline');}});
  await assert.rejects(request('/one'),/after 3 attempts/);assert.equal(calls,3);assert.deepEqual(waits,[1000,2000]);
});
test('A concurrent rate limit cancels a pending transient retry',async()=>{
  let calls=0,resume;const pendingSleep=new Promise(r=>{resume=r;});
  const request=createRequester({clock:()=>1000,sleep:()=>pendingSleep,fetchImpl:async()=>{if(++calls===1)throw Error('transient');return {ok:false,status:429,headers:{get:()=> '120'}};}});
  const first=request('/first');await new Promise(r=>setImmediate(r));await assert.rejects(request('/second'),/429/);resume();await assert.rejects(first,/cooldown/);assert.equal(calls,2);
});
test('Insufficient outcome coverage publishes a rejected model instead of retaining an old accepted one',()=>{
  const bars=Array.from({length:2400},(_,i)=>({time:i*BAR,end:(i+1)*BAR-1,open:100,high:100.01,low:99.99,close:100,volume:100})),now=2400*BAR;
  const rejected=trainModel(bars,config,now);assert.equal(rejected.validation.passed,false);assert.match(rejected.validation.reason,/Insufficient training coverage/);assert.equal(rejected.trees.length,0);
  const st=new Store(':memory:');try{st.putModel('BTCUSDT',acceptedModel(config,now-1));st.putModel('BTCUSDT',rejected);assert.equal(modelReady(st.model('BTCUSDT'),config,now),false);assert.equal(trainingDue(st.model('BTCUSDT'),config,now+3600000),false);}finally{st.close();}
});
