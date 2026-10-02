import { predict,rawPredict } from './model.js';
import { signal,regime,BAR } from './risk.js';
import { withinDomain } from './model-support.js';
const mean=a=>a.length?a.reduce((s,x)=>s+x,0)/a.length:null;
// Deterministic circular moving-block bootstrap. Bounds remain research estimates.
export function blockInterval(values,blockSize=25) {
  if(!Number.isInteger(blockSize)||blockSize<1)throw Error('Invalid bootstrap block size');
  if(!values.length||values.some(v=>!Number.isFinite(v)))return {mean:null,lower:null,upper:null,blocks:0};
  const blocks=Math.floor(values.length/blockSize);
  if(blocks<5)return {mean:mean(values),lower:null,upper:null,blocks};
  let seed=1701;const random=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/2**32;},draws=[];
  for(let b=0;b<300;b++) {let sum=0,n=0;while(n<values.length){const start=Math.floor(random()*values.length);for(let j=0;j<blockSize&&n<values.length;j++,n++)sum+=values[(start+j)%values.length];}draws.push(sum/values.length);}
  draws.sort((a,b)=>a-b);
  return {mean:mean(values),lower:draws[7],upper:draws[292],blocks,method:'95% moving-block percentile bootstrap; dependence may exceed block length'};
}
export function calibrate(m,rows) {
  const positives=rows.reduce((n,r)=>n+r.y,0);
  if(rows.length<100||positives<20||rows.length-positives<20)return {slope:1,intercept:0,status:'insufficient_class_coverage',count:rows.length};
  const z=rows.map(r=>{const p=rawPredict(m,r.x);return Math.log(p/(1-p));});
  let slope=1,intercept=0;
  for(let i=0;i<500;i++) {
    let ga=.01*(slope-1),gb=.01*intercept;
    for(let j=0;j<rows.length;j++){const p=1/(1+Math.exp(-Math.max(-30,Math.min(30,slope*z[j]+intercept))));ga+=(p-rows[j].y)*z[j]/rows.length;gb+=(p-rows[j].y)/rows.length;}
    slope=Math.max(.05,Math.min(5,slope-.05*ga));intercept=Math.max(-8,Math.min(8,intercept-.05*gb));
  }
  return {slope,intercept,status:'fitted_on_separate_chronological_period',count:rows.length};
}
export function predictionMetrics(m,rows,threshold=.6) {
  const bins=Array.from({length:10},(_,i)=>({from:i/10,to:(i+1)/10,count:0,predicted:0,actual:0}));
  let tp=0,fp=0,tn=0,fn=0;
  for(const r of rows){const p=predict(m,r.x),b=bins[Math.min(9,Math.floor(p*10))];if(!b)throw Error('Invalid model prediction');b.count++;b.predicted+=p;b.actual+=r.y;if(p>=threshold){if(r.y)tp++;else fp++;}else if(r.y)fn++;else tn++;}
  for(const b of bins){b.predicted=b.count?b.predicted/b.count:null;b.actual=b.count?b.actual/b.count:null;b.support=b.count>=100?'higher':b.count>=30?'moderate':'low';}
  const precision=tp+fp?tp/(tp+fp):null,recall=tp+fn?tp/(tp+fn):null;
  return {target:'TP before stop or expiry; not probability of a profitable close',threshold,count:rows.length,accuracy:rows.length?(tp+tn)/rows.length:null,precision,recall,f1:2*tp+fp+fn?2*tp/(2*tp+fp+fn):null,tp,fp,tn,fn,meanPredicted:mean(rows.map(r=>predict(m,r.x))),observedRate:mean(rows.map(r=>r.y)),ece:rows.length?bins.reduce((n,b)=>n+(b.count?b.count*Math.abs(b.predicted-b.actual):0),0)/rows.length:null,bins};
}
export function economicEvidence(m,rows,c) {
  const selected=rows.filter(r=>r.executionEligible===true&&r.row&&withinDomain(m,r.x)&&signal(r.row,predict(m,r.x),c));
  // Non-overlapping simulated positions in chronological order; no concurrent labels.
  const returns=[];let until=-Infinity;
  for(const r of selected){if(r.time<=until)continue;returns.push(r);until=r.time+(c.horizon+1)*BAR;}
  function summarize(rs){const interval=blockInterval(rs.map(r=>r.netReturn),Math.max(1,Math.ceil(Math.sqrt(rs.length))));const scores=rs.map(r=>predict(m,r.x));return {count:rs.length,expectedNetReturn:mean(rs.map(r=>r.netReturn)),minScore:scores.length?Math.min(...scores):null,maxScore:scores.length?Math.max(...scores):null,interval,supported:rs.length>=c.minEvidenceTrades&&interval.lower!==null&&interval.lower>0};}
  const regimes=Object.fromEntries([...new Set(rows.filter(r=>r.row).map(r=>regime(r.row,c)))].map(k=>[k,summarize(returns.filter(r=>regime(r.row,c)===k))]));
  return {...summarize(returns),selectedRows:selected.length,regimes,interpretation:'Historical non-overlapping selected examples; not a portfolio backtest or guaranteed expectation'};
}
