const finite=(v)=>typeof v==='number'&&Number.isFinite(v);
const near=(a,b)=>Math.abs(a-b)<=1e-7*Math.max(1,Math.abs(a),Math.abs(b));
function position(p) {
  if(!p||typeof p.id!=='string'||!['BTCUSDT','ETHUSDT'].includes(p.symbol))throw Error('Invalid position identity');
  for(const k of ['entry','qty','cost','stop','target'])if(!finite(p[k])||p[k]<=0)throw Error(`Invalid position ${k}`);
  for(const k of ['openedAt','expiresAt','entryFee','fee','slippage'])if(!finite(p[k])||p[k]<0)throw Error(`Invalid position ${k}`);
  if(p.fee>=1||p.slippage>=1||p.stop>=p.entry||p.target<=p.entry||p.expiresAt<=p.openedAt ||
     !near(p.cost,p.qty*p.entry*(1+p.fee)) || !near(p.entryFee,p.qty*p.entry*p.fee))throw Error('Invalid position accounting');
}
export function validateState(s) {
  if(s.version!==2||!finite(s.cash)||s.cash<0||!finite(s.initialBalance)||s.initialBalance<=0||typeof s.enabled!=='boolean'||!Array.isArray(s.trades)||!s.lastSignals||Array.isArray(s.lastSignals)||typeof s.lastSignals!=='object'||!finite(s.lastPoll)||s.lastPoll<0)throw Error('Account state is invalid; refusing trading');
  if(Object.values(s.lastSignals).some(t=>!finite(t)||t<0))throw Error('Invalid signal history');
  const ids=new Set();let last=-1,pnl=0;
  for(const t of s.trades) {
    position(t);
    if(ids.has(t.id)||!['exit','closedAt','pnl','exitFee','fees'].every(k=>finite(t[k]))||t.exit<=0||t.closedAt<t.openedAt||t.openedAt<last||t.exitFee<0||t.fees<0||typeof t.reason!=='string')throw Error('Invalid trade state');
    if(!near(t.exitFee,t.qty*t.exit*t.fee)||!near(t.fees,t.entryFee+t.exitFee)||!near(t.pnl,t.qty*t.exit-t.exitFee-t.cost))throw Error('Invalid trade accounting');
    ids.add(t.id);last=t.closedAt;pnl+=t.pnl;
  }
  if(s.position){position(s.position);if(ids.has(s.position.id)||s.position.openedAt<last)throw Error('Overlapping position history');}
  if(!near(s.cash+(s.position?.cost??0),s.initialBalance+pnl))throw Error('Account conservation failed');
  if(s.risk&&(!finite(s.risk.peakEquity)||s.risk.peakEquity<s.initialBalance||typeof s.risk.drawdownHalt!=='boolean'))throw Error('Invalid risk state');
  return s;
}
