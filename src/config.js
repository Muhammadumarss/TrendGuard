import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function validateConfig(c) {
  if (c.mode !== 'paper') throw Error('This JavaScript edition supports paper execution only. No real orders are sent.');
  if (!Array.isArray(c.symbols) || c.symbols.length !== 2 || !['BTCUSDT','ETHUSDT'].every(x=>c.symbols.includes(x))) throw Error('Use BTCUSDT and ETHUSDT.');
  const bounds = {port:[1024,65535],initialBalance:[10,1e9],fee:[0,.01],slippage:[0,.01],stop:[.001,.10],takeProfit:[.001,.20],riskFraction:[.0001,.01],maxAllocation:[.01,.25],minStake:[1,1000],threshold:[.5,.95],horizon:[1,96],trainingDays:[30,180],modelMaxAgeHours:[1,72],retrainHours:[1,24],pollSeconds:[5,60],maxSpread:[.0001,.01],maxEntryDrift:[.0001,.02]};
  for(const [k,[lo,hi]] of Object.entries(bounds)) if(!Number.isFinite(c[k])||c[k]<lo||c[k]>hi) throw Error(`Invalid ${k}: expected ${lo}–${hi}`);
  for(const k of ['port','horizon','trainingDays','pollSeconds']) if(!Number.isInteger(c[k])) throw Error(`${k} must be an integer`);
  return c;
}
export const config = validateConfig(JSON.parse(readFileSync(path.join(ROOT,'config.json'),'utf8')));
// Include all label/feature assumptions in model identity.
export const signature = c => JSON.stringify({version:2,fee:c.fee,slippage:c.slippage,stop:c.stop,takeProfit:c.takeProfit,horizon:c.horizon});
