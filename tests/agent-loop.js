'use strict';
const assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite'),schedule=require('../public/agent-loop-schedule.json'),loop=require('../lib/agent-loop'),db=new DatabaseSync(':memory:');
db.exec('CREATE TABLE participants(id INTEGER PRIMARY KEY,code TEXT,name TEXT,type TEXT,active INTEGER DEFAULT 1)');
for(let i=1;i<=7;i++)db.prepare("INSERT INTO participants(code,name,type) VALUES(?,?,'AGENT')").run('A0'+i,'Agent '+i);
loop.setup(db);const audit=()=>{},base=[1,1,0,0,0,0,0];
assert.equal(schedule.source,'Round Plan Testing(2).numbers');
assert.equal(schedule.features.length,4);
assert.equal(schedule.rounds.length,8);
assert.deepEqual(schedule.stepSets.wingWeiLuy[0].items.map(x=>x.featureIds.length),base);
assert.deepEqual(schedule.stepSets.wingWeiLuy[1].items.map(x=>x.featureIds.length),[0,1,1,0,0,0,0]);
for(let round=1;round<=8;round++){
 const expectedPrefix=round<=4?'WLX':'CO',values=loop.overview(db).roundValues;
 for(let step=1;step<=7;step++){
  const view=loop.overview(db);
  assert.equal(view.round,round);assert.equal(view.step,step);assert.deepEqual(view.roundValues,values);
  assert.deepEqual(view.items.map(x=>x.features.length),base.map((_,agent)=>base[(agent-step+8)%7]));
  assert.equal(view.items.flatMap(x=>x.features).length,2);
  assert.ok(view.items.flatMap(x=>x.features).every(feature=>feature.id.startsWith(expectedPrefix)));
  if(step<7)loop.nextStep(db,{round,step},'admin',audit);
 }
 loop.next(db,{round,step:7},'admin',audit);
}
assert.deepEqual({round:loop.overview(db).round,step:loop.overview(db).step},{round:1,step:1});
assert.equal(loop.overview(db).totalRounds,8);
assert.deepEqual(loop.overview(db).roundValues,{amount:'1 USD / 4,000 KHR',commission:'0.13 USD / 500 KHR',fee:'0.38 USD / 1,500 KHR'});
db.prepare('UPDATE agent_loop_state SET round=5,step=1 WHERE id=1').run();
assert.equal(loop.overview(db).items[0].features[0].id,'CO1');
assert.deepEqual(loop.overview(db).roundValues,{amount:'1 USD / 4,000 KHR',commission:'0.13 USD / 500 KHR',fee:'Free'});
db.prepare('UPDATE agent_loop_state SET round=1 WHERE id=1').run();
assert.throws(()=>loop.back(db,{round:1,step:1},'admin',audit),/first round/);
assert.throws(()=>loop.backStep(db,{round:1,step:1},'admin',audit),/first step/);
assert.throws(()=>loop.next(db,{round:1,step:1},'admin',audit),/Step 7/);
assert.equal(db.prepare('SELECT COUNT(*) n FROM agent_loop_results').get().n,0);
console.log('PASS: new Numbers schedule, 56 states, round-specific scenarios, rotation, values, boundaries');
db.close();
