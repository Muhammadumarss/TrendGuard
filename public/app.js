let token='',polling=false,lastJobRunning=false,errorSource='',retryResults=false;
const $=id=>document.getElementById(id);
const money=n=>Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
const stamp=n=>Number.isFinite(n)?new Date(n).toISOString().replace('T',' ').slice(0,19):'—';
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function error(message,source='action'){errorSource=message?source:'';$('error').textContent=message;$('error').hidden=!message;}
async function call(route,method='GET') {const r=await fetch(`/api/${route}`,{method,headers:{'Content-Type':'application/json','X-Trendguard-Token':token}});const d=await r.json();if(!r.ok)throw Error(d.error||r.statusText);return d;}
function detail(label,value){return `<div class="detail"><span>${escape(label)}</span><strong>${escape(value)}</strong></div>`;}
async function results(){try{const r=await call('backtest'),a=r.normal,b=r.stress;$('results').className='';$('results').innerHTML=detail('Net P&L',`${money(a.netPnl)} USDT`)+detail('Trades / lock violations',`${a.trades.length} / ${a.lockViolations}`)+detail('Maximum drawdown',`${(a.maxDrawdown*100).toFixed(2)}%`)+detail('Doubled-cost net P&L',`${money(b.netPnl)} USDT`);if(!a.trades.length)$('results').innerHTML+='<p class="bad">No trades: this result does not validate the strategy.</p>';retryResults=false;}catch(e){retryResults=true;$('results').className='bad';$('results').textContent='Unable to load backtest results: '+e.message;}}
async function refresh(){if(polling)return;polling=true;try{
 const d=await call('status');token=d.token;const s=d.state;
 $('equity').textContent=money(d.equity)+(d.markEstimated?' *':'');const pnl=s.trades.reduce((n,t)=>n+t.pnl,0); // Total P&L is equity change minus open mark; server supplies full totals below.
 $('pnl').textContent=money(d.totalPnl??pnl);$('pnl').className=(d.totalPnl??pnl)>=0?'good':'bad';$('count').textContent=d.totalTrades??s.trades.length;
 $('winrate').textContent=(d.totalTrades??s.trades.length)?`${((d.wins??s.trades.filter(t=>t.pnl>0).length)/(d.totalTrades??s.trades.length)*100).toFixed(1)}% winning trades`:'Waiting for results';
 $('risk').textContent=`${(d.settings.riskFraction*100).toFixed(2)}% planned risk · not a guaranteed limit`;
 $('status').textContent=d.lockError?'Risk history error':d.lockUntil?'Daily loss lock':d.risk?.blocked?d.risk.reason:s.enabled?'Paper agent enabled':'Entries paused';
 $('status-dot').style.background=d.health.ok?'#9be4be':'#ff9797';$('health').textContent=d.health.message;
 $('reset').textContent=d.lockUntil?`Eligible again ${stamp(d.lockUntil)} UTC, if checks pass.`:'';
 $('markets').innerHTML=['BTCUSDT','ETHUSDT'].map((symbol,i)=>{const m=d.markets[symbol]||{};return `<div class="market"><div class="coin"><span class="coin-icon ${i?'eth':''}">${i?'Ξ':'₿'}</span><div><strong>${i?'Ethereum':'Bitcoin'}</strong><small>${symbol}</small></div></div><div class="right"><strong>${money(m.quote?.bid)}</strong><small>Score ${Number.isFinite(m.score)?m.score.toFixed(3):'—'} · ${m.signal&&m.ready?'Signal detected':'Watching'}</small></div></div>`;}).join('');
 $('models').innerHTML=Object.entries(d.models).map(([symbol,m])=>`<div class="model"><div><strong>${symbol}</strong><small>${m?`Holdout Brier ${m.validation.brier.toFixed(4)} / baseline ${m.validation.baselineBrier.toFixed(4)}`:'Train to download data and build a model'}</small><small>${m?'Trained '+stamp(m.trainedAt)+' UTC':''}</small><small>${m?escape(m.validation.reason||'')+' · '+m.trees+' trees · selected evidence '+(m.validation.economic?.count??0):''}</small>${m?.diagnostics?`<small>${escape(m.diagnostics.failures.join('; '))}</small><small>Score-qualified examples: ${escape(m.diagnostics.aboveThreshold)} · independent evidence: ${escape(m.diagnostics.selected)} / ${escape(m.diagnostics.required)}</small>`:''}</div><span class="pill ${m?.ready?'good':''}">${m?.ready?'Ready':m?'Blocked':'Not trained'}</span></div>`).join('');
 const p=s.position;$('close').hidden=!p;$('position').className=p?'':'empty';$('position').innerHTML=p?detail('Market',p.symbol)+detail('Entry',money(p.entry))+detail('Quantity',p.qty.toFixed(8))+detail('Stop / target',`${money(p.stop)} / ${money(p.target)}`)+detail('Opened (UTC)',stamp(p.openedAt)):'No open position. The agent waits for the trend, model, and risk checks to agree.';
 $('trades').innerHTML=s.trades.length?s.trades.map(t=>`<tr><td>${escape(t.symbol)}</td><td>${stamp(t.openedAt)}</td><td>${stamp(t.closedAt)}</td><td>${escape(t.reason)}</td><td>${money(t.fees)}</td><td class="${t.pnl>=0?'good':'bad'}">${money(t.pnl)}</td></tr>`).join(''):'<tr><td colspan="6">No completed trades yet.</td></tr>';
 $('events').innerHTML=d.events.length?d.events.map(e=>`<li><time>${stamp(e.at)}</time>${escape(e.text)}</li>`).join(''):'<li>Start the agent to train models and monitor real market data.</li>';
 $('job').textContent=d.job?.error||d.job?.message||'Start the agent to train automatically';$('train').disabled=$('backtest').disabled=!!d.job?.running;
 if((lastJobRunning||retryResults)&&!d.job?.running)await results();lastJobRunning=!!d.job?.running;
 if(errorSource==='connection')error('');
 }catch(e){error('Connection issue: '+e.message,'connection');}finally{polling=false;}}
for(const action of ['start','pause','train','backtest','close'])$(action).addEventListener('click',async()=>{if(action==='close'&&!confirm('Close the simulated position at the next available market quote?'))return;try{error('');await call(action,'POST');await refresh();}catch(e){error(e.message);}});
refresh();results();setInterval(refresh,4000);
