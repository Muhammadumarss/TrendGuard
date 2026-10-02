import express from 'express';
import { randomBytes,timingSafeEqual } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { config,ROOT } from './config.js';
import { Store } from './store.js';
import { Engine,modelReady } from './engine.js';
import { lockUntil } from './risk.js';
export function createApp(store,engine,c=config,startJob=()=>{}) {
  const app=express(),token=randomBytes(32).toString('hex');
  app.disable('x-powered-by');
  app.use((req,res,next)=>{
    const localPort=req.socket.localPort;
    const allowed=new Set([`localhost:${localPort}`,`127.0.0.1:${localPort}`]);
    if(!allowed.has(req.headers.host))return res.status(403).json({error:'Only local dashboard access is allowed'});
    res.set({'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store'});
    if(req.method!=='GET'&&req.method!=='HEAD') {
      const supplied=Buffer.from(req.headers['x-trendguard-token']||'');
      if(supplied.length!==token.length||!timingSafeEqual(supplied,Buffer.from(token)))return res.status(403).json({error:'Invalid dashboard token; refresh the page'});
      if(req.headers.origin && ![`http://localhost:${localPort}`,`http://127.0.0.1:${localPort}`].includes(req.headers.origin))return res.status(403).json({error:'Cross-origin request blocked'});
    }
    next();
  });
  app.use(express.json({limit:'8kb'}));
  app.get('/api/status',(req,res)=>{
    const s=store.read(),now=Date.now(),until=lockUntil(s.trades,now);
    const models=Object.fromEntries(c.symbols.map(symbol=>{const m=store.model(symbol);return [symbol,m?{trainedAt:m.trainedAt,validation:m.validation,ready:!!modelReady(m,c,now),trees:m.trees.length}:null];}));
    const q=s.position?engine.markets[s.position.symbol]?.quote:null;
    const equity=s.cash+(s.position?(q?q.bid*(1-s.position.slippage)*s.position.qty*(1-s.position.fee):s.position.cost):0);
    res.json({token,totalPnl:s.trades.reduce((n,t)=>n+t.pnl,0),totalTrades:s.trades.length,wins:s.trades.filter(t=>t.pnl>0).length,mode:'paper',state:{...s,trades:s.trades.slice(-100).reverse()},equity,markEstimated:!!s.position&&!q,lockUntil:Number.isFinite(until)?until:null,lockError:until===Infinity,health:engine.health,markets:engine.markets,models,job:app.locals.job||null,events:store.events(),settings:{threshold:c.threshold,riskFraction:c.riskFraction,initialBalance:s.initialBalance,pollSeconds:c.pollSeconds}});
  });
  app.post('/api/start',(req,res)=>{store.change(s=>{s.enabled=true;});store.event('Automatic paper entries enabled');res.json({ok:true});});
  app.post('/api/pause',(req,res)=>{store.change(s=>{s.enabled=false;});store.event('New entries paused; open-position exits remain active');res.json({ok:true});});
  app.post('/api/close',async(req,res)=>{await engine.closeNow();res.json({ok:true});});
  app.post('/api/train',(req,res)=>{startJob('train');res.json({ok:true});});
  app.post('/api/backtest',(req,res)=>{startJob('backtest');res.json({ok:true});});
  app.get('/api/backtest',(req,res)=>{try{res.json(JSON.parse(readFileSync(path.join(ROOT,'data','backtest.json'),'utf8')));}catch{res.status(404).json({error:'No backtest yet. Train/download data first, then run a backtest.'});}});
  app.use(express.static(path.join(ROOT,'public')));
  app.use((err,req,res,next)=>res.status(400).json({error:err.message}));
  return app;
}
if(process.argv[1]===new URL(import.meta.url).pathname || process.argv[1]?.replaceAll('\\','/').endsWith('/src/server.js')) {
  if(Number(process.versions.node.split('.')[0])!==24)throw Error('Install Node.js 24 LTS to run this app.');
  const store=new Store(path.join(ROOT,'data','paper.sqlite'),config.initialBalance),engine=new Engine(store,config);
  let worker=null,lastAttempt=0;
  const app=createApp(store,engine,config,type=>startJob(type));
  function startJob(type) {
    if(worker)throw Error('Another job is running; wait for it to finish.');
    if(type==='train')lastAttempt=Date.now();
    app.locals.job={type,running:true,message:'Starting…'};
    worker=new Worker(new URL('./jobs.js',import.meta.url),{workerData:{type}});
    worker.on('message',message=>{
      if(message.message)app.locals.job.message=message.message;
      if(message.error){app.locals.job.error=message.error;store.event(`Job failed: ${message.error}`);}
    });
    worker.on('error',e=>{app.locals.job.error=e.message;store.event(`Worker failed: ${e.message}`);});
    worker.on('exit',code=>{app.locals.job.running=false;if(code&&!app.locals.job.error)app.locals.job.error=`Worker exited (${code})`;worker=null;});
  }
  let timer;
  const server=app.listen(config.port,'127.0.0.1',()=>{
    console.log(`\nTrendGuard • PAPER ONLY\nOpen http://localhost:${config.port}\nNo exchange keys, Docker, or Python required.\nKeep this terminal running. Ctrl+C stops monitoring.\n`);
    const loop=async()=>{
      if(store.read().enabled&&!worker&&Date.now()-lastAttempt>3600_000) {
        const needsTraining=config.symbols.some(s=>{const m=store.model(s);return !m||Date.now()-m.trainedAt>config.retrainHours*3600_000;});
        if(needsTraining)startJob('train');
      }
      await engine.tick();
    };
    loop().catch(e=>console.error(e.message));
    timer=setInterval(()=>loop().catch(e=>console.error(e.message)),config.pollSeconds*1000);
  });
  server.on('error',e=>{console.error(e.code==='EADDRINUSE'?'Port is already in use. Stop the other app or change config.json port.':e.message);store.close();process.exitCode=1;});
  async function shutdown(){clearInterval(timer);server.close();if(worker)await worker.terminate();if(store.read().position)console.log('An open paper position remains. Missed price movement cannot be replayed exactly after restart.');process.exit(0);}
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
}
