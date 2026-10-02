import { BAR, exitLevels } from './risk.js';
import { askFromPrice,bidFromPrice,candleExit,sale } from './execution.js';
export const FEATURE_WINDOW=299;
export function features(candles) {
  return candles.map((b,i)=>{
    if(i<FEATURE_WINDOW-1)return null;
    // Identical finite warmup at each timestamp, regardless of caller history length.
    let e50=candles[i-FEATURE_WINDOW+1].close,e200=e50;
    for(let j=i-FEATURE_WINDOW+2;j<=i;j++) {e50+=(candles[j].close-e50)*2/51;e200+=(candles[j].close-e200)*2/201;}
    const prev=candles.slice(i-20,i);
    const returns=candles.slice(i-19,i+1).map((x,j)=>x.close/candles[i-20+j].close-1);
    const mean=returns.reduce((s,x)=>s+x,0)/20;
    const vol=Math.sqrt(returns.reduce((s,x)=>s+(x-mean)**2,0)/20);
    const volumeMean=prev.reduce((s,x)=>s+x.volume,0)/20;
    const x=[b.close/candles[i-1].close-1,b.close/candles[i-10].close-1,b.close/candles[i-20].close-1,vol,b.close/e50-1,b.close/e200-1,volumeMean>0?b.volume/volumeMean-1:NaN,(b.high-b.low)/b.close];
    return {...b,x,ema50:e50,ema200:e200,breakout:Math.max(...prev.map(x=>x.high)),volumeMean};
  });
}
export function barrierLabel(candles,i,c) {
  return labelOutcome(candles,i,c)?.y??null;
}
export function labelOutcome(candles,i,c) {
  if(i+c.horizon+1>=candles.length)return null;
  const ask=askFromPrice(candles[i+1].open,c),bid=bidFromPrice(candles[i+1].open,c);
  const entryDrift=Math.abs(ask/candles[i].close-1),executionEligible=entryDrift<=c.maxEntryDrift&&ask/bid-1<=c.maxSpread;
  const entry=ask*(1+c.slippage),levels=exitLevels(entry,c);
  const position={...levels,expiresAt:candles[i+1].time+c.horizon*BAR};
  for(let j=i+1;j<=i+c.horizon+1;j++) {
    const b=candles[j];
    if(b.time!==candles[i].time+(j-i)*BAR)return null;
    const fill=candleExit(position,b,c);
    if(fill) {
      const outcome=fill.reason.includes('target')||fill.reason==='take_profit'?'take_profit':fill.reason.includes('stop')?'stop_loss':'time_barrier';
      return {y:outcome==='take_profit'?1:0,outcome,netReturn:sale(1,fill.bid,c.fee,c.slippage).proceeds/(entry*(1+c.fee))-1,closedAt:fill.at,entryDrift,executionEligible};
    }
  }
  return null;
}
export function dataset(candles,c) {
  const f=features(candles),out=[];
  for(let i=FEATURE_WINDOW-1;i<candles.length-c.horizon-1;i++) {
    const label=labelOutcome(candles,i,c);
    if(label&&f[i].x.every(Number.isFinite))out.push({...label,x:f[i].x,time:candles[i].time,row:f[i]});
  }
  return out;
}
