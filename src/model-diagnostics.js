import { supportedEvidence } from './model-support.js';
// Explain validation rejection without changing acceptance thresholds or scores.
// Runtime freshness/configuration checks remain separate in modelReady.
export function modelDiagnostics(m,c) {
  const v=m?.validation,e=v?.economic;
  if(!v)return {failures:['No validation report'],selected:0,required:c.minEvidenceTrades};
  const failures=[];
  if(!m.trees?.length)failures.push('No predictive trees selected');
  if(v.qualityPassed!==true)failures.push('Predictive improvement not established');
  if(m.calibration?.status!=='fitted_on_separate_chronological_period')failures.push('Insufficient calibration coverage');
  if((e?.count??0)<c.minEvidenceTrades)failures.push('Too few independent selected trades');
  if(!supportedEvidence(e,c))failures.push('Positive net payoff not established');
  if(!Object.values(e?.regimes??{}).some(r=>supportedEvidence(r,c)))failures.push('No supported market regime');
  return {failures,selected:e?.count??0,required:c.minEvidenceTrades,
    targetFrequency:v.holdoutPositiveRate??null,meanScore:v.predictions?.meanPredicted??null,
    aboveThreshold:(v.predictions?.tp??0)+(v.predictions?.fp??0),
    selectionFunnel:e?.selectionFunnel??null,
    note:'TP-first classification accuracy is not trading profitability. Rejection is not a reason to lower thresholds.'};
}
