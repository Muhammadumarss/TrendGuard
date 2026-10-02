// Snapshot the latest local history and evaluate without publishing or placing orders.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,writeFileSync,readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { trainModel } from '../src/training.js';
import { trainingWindow } from '../src/lifecycle.js';
import { backtest } from '../src/backtest.js';
import { provenance } from '../src/provenance.js';
const dir=new URL('../audit-output/production-review/',import.meta.url);mkdirSync(dir,{recursive:true});
const snapshot=new URL('market-data.json',dir);let all;
try{all=JSON.parse(readFileSync(snapshot,'utf8'));}
catch{const db=new DatabaseSync(fileURLToPath(new URL('../data/paper.sqlite',import.meta.url)),{readOnly:true});db.exec('BEGIN');all=Object.fromEntries(config.symbols.map(s=>[s,db.prepare('SELECT body FROM candles WHERE symbol=? ORDER BY time').all(s).map(r=>JSON.parse(r.body))]));db.exec('COMMIT');db.close();writeFileSync(snapshot,JSON.stringify(all));}
const now=all[config.symbols[0]].at(-1).end+1,models={};
for(const symbol of config.symbols){console.log(`Evaluating latest ${symbol} model`);models[symbol]=trainModel(trainingWindow(all[symbol],config,now),config,now);}
writeFileSync(new URL('models.json',dir),JSON.stringify(models,null,2));
let fits=0;
const trainer=(bars,c,at)=>{if(fits++%10===0)console.log(`Walk-forward fit ${fits}, data cutoff ${new Date(at).toISOString()}`);return trainModel(bars,c,at);};
const normal=backtest(all,config,{trainer});console.log('Replaying doubled execution costs');const stress=backtest(all,config,{costMultiplier:2,modelSchedule:normal.modelSchedule});
writeFileSync(new URL('backtest.json',dir),JSON.stringify({normal,stress},null,2));
const summary={provenance:provenance(config,all),from:normal.from,to:normal.to,candles:all[config.symbols[0]].length,fits,models:Object.fromEntries(Object.entries(models).map(([s,m])=>[s,{trees:m.trees.length,calibration:m.calibration,...m.validation}])),normal:normal.metrics,stress:stress.metrics,trainingErrors:normal.folds.filter(f=>f.error),note:'Frozen latest local data; not a prospective test. Existing paper account and published models untouched.'};
writeFileSync(new URL('summary.json',dir),JSON.stringify(summary,null,2));console.log(JSON.stringify({from:new Date(normal.from),to:new Date(normal.to),fits,trainingErrors:summary.trainingErrors.length,normalTrades:normal.trades.length,stressTrades:stress.trades.length,models:Object.fromEntries(Object.entries(models).map(([s,m])=>[s,{passed:m.validation.passed,brier:m.validation.brier,baseline:m.validation.baselineBrier,selected:m.validation.economic.count}]))},null,2));
