import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { validateState } from './account.js';
import { validateBars } from './data.js';
import { hash } from './provenance.js';
import { validParameters } from './model.js';
export class Store {
  constructor(filename, initialBalance=1000) {
    const existed=filename!==':memory:'&&existsSync(filename);
    if(filename!==':memory:') mkdirSync(path.dirname(filename),{recursive:true});
    this.db=new DatabaseSync(filename);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.db.exec('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS models(symbol TEXT PRIMARY KEY, body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS candles(symbol TEXT, time INTEGER, body TEXT NOT NULL, PRIMARY KEY(symbol,time)); CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, at INTEGER NOT NULL, text TEXT NOT NULL);');
    this.db.exec('CREATE TABLE IF NOT EXISTS model_archive(id TEXT PRIMARY KEY,symbol TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS decisions(id TEXT PRIMARY KEY,at INTEGER NOT NULL,symbol TEXT NOT NULL,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS trade_archive(id TEXT PRIMARY KEY,closedAt INTEGER NOT NULL,body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS trade_archive_closed ON trade_archive(closedAt); CREATE TABLE IF NOT EXISTS candle_revisions(hash TEXT PRIMARY KEY,symbol TEXT NOT NULL,at INTEGER NOT NULL,body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS server_lease(id INTEGER PRIMARY KEY CHECK(id=1),pid INTEGER NOT NULL,owner TEXT NOT NULL); CREATE TABLE IF NOT EXISTS equity(at INTEGER PRIMARY KEY,body TEXT NOT NULL);');
    const row=this.db.prepare('SELECT body FROM state WHERE id=1').get();
    if(!row) {
      if(existed) {this.db.close();throw Error('Existing database is missing its account state. Refusing to reset balances or risk history.');}
      this.db.prepare('INSERT INTO state VALUES(1,?)').run(JSON.stringify({version:2,initialBalance,cash:initialBalance,enabled:false,position:null,trades:[],lastSignals:{},lastPoll:0}));
    }
    const state=this.read();
    for(const t of state.trades)this.db.prepare('INSERT OR IGNORE INTO trade_archive VALUES(?,?,?)').run(t.id,t.closedAt,JSON.stringify(t));
    for(const r of this.db.prepare('SELECT symbol,body FROM models').all()){const m=JSON.parse(r.body);this.db.prepare('INSERT OR IGNORE INTO model_archive VALUES(?,?,?)').run(m.id??hash(m),r.symbol,r.body);}
  }
  read() {
    const s=JSON.parse(this.db.prepare('SELECT body FROM state WHERE id=1').get().body);
    return validateState(s);
  }
  change(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const s=this.read(),before=s.trades.length,history=JSON.stringify(s.trades);
      const result=fn(s);validateState(s);
      if(s.trades.length<before||JSON.stringify(s.trades.slice(0,before))!==history)throw Error('Closed trade history is immutable');
      this.db.prepare('UPDATE state SET body=? WHERE id=1').run(JSON.stringify(s));
      for(const t of s.trades.slice(before))this.db.prepare('INSERT INTO trade_archive VALUES(?,?,?)').run(t.id,t.closedAt,JSON.stringify(t));
      this.db.exec('COMMIT');return result;
    } catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  model(symbol) {const r=this.db.prepare('SELECT body FROM models WHERE symbol=?').get(symbol);return r?JSON.parse(r.body):null;}
  putModel(symbol,m) {
    if(!validParameters(m)||!Number.isFinite(m.trainedAt)||!Number.isFinite(m.dataThrough)||m.dataThrough>m.trainedAt||typeof m.signature!=='string'||typeof m.validation?.passed!=='boolean')throw Error('Invalid model artifact');
    const {id:ignored,...payload}=m,id=hash(payload),body=JSON.stringify({...payload,id});
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.model(symbol);
      if(old&&(old.trainedAt>m.trainedAt||old.dataThrough>m.dataThrough))throw Error('Refusing older model publication');
      this.db.prepare('INSERT OR IGNORE INTO model_archive VALUES(?,?,?)').run(id,symbol,body);
      this.db.prepare('INSERT OR REPLACE INTO models VALUES (?,?)').run(symbol,body);this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  decision(record) {const id=randomUUID();this.db.prepare('INSERT INTO decisions VALUES(?,?,?,?)').run(id,record.at,record.symbol,JSON.stringify(record));return id;}
  mark(at,value) {this.db.prepare('INSERT OR REPLACE INTO equity VALUES(?,?)').run(at,JSON.stringify(value));}
  acquireLease() {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const old=this.db.prepare('SELECT * FROM server_lease WHERE id=1').get();
      if(old){let alive=true;try{process.kill(old.pid,0);}catch(e){if(e.code==='ESRCH')alive=false;}if(alive)throw Error('Another server owns this paper account');}
      this.owner=randomUUID();this.db.prepare('INSERT OR REPLACE INTO server_lease VALUES(1,?,?)').run(process.pid,this.owner);this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  saveCandles(symbol,rows) {
    validateBars(rows);
    this.db.exec('BEGIN IMMEDIATE');
    try{const q=this.db.prepare('INSERT OR REPLACE INTO candles VALUES (?,?,?)');this.db.prepare('INSERT OR IGNORE INTO candle_revisions VALUES(?,?,?,?)').run(hash({symbol,rows}),symbol,Date.now(),JSON.stringify(rows));for(const r of rows)q.run(symbol,r.time,JSON.stringify(r));this.db.exec('COMMIT');}catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  candles(symbol) {return this.db.prepare('SELECT body FROM candles WHERE symbol=? ORDER BY time').all(symbol).map(r=>JSON.parse(r.body));}
  event(text) {this.db.prepare('INSERT INTO events(at,text) VALUES(?,?)').run(Date.now(),String(text).slice(0,800));this.db.exec('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 200)');}
  events() {return this.db.prepare('SELECT at,text FROM events ORDER BY id DESC LIMIT 30').all();}
  close(){if(this.owner)this.db.prepare('DELETE FROM server_lease WHERE owner=?').run(this.owner);this.db.close();}
}
