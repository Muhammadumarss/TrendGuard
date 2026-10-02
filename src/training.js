import { BAR } from './risk.js';
import { dataset } from './features.js';
import { fit,metrics } from './model.js';
import { signature } from './config.js';
import { validateBars } from './data.js';
import { predict } from './model.js';
import { calibrate,predictionMetrics,blockInterval,economicEvidence } from './statistics.js';
import { hash,provenance } from './provenance.js';
import { featureDomain,withinDomain } from './model-support.js';
import { modelDiagnostics } from './model-diagnostics.js';
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
  validateBars(bars);
  if(!bars.length||now-bars.at(-1).end>2*BAR||bars.at(-1).end>=now)throw Error('Training requires recent completed candles');
  const rows=dataset(bars,c),cut=Math.floor(rows.length*.8),calibrationCut=Math.floor(rows.length*.6);
  const valid=rows.slice(cut);
  if(valid.length<100)throw Error('Need at least 100 chronological validation examples');
  // Purge every training label whose event horizon overlaps validation start.
  const calibration=rows.slice(calibrationCut,cut).filter(r=>r.time+(c.horizon+1)*BAR<valid[0].time);
  if(calibration.length<100)throw Error('Need 100 calibration examples');
  const training=rows.slice(0,calibrationCut).filter(r=>r.time+(c.horizon+1)*BAR<calibration[0].time);
  const prior=training.reduce((s,r)=>s+r.y,0)/training.length;
  let m;
  try {m=fitWithTuning(training,c);}catch(e){
    if(e.code!=='INSUFFICIENT_TRAINING_COVERAGE')throw e;
    const p=Math.max(.001,Math.min(.999,prior));
    m={version:3,base:Math.log(p/(1-p)),rate:.08,trees:[],selection:{rounds:0},trainingRejection:e.message};
  }
  m.featureDomain=featureDomain(training);
  m.calibration=calibrate(m,calibration);
  const report=metrics(m,valid,prior);
  const improvement=blockInterval(valid.map(r=>(prior-r.y)**2-(predict(m,r.x)-r.y)**2),c.horizon+1);
  const economic=economicEvidence(m,valid,c),qualityPassed=m.trees.length>0&&report.brier<report.baselineBrier&&improvement.lower!==null&&improvement.lower>0;
  const passed=qualityPassed&&m.calibration.status==='fitted_on_separate_chronological_period'&&economic.supported&&Object.values(economic.regimes).some(r=>r.supported);
  const reason=m.trainingRejection?`Insufficient training coverage: ${m.trainingRejection}`:passed?'Predictive and selected-payoff evidence gates passed':!qualityPassed?'Holdout improvement is absent or uncertain':'Insufficient calibration/selected-payoff/regime evidence';
  const validation={...report,passed,qualityPassed,reason,improvement,economic,outsideDomainCount:valid.filter(r=>!withinDomain(m,r.x)).length,predictions:predictionMetrics(m,valid,c.threshold),trainingPositiveRate:prior,holdoutPositiveRate:valid.reduce((s,r)=>s+r.y,0)/valid.length,trainingCount:training.length,trainLastSignal:training.at(-1).time,calibrationFirstSignal:calibration[0].time,calibrationLastSignal:calibration.at(-1).time,validationFirstSignal:valid[0].time};
  const result={...m,signature:signature(c),target:'long TP before stop or expiry; timeout can have positive or negative P&L',trainedAt:now,dataThrough:bars.at(-1).end,validation,provenance:provenance(c,bars)};
  result.validation.diagnostics=modelDiagnostics(result,c);
  return {...result,id:hash(result)};
}
