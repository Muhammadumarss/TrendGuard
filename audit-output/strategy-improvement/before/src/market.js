import { BAR } from './risk.js';
import { validateBars } from './data.js';
const BASE='https://data-api.binance.vision';
export function createRequester({fetchImpl=(...args)=>fetch(...args),clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}) {
  let retryAt=0;
  return async function request(route,params={}) {
  if(clock()<retryAt)throw Error(`Market API rate-limit cooldown until ${new Date(retryAt).toISOString()}`);
  let last;
  for(let attempt=0;attempt<3;attempt++) {
    if(clock()<retryAt)throw Error(`Market API rate-limit cooldown until ${new Date(retryAt).toISOString()}`);
    try {
      const res=await fetchImpl(`${BASE}${route}?${new URLSearchParams(params)}`,{signal:AbortSignal.timeout(15_000)});
      if(!res.ok) {
        if(res.status===429||res.status===418){
          const header=res.headers?.get('retry-after'),seconds=header===null||header===undefined?NaN:Number(header);
          retryAt=clock()+(Number.isFinite(seconds)&&seconds>0?seconds:(res.status===418?120:60))*1000;
          const e=Error(`Market API HTTP ${res.status}; rate-limit cooldown until ${new Date(retryAt).toISOString()}`);e.permanent=true;throw e;
        }
        const e=Error(`Market API HTTP ${res.status}. Public market data may be unavailable in your region or network.`);
        e.permanent=res.status>=400&&res.status<500&&res.status!==429;
        throw e;
      }
      return await res.json();
    } catch(e) {last=e;if(e.permanent)throw e;if(attempt<2)await sleep(1000*(attempt+1));}
  }
  throw Error(`Market data request failed after 3 attempts: ${last.message}`);
  };
}
export const request=createRequester();
export async function exchangeTime() {
  const r=await request('/api/v3/time');
  if(!Number.isFinite(r.serverTime))throw Error('Invalid exchange timestamp');
  if(Math.abs(Date.now()-r.serverTime)>30_000)throw Error('Computer clock differs from exchange by more than 30 seconds. Sync Windows time.');
  return r.serverTime;
}
export function parseBars(raw,now) {
  if(!Array.isArray(raw))throw Error('Invalid candle response');
  if(!Number.isFinite(now))throw Error('Invalid candle cutoff');
  const rows=raw.map(r=>{
    if(!Array.isArray(r)||r.length<7||r.slice(0,7).some(v=>v===null||v===''||v===undefined))throw Error('Malformed raw candle');
    return {time:+r[0],open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5],end:+r[6]};
  });
  validateBars(rows); // Validate open/invalid rows before filtering, including timestamps.
  return rows.filter(r=>r.end<now);
}
export async function recent(symbol,now) {return parseBars(await request('/api/v3/klines',{symbol,interval:'15m',limit:300}),now);}
export async function history(symbol,start,end) {
  let rows=[],cursor=start;
  while(cursor<end) {
    const raw=await request('/api/v3/klines',{symbol,interval:'15m',startTime:cursor,endTime:end-1,limit:1000});
    if(!Array.isArray(raw)||!raw.length)break;
    const batch=parseBars(raw,end);
    if(!batch.length)break;
    rows.push(...batch);cursor=batch.at(-1).time+BAR;
    if(raw.length<1000)break;
  }
  if(rows.length<200||rows[0].time>start+BAR||rows.at(-1).end<end-BAR-1)throw Error('Insufficient market history returned');
  for(let i=1;i<rows.length;i++)if(rows[i].time!==rows[i-1].time+BAR)throw Error('Historical candle gap');
  return rows;
}
export async function quote(symbol) {
  const started=Date.now(),r=await request('/api/v3/ticker/bookTicker',{symbol});
  const bid=+r.bidPrice,ask=+r.askPrice;
  if(!Number.isFinite(bid)||!Number.isFinite(ask)||bid<=0||ask<bid||Date.now()-started>10_000)throw Error('Invalid market quote');
  // REST bookTicker has no exchange timestamp; freshness uses request duration and receipt time.
  return {bid,ask,at:Date.now()};
}
