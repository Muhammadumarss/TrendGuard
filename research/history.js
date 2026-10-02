import { readFileSync } from 'node:fs';
import { BAR } from '../src/risk.js';
import { validateBars } from '../src/data.js';

export function parseArchive(text,{quarantine=null}={}) {
  const bars=text.trim().split(/\r?\n/).map(line=>{
    const r=line.split(',');if(r.length<7||r.slice(0,7).some(x=>x===''))throw Error('Malformed archive row');
    const rawTime=Number(r[0]),rawEnd=Number(r[6]);
    const micros=rawTime>=1e14,time=micros?rawTime/1000:rawTime,end=micros?Math.floor(rawEnd/1000):rawEnd;
    const b={time,end,open:+r[1],high:+r[2],low:+r[3],close:+r[4],volume:+r[5]};
    if(quarantine&&b.volume===0&&b.open===b.close&&b.high===b.close&&b.low===b.close&&b.end>=b.time&&b.end<b.time+BAR-1) {
      validateBars([{...b,end:b.time+BAR-1}]);
      quarantine.push({...b,reason:'Truncated zero-volume archive interval; omitted, not synthesized'});return null;
    }
    validateBars([b]);return b;
  }).filter(Boolean);
  for(let i=1;i<bars.length;i++)if(bars[i].time<=bars[i-1].time)throw Error('Duplicate or unordered archive');
  return bars;
}

export function loadHistory(dir,symbols) {
  const quarantined={};
  const original=Object.fromEntries(symbols.map(s=>{quarantined[s]=[];return [s,parseArchive(readFileSync(new URL(`${s}-15m.csv`,dir),'utf8'),{quarantine:quarantined[s]})];}));
  const maps=Object.fromEntries(symbols.map(s=>[s,new Map(original[s].map(b=>[b.time,b]))]));
  const times=original[symbols[0]].map(b=>b.time).filter(t=>symbols.every(s=>maps[s].has(t)));
  const gaps=[];for(let i=1;i<times.length;i++)if(times[i]!==times[i-1]+BAR)gaps.push({after:times[i-1],before:times[i],missingBars:(times[i]-times[i-1])/BAR-1});
  return {all:Object.fromEntries(symbols.map(s=>[s,times.map(t=>maps[s].get(t))])),gaps,quarantined,
    excludedByAlignment:Object.fromEntries(symbols.map(s=>[s,original[s].length-times.length]))};
}
