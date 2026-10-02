import { predict } from './model.js';
import { modelReady } from './lifecycle.js';
import { signal,regime,riskStatus,freshQuote,stakeSize,remainingRiskBudget } from './risk.js';
import { withinDomain,supportedEvidence } from './model-support.js';

function validRow(row) {
  return !!row&&['time','end','close','ema50','ema200','breakout','volume','volumeMean'].every(k=>Number.isFinite(row[k]))&&row.time>=0&&row.time%900000===0&&row.end===row.time+899999&&row.close>0&&row.volume>=0&&row.volumeMean>0&&Array.isArray(row.x)&&row.x.length===8&&row.x.every(Number.isFinite);
}

export function tradeDecision({model,row,quote,state,now,localNow=now,c}) {
  const rowValid=validRow(row),score=rowValid?predict(model,row.x):NaN;
  const marketRegime=rowValid?regime(row,c):null,evidence=model?.validation?.economic?.regimes?.[marketRegime];
  let reason=null;
  if(!state.enabled)reason='Entries paused';
  else if(state.position)reason='Existing exposure';
  else if(riskStatus(state,now,c).blocked)reason=riskStatus(state,now,c).reason;
  else if(!modelReady(model,c,now))reason='Model not validated/fresh';
  else if(!rowValid||!Number.isFinite(now)||now-row.end<0||now-row.end>120000)reason='Invalid signal or outside entry window';
  else if(!freshQuote(quote,localNow,c))reason='Quote stale or spread too wide';
  else if(!signal(row,score,c))reason='Trend or score filter';
  else if(!withinDomain(model,row.x))reason='Features outside observed training range';
  else if(!supportedEvidence(evidence,c))reason='Insufficient positive net-payoff evidence for regime';
  else if(!Number.isFinite(evidence.minScore)||!Number.isFinite(evidence.maxScore)||score<evidence.minScore||score>evidence.maxScore)reason='Score outside observed regime evidence range';
  else if(Math.abs(quote.ask/row.close-1)>c.maxEntryDrift)reason='Entry drift';
  else if(!stakeSize(state.cash,state.cash,{...c,riskFraction:remainingRiskBudget(state,now,c)/state.cash}))reason='Insufficient stake/risk budget';
  return {trade:reason===null,reason,score:Number.isFinite(score)?score:null,marketRegime,expectedNetReturn:evidence?.expectedNetReturn??null,evidenceCount:evidence?.count??0,target:'long TP before stop/expiry'};
}
