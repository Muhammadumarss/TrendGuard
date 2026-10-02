// Frozen hypotheses. No import from the running paper engine's decision path.
import { BAR,signal } from '../src/risk.js';
import { features } from '../src/features.js';

export function aggregate(bars,multiple) {
  const width=BAR*multiple,out=[];let group=[];
  for(const b of bars) {
    if(b.time%width===0)group=[b];
    else if(group.length&&b.time===group.at(-1).time+BAR)group.push(b);
    else group=[];
    if(group.length===multiple) {
      out.push({time:group[0].time,end:b.end,open:group[0].open,close:b.close,
        high:Math.max(...group.map(r=>r.high)),low:Math.min(...group.map(r=>r.low)),volume:group.reduce((n,r)=>n+r.volume,0)});
      group=[];
    }
  }
  return out;
}

function indicators(bars,width) {
  let segmentStart=0;
  return bars.map((b,i)=>{
    if(i&&b.time!==bars[i-1].time+width)segmentStart=i;
    if(i-segmentStart<200)return null;
    const prior=bars.slice(i-20,i),window=bars.slice(i-19,i+1),mean=window.reduce((n,r)=>n+r.close,0)/20;
    const sd=Math.sqrt(window.reduce((n,r)=>n+(r.close-mean)**2,0)/20);
    const sma=n=>bars.slice(i-n+1,i+1).reduce((v,r)=>v+r.close,0)/n;
    let gain=0,loss=0;
    for(let j=i-13;j<=i;j++){const delta=bars[j].close-bars[j-1].close;gain+=Math.max(0,delta);loss+=Math.max(0,-delta);}
    return {...b,sma20:mean,sma50:sma(50),sma65:sma(65),sma200:sma(200),lower:mean-2*sd,
      rsi:gain+loss>0?100*gain/(gain+loss):50,breakout:Math.max(...prior.map(r=>r.high)),volumeMean:prior.reduce((n,r)=>n+r.volume,0)/20};
  });
}

export function prepareCandidates(bars) {
  const hourly=indicators(aggregate(bars,4),4*BAR),fourHourly=indicators(aggregate(bars,16),16*BAR),daily=indicators(aggregate(bars,96),96*BAR);
  const legacy=features(bars),result=[];let h=-1,f=-1,d=-1,contiguous=0;
  for(let i=0;i<bars.length;i++) {
    const b=bars[i];contiguous=i&&b.time===bars[i-1].time+BAR?contiguous+1:1;
    result.push({bar:b,legacy:contiguous>=299?legacy[i]:null});
  }
  const rawHour=aggregate(bars,4),rawFour=aggregate(bars,16),rawDay=aggregate(bars,96);
  h=f=d=-1;
  for(const row of result) {
    const end=row.bar.end;
    while(h+1<rawHour.length&&rawHour[h+1].end<=end)h++;
    while(f+1<rawFour.length&&rawFour[f+1].end<=end)f++;
    while(d+1<rawDay.length&&rawDay[d+1].end<=end)d++;
    row.hour=hourly[h]??null;row.previousHour=hourly[h-1]??null;row.fourHour=fourHourly[f]??null;
    row.day=daily[d]??null;row.previousDay=daily[d-1]??null;
  }
  return result;
}

export function candidateSignal(row,policy,c) {
  if(!row)return false;
  if(policy.signal==='legacy')return !!signal(row.legacy,1,c);
  const h=row.hour,p=row.previousHour,f=row.fourHour,b=row.bar;
  if(policy.signal==='daily_momentum') {
    const d=row.day,prev=row.previousDay;
    return !!(d&&prev&&d.end===b.end&&d.time===prev.time+96*BAR&&d.close>d.sma65&&prev.close<=prev.sma65);
  }
  if(!h||!p||!f||h.end!==b.end||h.time!==p.time+4*BAR||b.end-f.end>=16*BAR||h.volumeMean<=0)return false;
  const bullish=f.sma50>f.sma200&&f.close>f.sma50;
  if(policy.signal==='hourly_breakout')return bullish&&h.close>h.breakout&&h.volume>h.volumeMean;
  if(policy.signal==='hourly_pullback')return bullish&&p.close<=p.sma20&&h.close>h.sma20&&h.close>p.high&&h.volume>h.volumeMean;
  if(policy.signal==='hourly_rebound')return f.sma50<f.sma200&&f.close<f.sma50&&p.rsi<30&&p.close<p.lower&&h.rsi>=30&&h.close>h.lower&&h.close>p.high&&h.volume>h.volumeMean;
  throw Error('Unknown candidate signal');
}
