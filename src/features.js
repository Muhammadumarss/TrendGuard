import { BAR, exitLevels } from './risk.js';
export function features(candles) {
  let e50=0,e200=0;
  return candles.map((b,i)=>{
    e50=i?e50+(b.close-e50)*2/51:b.close;e200=i?e200+(b.close-e200)*2/201:b.close;
    if(i<200)return null;
    const prev=candles.slice(i-20,i);
    const returns=candles.slice(i-19,i+1).map((x,j)=>x.close/candles[i-20+j].close-1);
    const mean=returns.reduce((s,x)=>s+x,0)/20;
    const vol=Math.sqrt(returns.reduce((s,x)=>s+(x-mean)**2,0)/20);
    const volumeMean=prev.reduce((s,x)=>s+x.volume,0)/20;
    const x=[b.close/candles[i-1].close-1,b.close/candles[i-10].close-1,b.close/candles[i-20].close-1,vol,b.close/e50-1,b.close/e200-1,b.volume/(volumeMean||1)-1,(b.high-b.low)/b.close];
    return {...b,x,ema50:e50,ema200:e200,breakout:Math.max(...prev.map(x=>x.high)),volumeMean};
  });
}
export function barrierLabel(candles,i,c) {
  if(i+c.horizon+1>=candles.length)return null;
  const entry=candles[i+1].open*(1+c.slippage),levels=exitLevels(entry,c);
  for(let j=i+1;j<=i+c.horizon;j++) {
    const b=candles[j];
    if(b.time!==candles[i].time+(j-i)*BAR)return null;
    if(b.open<=levels.stop)return 0;
    if(b.open>=levels.target)return 1;
    if(b.low<=levels.stop)return 0; // Worst-case ordering for ambiguous candles.
    if(b.high>=levels.target)return 1;
  }
  return 0; // Binary target: take-profit first vs stop/time barrier.
}
export function dataset(candles,c) {
  const f=features(candles),out=[];
  for(let i=200;i<candles.length-c.horizon-1;i++) {
    const y=barrierLabel(candles,i,c);
    if(y!==null&&f[i].x.every(Number.isFinite))out.push({x:f[i].x,y,time:candles[i].time});
  }
  return out;
}
