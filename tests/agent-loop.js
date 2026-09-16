'use strict';
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const loop=require('../lib/agent-loop'),db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE participants(id INTEGER PRIMARY KEY,code TEXT,name TEXT,type TEXT,active INTEGER DEFAULT 1)');for(let i=1;i<=7;i++)db.prepare("INSERT INTO participants(code,name,type) VALUES(?,?,'AGENT')").run('A0'+i,'Agent '+i);
loop.setup(db);const audit=()=>{},initial=['F01','F02','F03','F04','F05','F06','F07'];
assert.equal(loop.overview(db).round,1);assert.equal(loop.overview(db).source,'Round Plan Testing(1).numbers');assert.equal(loop.overview(db).totalRounds,7);
assert.equal(loop.overview(db).items[0].feature.customer,'Customer 1');
assert.equal(loop.overview(db).items[1].feature.customer,'Customer 2');
assert.throws(()=>loop.back(db,{round:1},'admin',audit),/first round/);
for(let round=1;round<=7;round++){const view=loop.overview(db);assert.deepEqual(view.roundValues,[{amount:'$5',commission:'0.15 USD',fee:'Free'},{amount:'5,000 KHR',commission:'600 KHR',fee:'Free'},{amount:'$25',commission:'0.3 USD',fee:'Free'},{amount:'100,001 KHR',commission:'1,200 KHR',fee:'Free'},{amount:'$5',commission:'0.15 USD',fee:'Free'},{amount:'5,000 KHR',commission:'600 KHR',fee:'Free'},{amount:'$25',commission:'0.3 USD',fee:'Free'}][round-1]);assert.deepEqual(view.items.map(i=>i.feature?.id||null),initial.map((_,t)=>initial[(t-round+8)%7]));assert.equal(view.items.filter(i=>i.feature).length,7);assert.ok(view.items.filter(i=>i.feature).every(i=>i.feature.scenario&&i.feature.instructions));if(round<7)loop.next(db,{round},'admin',audit)}
assert.equal(loop.next(db,{round:7},'admin',audit).round,1);assert.throws(()=>loop.next(db,{round:7},'admin',audit),/changed/);assert.equal(loop.next(db,{round:1},'admin',audit).round,2);assert.equal(loop.back(db,{round:2},'admin',audit).round,1);
assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_loop_results').get().n,0);
console.log('PASS: Numbers schedule, rightward rotation, 49 assignments, seven populated slots, forward/back navigation, R1 guard, no tracking');db.close();
