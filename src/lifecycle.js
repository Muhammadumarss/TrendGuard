import { signature } from './config.js';
import { validParameters } from './model.js';
import { validDomain,supportedEvidence } from './model-support.js';
export function validatedModel(m,c) {
  const v=m?.validation;
  return !!(validParameters(m)&&m.trees.length>0&&validDomain(m.featureDomain)&&m.calibration?.status==='fitted_on_separate_chronological_period'&&
    v?.passed===true&&v.qualityPassed===true&&Number.isInteger(v.count)&&v.count>=100&&Number.isFinite(v.brier)&&v.brier>=0&&Number.isFinite(v.baselineBrier)&&v.baselineBrier>v.brier&&
    Number.isFinite(v.improvement?.lower)&&v.improvement.lower>0&&supportedEvidence(v.economic,c)&&Object.values(v.economic.regimes??{}).some(e=>supportedEvidence(e,c)));
}
export function modelReady(m,c,now) {
  return !!(Number.isFinite(now)&&validatedModel(m,c)&&m.signature===signature(c)&&
    Number.isFinite(m.trainedAt)&&Number.isFinite(m.dataThrough)&&now>=m.trainedAt&&now>=m.dataThrough&&
    now-m.trainedAt<=c.modelMaxAgeHours*3600000&&now-m.dataThrough<=c.modelMaxAgeHours*3600000);
}
export const trainingDue=(m,c,now)=>!m||m.signature!==signature(c)||now-m.trainedAt>=c.retrainHours*3600000;
export const trainingWindow=(bars,c,now)=>bars.filter(b=>b.end<now&&b.time>=Math.floor(now/900000)*900000-c.trainingDays*86400000);
