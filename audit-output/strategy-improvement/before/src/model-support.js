// Empirical feature envelope: prevents unsupported extrapolation, not a drift detector.
export function featureDomain(rows) {
  return Array.from({length:8},(_,i)=>({min:Math.min(...rows.map(r=>r.x[i])),max:Math.max(...rows.map(r=>r.x[i]))}));
}
export function validDomain(domain) {
  return Array.isArray(domain)&&domain.length===8&&domain.every(r=>r&&Number.isFinite(r.min)&&Number.isFinite(r.max)&&r.min<=r.max);
}
export function withinDomain(model,x) {
  return validDomain(model?.featureDomain)&&Array.isArray(x)&&x.length===8&&x.every((v,i)=>Number.isFinite(v)&&v>=model.featureDomain[i].min&&v<=model.featureDomain[i].max);
}
export function supportedEvidence(e,c) {
  return !!(e?.supported===true&&Number.isInteger(e.count)&&e.count>=c.minEvidenceTrades&&Number.isFinite(e.expectedNetReturn)&&e.expectedNetReturn>0&&Number.isFinite(e.interval?.lower)&&e.interval.lower>0&&Number.isFinite(e.interval?.upper)&&e.interval.upper>=e.interval.lower);
}
