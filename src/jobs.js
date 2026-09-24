import { parentPort,workerData,isMainThread } from 'node:worker_threads';
import { mkdirSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { config,ROOT } from './config.js';
import { Store } from './store.js';
import { exchangeTime,history } from './market.js';
import { BAR } from './risk.js';
import { trainModel } from './training.js';
import { backtest } from './backtest.js';
const report=message=>{if(parentPort)parentPort.postMessage({message});else console.log(message);};
export async function runJob(type,root=ROOT,c=config) {
  const store=new Store(path.join(root,'data','paper.sqlite'),c.initialBalance);
  try {
    if(type==='train') {
      const now=await exchangeTime(),end=Math.floor(now/BAR)*BAR;
      for(const symbol of c.symbols) {
        report(`Downloading ${c.trainingDays} days of ${symbol} candles…`);
        const bars=await history(symbol,end-c.trainingDays*86400_000,end);
        store.saveCandles(symbol,bars);
        report(`Training ${symbol} and checking a later holdout period…`);
        const m=trainModel(bars,c,now);
        // Save rejected models too: never keep trading an old model silently after a failed quality check.
        store.putModel(symbol,m);
        const message=`${symbol}: ${m.validation.passed?'validation passed':'validation failed; entries blocked'} — ${m.validation.reason}. Brier ${m.validation.brier.toFixed(4)} vs baseline ${m.validation.baselineBrier.toFixed(4)}; ${m.trees.length} trees (${m.validation.count} holdout examples)`;
        report(message);
        store.event(message);
      }
      store.event('Model training completed. Review validation scores in the dashboard.');
    } else if(type==='backtest') {
      const all=Object.fromEntries(c.symbols.map(s=>[s,store.candles(s)]));
      report('Running walk-forward backtest with normal and doubled execution costs…');
      const result={normal:backtest(all,c),stress:backtest(all,c,{costMultiplier:2})};
      mkdirSync(path.join(root,'data'),{recursive:true});
      writeFileSync(path.join(root,'data','backtest.json'),JSON.stringify(result,null,2));
      report(`Backtest complete: ${result.normal.trades.length} trades; ${result.normal.netPnl.toFixed(2)} USDT net P&L. This does not establish future profitability.`);
    } else throw Error('Unknown job');
  }finally{store.close();}
}
if(!isMainThread || process.argv[1]?.endsWith('jobs.js')) {
  runJob(workerData?.type||process.argv[2]).then(()=>parentPort?.postMessage({done:true})).catch(e=>{report(`Failed: ${e.message}`);if(parentPort)parentPort.postMessage({error:e.message});else process.exitCode=1;});
}
