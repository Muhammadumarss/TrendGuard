// Offline, read-only account snapshot. Outputs research artifacts, never publishes models.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { config } from '../src/config.js';
import { trainModel } from '../src/training.js';
import { trainModel as legacyTrain } from '../audit-output/before/src/training.js';
import { features as legacyFeatures } from '../audit-output/before/src/features.js';
import { predict as legacyPredict } from '../audit-output/before/src/model.js';
import { dataset } from '../src/features.js';
import { predict } from '../src/model.js';
import { trainingWindow } from '../src/lifecycle.js';
import { backtest } from '../src/backtest.js';
import { provenance } from '../src/provenance.js';
const dir=new URL('../audit-output/',import.meta.url);mkdirSync(dir,{recursive:true});
const snapshot=new URL('frozen-market-data.json',dir);
let all;
try {all=JSON.parse(readFileSync(snapshot,'utf8'));}
catch {
 const db=new DatabaseSync(new URL('../data/paper.sqlite',import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1'),{readOnly:true});db.exec('BEGIN');
 all=Object.fromEntries(config.symbols.map(s=>[s,db.prepare('SELECT body FROM candles WHERE symbol=? ORDER BY time').all(s).map(r=>JSON.parse(r.body))]));db.exec('COMMIT');db.close();writeFileSync(snapshot,JSON.stringify(all));
}
const oldConfig=JSON.parse(readFileSync(new URL('before/config.json',dir),'utf8')),now=all.BTCUSDT.at(-1).end+1;
const models={},comparisons={};
for(const s of config.symbols) {
 console.log(`Training before/after ${s} on frozen history`);
 const bars=trainingWindow(all[s],config,now),old=legacyTrain(bars,oldConfig,now),m=trainModel(bars,config,now);models[s]=m;
 const oldRows=new Map(legacyFeatures(bars).filter(Boolean).map(r=>[r.time,r]));
 const common=dataset(bars,config).filter(r=>r.time>=Math.max(old.validation.validationFirstSignal,m.validation.validationFirstSignal));
 const predictions=common.map(r=>({time:r.time,target:r.y,outcome:r.outcome,netReturn:r.netReturn,before:legacyPredict(old,oldRows.get(r.time).x),after:predict(m,r.x)}));
 const brier=k=>predictions.reduce((n,r)=>n+(r[k]-r.target)**2,0)/predictions.length;
 // Reuse identical classification/reliability metric definitions on common target rows.
 const report=k=>{
   let tp=0,fp=0,tn=0,fn=0;const bins=Array.from({length:10},()=>({count:0,predicted:0,actual:0}));for(const r of predictions){const p=r[k],b=bins[Math.min(9,Math.floor(p*10))];b.count++;b.predicted+=p;b.actual+=r.target;if(p>=config.threshold){if(r.target)tp++;else fp++;}else if(r.target)fn++;else tn++;}
   for(const b of bins){b.predicted=b.count?b.predicted/b.count:null;b.actual=b.count?b.actual/b.count:null;}
   return {count:predictions.length,brier:brier(k),accuracy:(tp+tn)/predictions.length,precision:tp+fp?tp/(tp+fp):null,recall:tp+fn?tp/(tp+fn):null,f1:2*tp+fp+fn?2*tp/(2*tp+fp+fn):null,meanPredicted:predictions.reduce((n,r)=>n+r[k],0)/predictions.length,observedRate:predictions.reduce((n,r)=>n+r.target,0)/predictions.length,ece:bins.reduce((n,b)=>n+(b.count?b.count*Math.abs(b.predicted-b.actual):0),0)/predictions.length,bins};};
 comparisons[s]={beforeNative:old.validation,afterNative:m.validation,commonTargetDefinition:m.target,commonFrom:common[0].time,commonCount:common.length,before:report('before'),after:report('after')};
 writeFileSync(new URL(`${s}-after-predictions.json`,dir),JSON.stringify(predictions,null,2));
}
writeFileSync(new URL('after-models.json',dir),JSON.stringify(models,null,2));
console.log('Running repaired chronological backtest');
const normal=backtest(all,config);console.log('Running doubled-cost replay with frozen model schedule');
const stress=backtest(all,config,{costMultiplier:2,modelSchedule:normal.modelSchedule});
writeFileSync(new URL('after-backtest.json',dir),JSON.stringify({normal,stress},null,2));
const savedBefore=JSON.parse(readFileSync(new URL('before/backtest.json',dir),'utf8'));
const result={provenance:provenance(config,all),evaluatedAt:new Date().toISOString(),predictions:comparisons,beforeSaved:{from:savedBefore.normal.from,to:savedBefore.normal.to,trades:savedBefore.normal.trades.length,netPnl:savedBefore.normal.netPnl,maxDrawdown:savedBefore.normal.maxDrawdown},after:{from:normal.from,to:normal.to,metrics:normal.metrics,endingBalance:normal.endingBalance,lockViolations:normal.lockViolations,stressNetPnl:stress.netPnl,foldErrors:normal.folds.filter(f=>f.error)},limitations:['Audited history is not an untouched forward test.','Common prediction metrics use identical times and repaired spread-aware labels; native metrics differ in labels/splits.','Requiring a full rolling training window shortens historical evaluation. Trading backtest assumptions intentionally differ because confirmed bugs were corrected.']};
writeFileSync(new URL('before-after.json',dir),JSON.stringify(result,null,2));console.log(JSON.stringify({predictions:Object.fromEntries(Object.entries(comparisons).map(([s,r])=>[s,{before:r.before.brier,after:r.after.brier,passed:r.afterNative.passed,reason:r.afterNative.reason}])),after:result.after},null,2));
