import { readFileSync,writeFileSync,readdirSync } from 'node:fs';
import { config } from '../src/config.js';
import { hash,provenance } from '../src/provenance.js';
import { blockInterval } from '../src/statistics.js';
import { loadHistory } from './history.js';
import { prepareCandidates } from './candidates.js';
import { replayCandidate,passiveBenchmark } from './replay.js';

const dir=new URL('../audit-output/strategy-improvement/',import.meta.url),protocol=JSON.parse(readFileSync(new URL('./strategy-protocol.json',import.meta.url),'utf8'));
const save=(name,value)=>writeFileSync(new URL(name,dir),JSON.stringify(value,null,2));
const {all,...quality}=loadHistory(dir,config.symbols);
save('data-quality.json',quality);
console.log('Preparing causal hourly, four-hour and daily signals');
const prepared=Object.fromEntries(config.symbols.map(s=>[s,prepareCandidates(all[s])]));
const ranges={development:{from:Date.parse(protocol.dataStart)+protocol.warmupDays*86400000,to:Date.parse(protocol.developmentEnd)},
  selection:{from:Date.parse(protocol.developmentEnd),to:Date.parse(protocol.selectionEnd)},test:{from:Date.parse(protocol.selectionEnd),to:Date.parse(protocol.testEnd)}};
const evidence=r=>blockInterval(r.trades.map(t=>t.pnl/t.cost),Math.max(1,Math.ceil(Math.sqrt(r.trades.length))));
function gate(r,stress) {
  const interval=evidence(r),p=protocol.promotion,failures=[];
  if(r.metrics.count<p.minTradesPerPeriod)failures.push('insufficient_trades');
  if(!(r.netReturn>0))failures.push('nonpositive_net_return');
  if(!(interval.lower>0))failures.push('uncertain_or_negative_payoff');
  if(r.metrics.maxDrawdown>config.maxDrawdownFraction||r.drawdownHalt)failures.push('drawdown_limit');
  if(r.riskViolations)failures.push('risk_violation');
  for(const s of config.symbols){const a=r.metrics.byAsset[s];if(!a||a.count<p.minTradesPerAsset||a.netPnl<=0)failures.push(`${s}_insufficient_positive_evidence`);}
  if(!(stress.netReturn>0))failures.push('cost_stress_failed');
  return {passed:failures.length===0,failures,interval};
}
const reports={};
for(const stage of ['development','selection']) {
  reports[stage]={};
  for(const policy of protocol.candidates) {
    console.log(`${stage}: ${policy.id}`);
    const normal=replayCandidate(all,prepared,config,policy,ranges[stage]);
    const stress=replayCandidate(all,prepared,config,policy,{...ranges[stage],costMultiplier:2});
    reports[stage][policy.id]={normal,stress,gate:gate(normal,stress)};
  }
}
const selection=Object.fromEntries(['trend_following','counter_trend'].map(setup=>{
  const eligible=protocol.candidates.filter(p=>p.setup===setup&&p.id!=='baseline_rules'&&reports.selection[p.id].gate.passed);
  eligible.sort((a,b)=>reports.selection[b.id].normal.netReturn-reports.selection[a.id].normal.netReturn);
  return [setup,eligible[0]?.id??null];
}));
// Persist the choice before any holdout P&L is calculated. Holdout cannot select a runner-up.
save('selection.json',{protocolHash:hash(protocol),selection,gates:Object.fromEntries(Object.entries(reports.selection).map(([k,r])=>[k,r.gate]))});
reports.test={};
for(const policy of protocol.candidates) {
  console.log(`Locked test: ${policy.id}`);
  const normal=replayCandidate(all,prepared,config,policy,ranges.test),stress=replayCandidate(all,prepared,config,policy,{...ranges.test,costMultiplier:2});
  const latency=replayCandidate(all,prepared,config,policy,{...ranges.test,delayBars:1});
  const spreadStress=replayCandidate(all,prepared,config,policy,{...ranges.test,costMultiplier:2,spreadMultiplier:2});
  reports.test[policy.id]={normal,stress,latency,spreadStress,gate:gate(normal,stress),selectedBeforeTest:selection[policy.setup]===policy.id};
}
const compact=r=>({count:r.metrics.count,netPnl:r.metrics.netPnl,netReturn:r.netReturn,maxDrawdown:r.metrics.maxDrawdown,
  expectancy:r.metrics.expectancy,profitFactor:r.metrics.profitFactor,riskViolations:r.riskViolations,candidates:r.candidates,
  drawdownHalt:r.drawdownHalt,byAsset:r.metrics.byAsset,byRegime:r.metrics.byRegime,byMonth:r.metrics.byMonth,fixedTradeStress:r.fixedTradeStress});
const source=provenance(config,all);
const summary={protocol,protocolHash:hash(protocol),dataHash:source.dataHash,source,
  researchHash:hash(Object.fromEntries(readdirSync(new URL('./',import.meta.url)).filter(f=>/\.(js|json|py)$/.test(f)).sort().map(f=>[f,readFileSync(new URL(f,import.meta.url),'utf8')]))),
  archiveManifestHash:hash(JSON.parse(readFileSync(new URL('download-manifest.json',dir),'utf8'))),quality,ranges,selection,
  results:Object.fromEntries(Object.entries(reports).map(([stage,rows])=>[stage,Object.fromEntries(Object.entries(rows).map(([id,r])=>[id,{normal:compact(r.normal),stress:compact(r.stress),latency:r.latency?compact(r.latency):null,spreadStress:r.spreadStress?compact(r.spreadStress):null,gate:r.gate,selectedBeforeTest:r.selectedBeforeTest??null}]))])),
  benchmarks:Object.fromEntries(config.symbols.map(s=>[s,passiveBenchmark(all[s],config,ranges.test)])),
  promoted:[],note:'All alternatives remain research-only until both historical gates and untouched forward paper validation pass. Non-selected holdout results are descriptive only.'};
for(const [stage,rs] of Object.entries(reports))for(const [id,r] of Object.entries(rs))save(`${stage}-${id}.json`,r);
save('candidate-summary.json',summary);
console.log(JSON.stringify({selection,test:Object.fromEntries(Object.entries(summary.results.test).map(([k,r])=>[k,{...r.normal,gate:r.gate}]))},null,2));
