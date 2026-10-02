import { BAR } from './risk.js';
import { dataset } from './features.js';
import { fit,metrics } from './model.js';
import { signature } from './config.js';
// Choose model complexity using only an earlier, purged tuning period.
// The final holdout must never select the number of trees.
export function fitWithTuning(training,c) {
  const cut=Math.floor(training.length*.8),tuning=training.slice(cut);
  if(tuning.length<100)throw Error('Need at least 100 chronological tuning examples');
  const inner=training.slice(0,cut).filter(r=>r.time+(c.horizon+1)*BAR<tuning[0].time);
  const candidate=fit(inner),prior=inner.reduce((s,r)=>s+r.y,0)/inner.length;
  let rounds=0,best=metrics({...candidate,trees:[]},tuning,prior).brier;
  for(let n=1;n<=candidate.trees.length;n++) {
    const score=metrics({...candidate,trees:candidate.trees.slice(0,n)},tuning,prior).brier;
    if(score<best){best=score;rounds=n;}
  }
  return {...fit(training,rounds),selection:{rounds,tuningBrier:best,tuningCount:tuning.length,trainLastSignal:inner.at(-1).time,tuningFirstSignal:tuning[0].time}};
}
export function trainModel(bars,c,now=Date.now()) {
  if(!bars.length||now-bars.at(-1).end>2*BAR||bars.at(-1).end>=now)throw Error('Training requires recent completed candles');
  const rows=dataset(bars,c),cut=Math.floor(rows.length*.8);
  const valid=rows.slice(cut);
  if(valid.length<100)throw Error('Need at least 100 chronological validation examples');
  // Purge every training label whose event horizon overlaps validation start.
  const training=rows.slice(0,cut).filter(r=>r.time+(c.horizon+1)*BAR<valid[0].time);
  const m=fitWithTuning(training,c),prior=training.reduce((s,r)=>s+r.y,0)/training.length;
  const report=metrics(m,valid,prior);
  const passed=m.trees.length>0&&Number.isFinite(report.brier)&&report.brier<report.baselineBrier;
  const reason=passed?'Holdout score beats the baseline':m.trees.length===0?'No predictive improvement on the earlier tuning period':'Holdout score does not beat the baseline';
  const validation={...report,passed,reason,trainingPositiveRate:prior,holdoutPositiveRate:valid.reduce((s,r)=>s+r.y,0)/valid.length,trainingCount:training.length,trainLastSignal:training.at(-1).time,validationFirstSignal:valid[0].time};
  return {...m,signature:signature(c),trainedAt:now,dataThrough:bars.at(-1).end,validation};
}
