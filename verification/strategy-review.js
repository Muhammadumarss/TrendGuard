// Run with node verification/strategy-review.js. Reads local SQLite once using a
// read-only transaction; subsequent runs reuse the immutable JSON snapshot.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,writeFileSync,mkdirSync,existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { config as beforeConfig } from '../audit-output/strategy-review/before/src/config.js';
import { backtest as beforeBacktest } from '../audit-output/strategy-review/before/src/backtest.js';
import { trainModel as beforeTrain } from '../audit-output/strategy-review/before/src/training.js';
import { provenance as beforeProvenance } from '../audit-output/strategy-review/before/src/provenance.js';
import { backtest } from '../src/backtest.js';
import { features } from '../src/features.js';
import { regime } from '../src/risk.js';
import { predict } from '../src/model.js';
import { modelReady } from '../src/lifecycle.js';
import { withinDomain } from '../src/model-support.js';
import { provenance,hash } from '../src/provenance.js';
import { alignedHistory } from '../src/data.js';
import { blockInterval } from '../src/statistics.js';
import { fixedTradeStress } from '../src/performance.js';
import { setupReplay } from './setup-replay.js';
const dir=new URL('../audit-output/strategy-review/',import.meta.url);mkdirSync(dir,{recursive:true});
const save=(name,value)=>writeFileSync(new URL(name,dir),JSON.stringify(value,null,2));
const snapshot=new URL('market-data.json',dir);let all;
if(existsSync(snapshot))all=JSON.parse(readFileSync(snapshot,'utf8'));
else {
  const db=new DatabaseSync(fileURLToPath(new URL('../data/paper.sqlite',import.meta.url)),{readOnly:true});
  try {
    db.exec('BEGIN');
    all=Object.fromEntries(config.symbols.map(s=>[s,db.prepare('SELECT body FROM candles WHERE symbol=? ORDER BY time').all(s).map(r=>JSON.parse(r.body))]));
    db.exec('COMMIT');
  } finally {db.close();}
  const first=Math.max(...Object.values(all).map(b=>b[0].time)),last=Math.min(...Object.values(all).map(b=>b.at(-1).time));
  all=Object.fromEntries(Object.entries(all).map(([s,b])=>[s,b.filter(r=>r.time>=first&&r.time<=last)]));
  alignedHistory(all,config.symbols);save('market-data.json',all);
}
assert.deepEqual(config,beforeConfig,'Risk/strategy settings must remain unchanged for this comparison');
const bars=alignedHistory(all,config.symbols),startAt=bars[config.trainingDays*96].time;
console.log(`Frozen ${bars.length} bars/asset; rolling OOS ${new Date(startAt).toISOString()} through ${new Date(bars.at(-1).end).toISOString()}`);
let fits=0;
const trainer=(b,c,now)=>{if(fits++%10===0)console.log(`Baseline fit ${fits}: ${new Date(now).toISOString()}`);return beforeTrain(b,c,now);};
let modelSchedule=null;
if(process.argv.includes('--reuse-models')) {
  const saved=JSON.parse(readFileSync(new URL('summary.json',dir),'utf8'));
  assert.deepEqual(saved.baselineProvenance,beforeProvenance(beforeConfig,all),'Cached model provenance mismatch');
  modelSchedule=JSON.parse(readFileSync(new URL('model-schedule.json',dir),'utf8'));
  assert.equal(hash(modelSchedule),saved.evaluation.modelScheduleHash,'Cached schedule content mismatch');
  fits=modelSchedule.length;
}
const before=beforeBacktest(all,beforeConfig,{startAt,trainer,modelSchedule});
console.log('Replaying revised execution with the identical frozen model schedule');
const after=backtest(all,config,{startAt,modelSchedule:before.modelSchedule});
const stress=backtest(all,config,{startAt,costMultiplier:2,modelSchedule:before.modelSchedule});
const slim=r=>{const {modelSchedule,decisions,folds,...rest}=r;return {...rest,decisionReasons:decisions.reduce((n,d)=>{const k=d.reason??'entry';n[k]=(n[k]??0)+1;return n;},{}),folds:folds.map(f=>({time:f.time,symbol:f.symbol,error:f.error,passed:f.validation?.passed,reason:f.validation?.reason,selected:f.validation?.economic?.count}))};};
save('before.json',slim(before));save('after.json',slim(after));save('stress.json',slim(stress));save('model-schedule.json',before.modelSchedule);
const rows=Object.fromEntries(config.symbols.map(s=>[s,features(all[s])]));
const coverage={};for(const s of config.symbols)for(let i=config.trainingDays*96-1;i<bars.length-1;i++){const k=regime(rows[s][i],config);coverage[k]=(coverage[k]??0)+1;}
const research={};
for(const setup of ['trend_following','counter_trend']) {
  console.log(`Separate rules-only diagnostic: ${setup}`);
  const normal=setupReplay(all,config,{startAt,setup}),double=setupReplay(all,config,{startAt,setup,costMultiplier:2});
  const scores={candidates:normal.candidates.length,scoreAboveThreshold:0,inTrainingDomain:0,modelReady:0};
  for(const candidate of normal.candidates) {
    const entry=before.modelSchedule.filter(m=>m.symbol===candidate.symbol&&m.availableAt<=candidate.at&&m.model).at(-1);
    if(!entry)continue;
    const row=rows[candidate.symbol][(candidate.signalAt-bars[0].time)/900000],p=predict(entry.model,row.x);
    if(p>=config.threshold)scores.scoreAboveThreshold++;
    if(withinDomain(entry.model,row.x))scores.inTrainingDomain++;
    if(modelReady(entry.model,config,candidate.at))scores.modelReady++;
  }
  const values=normal.trades.map(t=>t.pnl/t.cost),interval=blockInterval(values,Math.max(1,Math.ceil(Math.sqrt(values.length))));
  research[setup]={normal:normal.metrics,netReturn:normal.netReturn,stress:double.metrics,stressNetReturn:double.netReturn,candidateModelDiagnostics:scores,
    fixedTradeCostStress:fixedTradeStress(normal.trades),payoffInterval:interval,lockViolations:normal.lockViolations,warning:normal.warning};
  save(`${setup}-research.json`,{normal,double});
}
const metrics=r=>({count:r.trades.length,netPnl:r.netPnl,netReturn:r.netPnl/config.initialBalance,maxDrawdown:r.maxDrawdown,expectancy:r.metrics.expectancy,profitFactor:r.profitFactor});
const disabled={count:0,netPnl:0,netReturn:0,maxDrawdown:0,expectancy:null,profitFactor:null,status:'disabled; no validated counter-trend model/evidence'};
const summary={evaluatedAt:new Date().toISOString(),provenance:provenance(config,all),baselineProvenance:before.provenance,
  researchCodeHash:hash(Object.fromEntries(['strategy-review.js','setup-replay.js','counter-trend.js'].map(f=>[f,readFileSync(new URL(f,import.meta.url),'utf8')]))),
  data:{from:bars[0].time,to:bars.at(-1).end,countPerSymbol:bars.length},evaluation:{from:startAt,to:bars.at(-1).end,days:(bars.at(-1).end+1-startAt)/86400000,rollingTrainingDays:config.trainingDays,fits,modelScheduleHash:hash(before.modelSchedule),regimeCoverage:coverage},
  before:{trend_following:metrics(before),counter_trend:disabled},after:{trend_following:metrics(after),counter_trend:disabled},stress:metrics(stress),
  acceptedFits:before.folds.filter(f=>f.validation?.passed).length,fitErrors:before.folds.filter(f=>f.error),decisionReasons:slim(after).decisionReasons,research,
  conclusion:'Counter-trend remains research-only. Rules-only outcomes are not validated model performance or evidence from an untouched prospective test.'};
save('summary.json',summary);console.log(JSON.stringify(summary,null,2));
