'use strict';
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const loop=require('../lib/agent-loop'),db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE participants(id INTEGER PRIMARY KEY,code TEXT,name TEXT,type TEXT,active INTEGER DEFAULT 1)');for(let i=1;i<=7;i++)db.prepare("INSERT INTO participants(code,name,type) VALUES(?,?,'AGENT')").run('A0'+i,'Agent '+i);
db.exec('CREATE TABLE agent_loop_state(id INTEGER PRIMARY KEY,round INTEGER NOT NULL DEFAULT 0);INSERT INTO agent_loop_state VALUES(1,4);CREATE TABLE agent_loop_schedule_version(id INTEGER PRIMARY KEY,version TEXT NOT NULL)');
const version=require('node:crypto').createHash('sha256').update(JSON.stringify(require('../public/agent-loop-schedule.json'))).digest('hex');db.prepare('INSERT INTO agent_loop_schedule_version VALUES(1,?)').run(version);loop.setup(db);assert.equal(loop.overview(db).round,4);assert.equal(loop.overview(db).step,1);db.exec('UPDATE agent_loop_state SET round=1');
const audit=()=>{},initial=['F01','F02','F03','F04','F05','F06','F07'];
assert.equal(loop.overview(db).round,1);assert.equal(loop.overview(db).source,'Round Plan Testing(1).numbers');assert.equal(loop.overview(db).totalRounds,7);
assert.equal(loop.overview(db).items[0].feature.customer,'Customer 1');
assert.equal(loop.overview(db).items[1].feature.customer,'Customer 2');
assert.equal(loop.overview(db).step,1);
assert.throws(()=>loop.back(db,{round:1,step:1},'admin',audit),/first round/);
assert.throws(()=>loop.next(db,{round:1,step:1},'admin',audit),/Step 7/);
assert.throws(()=>loop.backStep(db,{round:1,step:1},'admin',audit),/first step/);
for(let round=1;round<=7;round++){
 const values=loop.overview(db).roundValues;
 for(let step=1;step<=7;step++){
  const view=loop.overview(db);assert.equal(view.round,round);assert.equal(view.step,step);assert.deepEqual(view.roundValues,values);
  assert.deepEqual(view.items.map(i=>i.feature.id),initial.map((_,t)=>initial[(t-step+8)%7]));
  if(step<7){loop.nextStep(db,{round,step},'admin',audit);assert.throws(()=>loop.nextStep(db,{round,step},'admin',audit),/changed/)}
 }
 assert.throws(()=>loop.nextStep(db,{round,step:7},'admin',audit),/last step/);
 loop.next(db,{round,step:7},'admin',audit);
}
assert.equal(loop.overview(db).round,1);assert.equal(loop.overview(db).step,1);
loop.nextStep(db,{round:1,step:1},'admin',audit);loop.backStep(db,{round:1,step:2},'admin',audit);assert.equal(loop.overview(db).step,1);
db.prepare('UPDATE agent_loop_state SET round=4,step=6 WHERE id=1').run();loop.setup(db);assert.equal(loop.overview(db).step,6);
loop.back(db,{round:4,step:6},'admin',audit);assert.equal(loop.overview(db).round,3);assert.equal(loop.overview(db).step,1);
assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_loop_results').get().n,0);
console.log('PASS: 49 round/step states, fixed values, rightward rotation, boundaries, wrap, stale requests, persistent state');db.close();
