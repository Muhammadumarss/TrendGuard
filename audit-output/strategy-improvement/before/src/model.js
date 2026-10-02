// Binary logistic gradient boosting with Newton-fitted decision stumps.
// Pure JavaScript; this is NOT LightGBM. Separate calibration targets TP-first, not trading win rate.
const sigmoid=z=>1/(1+Math.exp(-Math.max(-30,Math.min(30,z))));
export function predict(m,x) {
  const p=rawPredict(m,x);
  if(!Number.isFinite(p)||!m.calibration)return p;
  if(!validCalibration(m.calibration))return NaN;
  return sigmoid(m.calibration.slope*Math.log(p/(1-p))+m.calibration.intercept);
}
export function validCalibration(c) {
  return !!c&&Number.isFinite(c.slope)&&c.slope>=.05&&c.slope<=5&&Number.isFinite(c.intercept)&&Math.abs(c.intercept)<=8;
}
export function validParameters(m) {
  return !!(m&&m.version===3&&Number.isFinite(m.base)&&Math.abs(m.base)<=30&&Number.isFinite(m.rate)&&m.rate>0&&m.rate<=1&&Array.isArray(m.trees)&&m.trees.length<=80&&
    m.trees.every(t=>t&&Number.isInteger(t.feature)&&t.feature>=0&&t.feature<8&&[t.threshold,t.left,t.right].every(Number.isFinite)&&Math.abs(t.left)<=2&&Math.abs(t.right)<=2)&&(!m.calibration||validCalibration(m.calibration)));
}
export function rawPredict(m,x) {
  if(!validParameters(m)||!Array.isArray(x)||x.length!==8||!x.every(Number.isFinite))return NaN;
  let z=m.base;
  for(const t of m.trees){if(!Number.isInteger(t.feature)||t.feature<0||t.feature>=8||![t.threshold,t.left,t.right].every(Number.isFinite))return NaN;z+=m.rate*(x[t.feature]<=t.threshold?t.left:t.right);}
  return sigmoid(z);
}
export function fit(rows, rounds=80) {
  if(!Array.isArray(rows)||!Number.isInteger(rounds)||rounds<0||rounds>80||rows.some(r=>!r||!Array.isArray(r.x)||r.x.length!==8||!r.x.every(Number.isFinite)||(r.y!==0&&r.y!==1)))throw Error('Invalid training rows or rounds');
  const n=rows.length,wins=rows.filter(r=>r.y===1).length;
  if(n<500||wins<20||n-wins<20){const error=Error('Training needs 500+ complete examples and 20+ examples of both outcomes.');error.code='INSUFFICIENT_TRAINING_COVERAGE';throw error;}
  const prior=Math.max(.001,Math.min(.999,wins/n)),base=Math.log(prior/(1-prior));
  const m={version:3,base,rate:.08,trees:[]},z=Array(n).fill(base);
  const cuts=Array.from({length:8},(_,f)=>{
    const v=rows.map(r=>r.x[f]).sort((a,b)=>a-b);
    return [...new Set(Array.from({length:15},(_,q)=>v[Math.floor((q+1)*n/16)]))];
  });
  for(let round=0;round<rounds;round++) {
    const p=z.map(sigmoid),g=p.map((v,i)=>rows[i].y-v),h=p.map(v=>Math.max(.001,v*(1-v)));
    const G=g.reduce((a,b)=>a+b,0),H=h.reduce((a,b)=>a+b,0);
    let best=null,gain=0;
    for(let f=0;f<8;f++)for(const threshold of cuts[f]) {
      let gl=0,hl=0,count=0;
      for(let i=0;i<n;i++)if(rows[i].x[f]<=threshold){gl+=g[i];hl+=h[i];count++;}
      if(count<20||n-count<20)continue;
      const gr=G-gl,hr=H-hl,score=gl*gl/(hl+2)+gr*gr/(hr+2)-G*G/(H+2);
      if(score>gain){gain=score;best={feature:f,threshold,left:Math.max(-2,Math.min(2,gl/(hl+2))),right:Math.max(-2,Math.min(2,gr/(hr+2)))};}
    }
    if(!best)break;
    m.trees.push(best);
    for(let i=0;i<n;i++)z[i]+=m.rate*(rows[i].x[best.feature]<=best.threshold?best.left:best.right);
  }
  return m;
}
export function metrics(m,rows,prior) {
  let brier=0,baseline=0,logLoss=0;
  for(const r of rows){const p=Math.max(1e-9,Math.min(1-1e-9,predict(m,r.x)));brier+=(p-r.y)**2;baseline+=(prior-r.y)**2;logLoss-=r.y*Math.log(p)+(1-r.y)*Math.log(1-p);}
  return {count:rows.length,brier:brier/rows.length,baselineBrier:baseline/rows.length,logLoss:logLoss/rows.length};
}
