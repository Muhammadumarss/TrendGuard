import { readFileSync,writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { config } from '../src/config.js';
import { backtest } from '../src/backtest.js';
import { trainModel } from '../src/training.js';
import { modelReady,trainingWindow } from '../src/lifecycle.js';
import { hash } from '../src/provenance.js';
import { loadHistory } from './history.js';
const dir=new URL('../audit-output/strategy-improvement/',import.meta.url),read=name=>JSON.parse(readFileSync(new URL(name,dir),'utf8'));
const baseline=read('baseline-2025.json'),schedule=read('baseline-model-schedule.json'),candidates=read('candidate-summary.json');
assert.equal(hash(schedule),baseline.scheduleHash);assert.equal(candidates.protocolHash,baseline.protocolHash);
const {all}=loadHistory(dir,config.symbols),startAt=Date.parse(candidates.protocol.selectionEnd),from=startAt-config.trainingDays*86400000;
const history=Object.fromEntries(Object.entries(all).map(([s,b])=>[s,b.filter(r=>r.time>=from&&r.time<Date.parse(candidates.protocol.testEnd))]));
assert.equal(hash(all),candidates.dataHash,'Candidate input history changed');
assert.equal(hash(history),baseline.provenance.dataHash,'Baseline input history changed');
assert.deepEqual(config,baseline.provenance.config,'Risk configuration changed');
const comparisons=[];
// Re-fit representative initial/middle/final jobs with diagnostic additions.
// Numerical parameters, calibration, validation and readiness must agree.
for(const index of [0,1,Math.floor(schedule.length/2),Math.floor(schedule.length/2)+1,schedule.length-2,schedule.length-1]) {
  const old=schedule[index];if(!old.model)throw Error('Cannot verify failed baseline training job');
  console.log(`Checking unchanged learner: ${old.symbol} ${new Date(old.time).toISOString()}`);
  const m=trainModel(trainingWindow(history[old.symbol],config,old.time),config,old.time);
  for(const k of ['base','rate','trees','calibration','selection','featureDomain','signature'])assert.deepEqual(m[k],old.model[k],k);
  for(const k of ['brier','baselineBrier','passed','qualityPassed','improvement'])assert.deepEqual(m.validation[k],old.model.validation[k],k);
  assert.equal(m.validation.economic.count,old.model.validation.economic.count);
  assert.equal(modelReady(m,config,old.availableAt),modelReady(old.model,config,old.availableAt));
  comparisons.push({symbol:old.symbol,at:old.time,identicalLearnedPolicy:true,diagnostics:m.validation.diagnostics});
}
console.log('Replaying current production policy with the verified frozen schedule');
const revised=backtest(history,config,{startAt,modelSchedule:schedule});
assert.deepEqual(revised.metrics,baseline.metrics);
const {modelSchedule,decisions,...report}=revised;
writeFileSync(new URL('revised-2025.json',dir),JSON.stringify(report,null,2));
const modelSummary={};
for(const symbol of config.symbols) {
  const ms=schedule.filter(r=>r.symbol===symbol&&r.model).map(r=>r.model),average=fn=>ms.reduce((n,m)=>n+fn(m),0)/ms.length;
  modelSummary[symbol]={fits:ms.length,accepted:ms.filter(m=>m.validation.passed).length,
    predictiveQualityPassed:ms.filter(m=>m.validation.qualityPassed).length,zeroTrees:ms.filter(m=>!m.trees.length).length,
    calibrationPassed:ms.filter(m=>m.calibration.status==='fitted_on_separate_chronological_period').length,
    meanTargetFrequency:average(m=>m.validation.holdoutPositiveRate),meanScore:average(m=>m.validation.predictions.meanPredicted),
    maxIndependentEvidence:Math.max(...ms.map(m=>m.validation.economic.count)),
    fitsWithScoreQualifiedExamples:ms.filter(m=>m.validation.predictions.tp+m.validation.predictions.fp>0).length};
}
const production=r=>({count:r.trades.length,netPnl:r.netPnl,netReturn:r.netPnl/config.initialBalance,maxDrawdown:r.maxDrawdown,expectancy:r.metrics.expectancy,profitFactor:r.profitFactor,lockViolations:r.lockViolations});
const summary={evaluatedAt:new Date().toISOString(),protocolHash:baseline.protocolHash,modelSummary,learnerParityChecks:comparisons,
  before:production(baseline),after:production(revised),baselineTrainingErrors:baseline.folds.filter(f=>f.error),
  selection:candidates.selection,alternativesPromoted:[],counterTrendEnabled:false,
  results:candidates.results,benchmarks:{cash:{netReturn:0,maxDrawdown:0},...candidates.benchmarks},
  conclusion:'No alternative passes the predeclared selection/evidence gates. Production risk and learned policy are preserved; diagnostics and reproducible strategy research are improved. All new trading rules stay research-only.'};
writeFileSync(new URL('summary.json',dir),JSON.stringify(summary,null,2));
console.log(JSON.stringify({modelSummary,before:summary.before,after:summary.after,selection:summary.selection},null,2));
