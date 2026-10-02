import { parentPort,workerData,isMainThread } from 'node:worker_threads';
import { mkdirSync,writeFileSync,renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { config,ROOT } from './config.js';
import { Store } from './store.js';
import { exchangeTime,history } from './market.js';
import { BAR } from './risk.js';
import { trainModel } from './training.js';
import { backtest } from './backtest.js';
import { trainingWindow } from './lifecycle.js';
const report=message=>{if(parentPort)parentPort.postMessage({message});else console.log(message);};
export async function runJob(type,root=ROOT,c=config,{readTime=exchangeTime,fetchHistory=history,train=trainModel}={}) {
  const store=new Store(path.join(root,'data','paper.sqlite'),c.initialBalance);
  try {
    if(type==='train') {
      const now=await readTime(),end=Math.floor(now/BAR)*BAR,failures=[];
      for(const symbol of c.symbols) {
        try {
        report(`Downloading ${c.trainingDays+30} days of ${symbol} candles; training window ${c.trainingDays} days…`);
        const bars=await fetchHistory(symbol,end-(c.trainingDays+30)*86400_000,end);
        store.saveCandles(symbol,bars);
        report(`Training ${symbol} and checking a later holdout period…`);
        const m=train(trainingWindow(bars,c,now),c,now);
        // Save rejected models too: never keep trading an old model silently after a failed quality check.
        store.putModel(symbol,m);
        const message=`${symbol}: ${m.validation.passed?'validation passed':'validation failed; entries blocked'} — ${m.validation.reason}. Brier ${m.validation.brier.toFixed(4)} vs baseline ${m.validation.baselineBrier.toFixed(4)}; ${m.trees.length} trees (${m.validation.count} holdout examples)`;
        report(message);
        store.event(message);
        } catch(e) {const message=`${symbol}: training failed — ${e.message}`;failures.push(message);report(message);store.event(message);}
      }
      if(failures.length)throw Error(failures.join('; '));
      store.event('Model training completed. Review validation scores in the dashboard.');
    } else if(type==='backtest') {
      const all=Object.fromEntries(c.symbols.map(s=>[s,store.candles(s)]));
      report('Running walk-forward backtest with normal and doubled execution costs…');
      const normal=backtest(all,c);
      const result={normal,stress:backtest(all,c,{costMultiplier:2,modelSchedule:normal.modelSchedule})};
      mkdirSync(path.join(root,'data'),{recursive:true});
      const target=path.join(root,'data','backtest.json'),temporary=target+'.'+randomUUID()+'.tmp';
      writeFileSync(temporary,JSON.stringify(result,null,2));renameSync(temporary,target);
      report(`Backtest complete: ${result.normal.trades.length} trades; ${result.normal.netPnl.toFixed(2)} USDT net P&L. This does not establish future profitability.`);
    } else throw Error('Unknown job');
  }finally{store.close();}
}
if(!isMainThread || process.argv[1]?.endsWith('jobs.js')) {
  runJob(workerData?.type||process.argv[2]).then(()=>parentPort?.postMessage({done:true})).catch(e=>{report(`Failed: ${e.message}`);if(parentPort)parentPort.postMessage({error:e.message});else process.exitCode=1;});
}
