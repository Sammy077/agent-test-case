'use strict';
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const loop=require('../lib/agent-loop'),db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE participants(id INTEGER PRIMARY KEY,code TEXT,name TEXT,type TEXT,active INTEGER DEFAULT 1)');for(let i=1;i<=7;i++)db.prepare("INSERT INTO participants(code,name,type) VALUES(?,?,'AGENT')").run('A0'+i,'Agent '+i);
loop.setup(db);const audit=()=>{};
assert.equal(loop.overview(db).round,1);
assert.deepEqual(loop.overview(db).items.map(i=>i.feature.id),['F01','F02','F03','F04','F05','F06','F07']);
assert.throws(()=>loop.next(db,{round:0},'admin',audit),/changed/);
for(let round=1;round<=11;round++){const view=loop.overview(db);assert.equal(view.items.length,7);assert.ok(view.items.every(i=>!('result' in i)));if(round<11)loop.next(db,{round},'admin',audit)}
assert.equal(loop.overview(db).round,11);assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_loop_results').get().n,0);
assert.equal(loop.next(db,{round:11},'admin',audit).round,1);
assert.deepEqual(loop.overview(db).items.map(i=>i.feature.id),['F01','F02','F03','F04','F05','F06','F07']);
assert.throws(()=>loop.next(db,{round:11},'admin',audit),/changed/);
assert.throws(()=>loop.back(db,{round:1},'admin',audit),/first round/);
assert.equal(loop.overview(db).round,1);
for(let round=1;round<11;round++)loop.next(db,{round},'admin',audit);
assert.equal(loop.back(db,{round:11},'admin',audit).round,10);
assert.throws(()=>loop.back(db,{round:11},'admin',audit),/changed/);
console.log('PASS: workbook mapping, immediate Round 1, unrestricted round navigation, no completion tracking, stale requests, final round');db.close();
