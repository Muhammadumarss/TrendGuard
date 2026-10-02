// Explicit synthetic acceptance evidence for execution tests; never used by the app.
import { signature } from '../src/config.js';
export function acceptedModel(c,now) {
  const evidence={supported:true,count:100,expectedNetReturn:.01,minScore:.6,maxScore:1,interval:{lower:.001,upper:.02}};
  return {version:3,base:Math.log(4),trees:[{feature:0,threshold:0,left:0,right:0}],rate:.08,
    featureDomain:Array.from({length:8},()=>({min:-1e6,max:1e6})),calibration:{slope:1,intercept:0,status:'fitted_on_separate_chronological_period'},
    signature:signature(c),trainedAt:now,dataThrough:now-1,validation:{passed:true,qualityPassed:true,count:200,brier:.05,baselineBrier:.1,improvement:{lower:.01},economic:{...evidence,regimes:{'bullish:low_volatility':{...evidence},'bullish:high_volatility':{...evidence}}}}};
}
