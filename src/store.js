import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
export class Store {
  constructor(filename, initialBalance=1000) {
    const existed=filename!==':memory:'&&existsSync(filename);
    if(filename!==':memory:') mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS models(symbol TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS candles(symbol TEXT, time INTEGER, body TEXT NOT NULL, PRIMARY KEY(symbol,time)); CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, text TEXT NOT NULL);');
    const row=this.db.prepare('SELECT body FROM state WHERE id=1').get();
    if(!row) {
      if(existed) {this.db.close();throw Error('Existing database is missing its account state. Refusing to reset balances or risk history.');}
      this.db.prepare('INSERT INTO state VALUES(1,?)').run(JSON.stringify({version:2,initialBalance,cash:initialBalance,enabled:false,position:null,trades:[],lastSignals:{},lastPoll:0}));
    }
    this.read();
  }
  read() {
    const s=JSON.parse(this.db.prepare('SELECT body FROM state WHERE id=1').get().body);
    if(s.version!==2 || !Number.isFinite(s.cash)||s.cash<0||!Array.isArray(s.trades)||typeof s.enabled!=='boolean') throw Error('Account state is invalid; refusing trading');
    if(s.position && ![s.position.entry,s.position.qty,s.position.openedAt,s.position.cost,s.position.stop,s.position.target].every(Number.isFinite)) throw Error('Position state is invalid');
    return s;
  }
  change(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {const s=this.read();const result=fn(s);this.db.prepare('UPDATE state SET body=? WHERE id=1').run(JSON.stringify(s));this.db.exec('COMMIT');return result;} catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  model(symbol) {const r=this.db.prepare('SELECT body FROM models WHERE symbol=?').get(symbol);return r?JSON.parse(r.body):null;}
  putModel(symbol,m) {this.db.prepare('INSERT OR REPLACE INTO models VALUES (?,?)').run(symbol,JSON.stringify(m));}
  saveCandles(symbol,rows) {
    this.db.exec('BEGIN IMMEDIATE');
    try{const q=this.db.prepare('INSERT OR REPLACE INTO candles VALUES (?,?,?)');for(const r of rows)q.run(symbol,r.time,JSON.stringify(r));this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  candles(symbol) {return this.db.prepare('SELECT body FROM candles WHERE symbol=? ORDER BY time').all(symbol).map(r=>JSON.parse(r.body));}
  event(text) {this.db.prepare('INSERT INTO events(at,text) VALUES(?,?)').run(Date.now(),String(text).slice(0,800));this.db.exec('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 200)');}
  events() {return this.db.prepare('SELECT at,text FROM events ORDER BY id DESC LIMIT 30').all();}
  close(){this.db.close();}
}
