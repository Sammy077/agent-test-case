'use strict';
const schedule=require('../public/agent-loop-schedule.json');
const scheduleVersion=require('node:crypto').createHash('sha256').update(JSON.stringify(schedule)).digest('hex');
const fail=(message)=>{throw Object.assign(Error(message),{status:409})};
function setup(db){db.exec(`CREATE TABLE IF NOT EXISTS agent_loop_state(id INTEGER PRIMARY KEY CHECK(id=1),round INTEGER NOT NULL DEFAULT 0);INSERT OR IGNORE INTO agent_loop_state(id,round) VALUES(1,1);UPDATE agent_loop_state SET round=1 WHERE round=0;CREATE TABLE IF NOT EXISTS agent_loop_results(round INTEGER NOT NULL,tester INTEGER NOT NULL,participant_id INTEGER NOT NULL,completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_by TEXT NOT NULL,PRIMARY KEY(round,tester));CREATE TABLE IF NOT EXISTS agent_loop_schedule_version(id INTEGER PRIMARY KEY CHECK(id=1),version TEXT NOT NULL);`);if(!db.prepare('PRAGMA table_info(agent_loop_state)').all().some(c=>c.name==='step'))db.exec('ALTER TABLE agent_loop_state ADD COLUMN step INTEGER NOT NULL DEFAULT 1');const previous=db.prepare('SELECT version FROM agent_loop_schedule_version WHERE id=1').get();if(previous?.version!==scheduleVersion){db.prepare('UPDATE agent_loop_state SET round=1,step=1 WHERE id=1').run();db.prepare('INSERT INTO agent_loop_schedule_version(id,version) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET version=excluded.version').run(scheduleVersion)}}
function people(db){return Array.from({length:7},(_,i)=>db.prepare("SELECT id,code,name,active FROM participants WHERE code=? AND type='AGENT'").get('A0'+(i+1))||null)}
function overview(db){const state=db.prepare('SELECT round,step FROM agent_loop_state WHERE id=1').get(),round=Math.max(1,state.round),step=state.step,participants=people(db),plan=schedule.rounds[round-1],steps=schedule.stepSets[plan.stepSet];const items=Array.from({length:7},(_,i)=>({tester:i+1,participant:participants[i],features:steps[step-1].items[i].featureIds.map(id=>schedule.features.find(f=>f.id===id))}));return {source:schedule.source,round,step,totalSteps:steps.length,totalRounds:schedule.rounds.length,items,schedule:{source:schedule.source,features:schedule.features,steps},roundValues:plan.values}}
function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const r=fn();db.exec('COMMIT');return r}catch(e){db.exec('ROLLBACK');throw e}}
function navigate(db,input,actor,audit,direction){return transaction(db,()=>{
 const view=overview(db);if(input.round!==view.round||input.step!==view.step)fail('Round or step changed. Refresh before navigating.');
 let {round,step}=view;
 if(direction==='next'){if(step!==view.totalSteps)fail('Reach Step 7 before changing round.');round=round===view.totalRounds?1:round+1;step=1}
 if(direction==='back'){if(round===1)fail('Already on first round.');round--;step=1}
 if(direction==='next-step'){if(step===view.totalSteps)fail('Already on last step.');step++}
 if(direction==='back-step'){if(step===1)fail('Already on first step.');step--}
 db.prepare('UPDATE agent_loop_state SET round=?,step=? WHERE id=1').run(round,step);
 audit(actor,'NAVIGATE_LOOP','AGENT_LOOP',round,JSON.stringify({direction,step}));return {round,step};
})}
const next=(...args)=>navigate(...args,'next'),back=(...args)=>navigate(...args,'back'),nextStep=(...args)=>navigate(...args,'next-step'),backStep=(...args)=>navigate(...args,'back-step');
module.exports={setup,overview,next,back,nextStep,backStep};
