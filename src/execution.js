// Candles contain trade prices, not quotes. The spread is an explicit scenario.
export const askFromPrice=(price,c)=>price*(1+(c.backtestSpread??0)/2);
export const bidFromPrice=(price,c)=>price*(1-(c.backtestSpread??0)/2);
export function sale(qty,bid,fee,slippage) {
  if (![qty,bid,fee,slippage].every(Number.isFinite) || qty<=0 || bid<=0 || fee<0 || fee>=1 || slippage<0 || slippage>=1)
    throw Error('Invalid sale inputs');
  const price=bid*(1-slippage),gross=qty*price,exitFee=gross*fee;
  return {price,exitFee,proceeds:gross-exitFee};
}
export function quoteExit(p,bid,now) {
  if (bid<=p.stop) return 'stop_loss';
  if (now>=p.expiresAt) return 'time_barrier';
  if (bid>=p.target) return 'take_profit';
  return null;
}
export function candleExit(p,b,c) {
  const open=bidFromPrice(b.open,c),low=bidFromPrice(b.low,c),high=bidFromPrice(b.high,c);
  if (open<=p.stop) return {bid:open,at:b.time,reason:'gap_stop',timing:'open'};
  if (b.time>=p.expiresAt) return {bid:open,at:b.time,reason:'time_barrier',timing:'open'};
  if (open>=p.target) return {bid:open,at:b.time,reason:'gap_target',timing:'open'};
  if (low<=p.stop) return {bid:p.stop,at:b.end,reason:'stop_loss',timing:'within_candle',ambiguous:high>=p.target};
  if (high>=p.target) return {bid:p.target,at:b.end,reason:'take_profit',timing:'within_candle'};
  return null;
}
