'use strict';
const crypto=require('node:crypto');
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status})};
function setup(db){db.exec(`
 CREATE TABLE IF NOT EXISTS agent_scenarios(id INTEGER PRIMARY KEY,name TEXT NOT NULL,amount TEXT NOT NULL,currency TEXT NOT NULL,subtasks_json TEXT NOT NULL,participant_id INTEGER,round_number INTEGER,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS agent_rounds(number INTEGER PRIMARY KEY,state TEXT NOT NULL DEFAULT 'ACTIVE',created_at TEXT DEFAULT CURRENT_TIMESTAMP,closed_at TEXT);
 CREATE TABLE IF NOT EXISTS agent_scenario_cases(scenario_id INTEGER NOT NULL,case_id INTEGER NOT NULL UNIQUE,position INTEGER NOT NULL,PRIMARY KEY(scenario_id,position),FOREIGN KEY(scenario_id) REFERENCES agent_scenarios(id),FOREIGN KEY(case_id) REFERENCES test_cases(id));
 CREATE TABLE IF NOT EXISTS agent_round_state(id INTEGER PRIMARY KEY CHECK(id=1),last_agent_id INTEGER,preview_json TEXT);
 INSERT OR IGNORE INTO agent_round_state(id) VALUES(1);
 `)}
function transaction(db,fn){db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result}catch(error){db.exec('ROLLBACK');throw error}}
function create(db,input,actor,audit){
 const name=typeof input.name==='string'?input.name.trim():'',amount=String(input.amount??'').trim(),currency=input.currency;
 if(!name||name.length>200)fail('Scenario name required; maximum 200 characters');
 if(!/^\d+(\.\d{1,2})?$/.test(amount)||!Number.isFinite(Number(amount)))fail('Amount must be non-negative, with up to two decimal places');
 if(!['KHR','USD'].includes(currency))fail('Currency must be KHR or USD');
 if(!Array.isArray(input.subtasks)||!input.subtasks.length||input.subtasks.length>100)fail('Add between 1 and 100 subtasks');
 const subtasks=input.subtasks.map(step=>{const name=typeof step?.name==='string'?step.name.trim():'',expectedResult=typeof step?.expectedResult==='string'?step.expectedResult.trim():'';if(!name||name.length>500||!expectedResult||expectedResult.length>2000)fail('Each subtask needs name and expected result (maximum 500 / 2000 characters)');return {name,expectedResult}});
 return transaction(db,()=>{const result=db.prepare('INSERT INTO agent_scenarios(name,amount,currency,subtasks_json) VALUES(?,?,?,?)').run(name,amount,currency,JSON.stringify(subtasks));const id=Number(result.lastInsertRowid);audit(actor,'CREATE_AGENT_SCENARIO','AGENT_SCENARIO',id,name);return {id}});
}
function agents(db){return db.prepare("SELECT id,code,name,active FROM participants WHERE type='AGENT' ORDER BY code COLLATE NOCASE,id").all()}
function queue(db){return db.prepare('SELECT * FROM agent_scenarios WHERE round_number IS NULL ORDER BY id').all()}
function candidate(db){
 const active=agents(db).filter(person=>person.active),state=db.prepare('SELECT * FROM agent_round_state WHERE id=1').get(),round=db.prepare('SELECT * FROM agent_rounds ORDER BY number DESC LIMIT 1').get();
 const ordered=agents(db),last=ordered.findIndex(person=>person.id===state.last_agent_id),successor=last<0?active[0]:[...ordered.slice(last+1),...ordered.slice(0,last+1)].find(person=>person.active),start=Math.max(0,active.findIndex(person=>person.id===successor?.id));
 const items=queue(db).slice(0,Math.min(7,active.length)).map((scenario,index)=>{const person=active[(start+index)%active.length];return {scenarioId:scenario.id,name:scenario.name,amount:scenario.amount,currency:scenario.currency,subtasks:JSON.parse(scenario.subtasks_json).length,participantId:person.id,code:person.code,agentName:person.name}});
 const number=(round?.number||0)+1,token=crypto.createHash('sha256').update(JSON.stringify({number,items,active:active.map(p=>p.id),last:state.last_agent_id})).digest('hex');return {number,items,token,nextAgent:successor||null};
}
function next(db,actor,audit){return transaction(db,()=>{
 const round=db.prepare("SELECT * FROM agent_rounds WHERE state='ACTIVE' ORDER BY number DESC LIMIT 1").get();
 if(round){db.prepare("UPDATE agent_rounds SET state='DONE',closed_at=CURRENT_TIMESTAMP WHERE number=?").run(round.number);audit(actor,'CLOSE_AGENT_ROUND','AGENT_ROUND',round.number,'Admin advanced round; test results preserved')}
 const preview=candidate(db);db.prepare('UPDATE agent_round_state SET preview_json=? WHERE id=1').run(preview.items.length?JSON.stringify(preview):null);return {preview:preview.items.length?preview:null};
})}
function assign(db,input,actor,audit,addCaseUser){return transaction(db,()=>{
 const stored=db.prepare('SELECT preview_json FROM agent_round_state WHERE id=1').get().preview_json,preview=stored&&JSON.parse(stored),current=candidate(db);
 if(!preview||typeof input.token!=='string'||input.token!==preview.token||current.token!==preview.token)fail('Preview changed or already applied. Click Next Round to refresh.',409);
 if(!preview.items.length)fail('No scenarios available',409);
 db.prepare('INSERT INTO agent_rounds(number) VALUES(?)').run(preview.number);
 for(const item of preview.items){
  const scenario=db.prepare('SELECT * FROM agent_scenarios WHERE id=?').get(item.scenarioId),steps=JSON.parse(scenario.subtasks_json);
  db.prepare('UPDATE agent_scenarios SET participant_id=?,round_number=? WHERE id=?').run(item.participantId,preview.number,scenario.id);
  steps.forEach((step,index)=>{
   const code='MA-'+scenario.id+'-'+(index+1),result=db.prepare('INSERT INTO test_cases(case_code,title,process,steps,expected_result,channel,main_feature,sub_feature) VALUES(?,?,?,?,?,?,?,?)').run(code,scenario.name+' · '+step.name,scenario.name,step.name,step.expectedResult,'My Agent',scenario.name,step.name),caseId=Number(result.lastInsertRowid);
   db.prepare('INSERT INTO agent_scenario_cases(scenario_id,case_id,position) VALUES(?,?,?)').run(scenario.id,caseId,index+1);
   const assignment=addCaseUser(db,caseId,item.participantId,actor);
   db.prepare('UPDATE assignments SET sequence_no=?,source_details_json=? WHERE id=?').run(caseId,JSON.stringify({amountCashIn:scenario.amount,senderCurrency:scenario.currency,round:preview.number}),assignment.id);
  });
 }
 db.prepare('UPDATE agent_round_state SET last_agent_id=?,preview_json=NULL WHERE id=1').run(preview.items.at(-1).participantId);
 audit(actor,'ASSIGN_AGENT_ROUND','AGENT_ROUND',preview.number,JSON.stringify(preview.items));return {number:preview.number};
})}
function overview(db){
 const scenarios=db.prepare('SELECT * FROM agent_scenarios ORDER BY id').all().map(s=>({...s,subtasks:JSON.parse(s.subtasks_json)}));
 const steps=db.prepare('SELECT sc.scenario_id,sc.position,a.status,a.reported_result,a.actual_result,a.submission_note,a.evidence_ref FROM agent_scenario_cases sc JOIN agent_scenarios s ON s.id=sc.scenario_id LEFT JOIN assignments a ON a.test_case_id=sc.case_id AND a.participant_id=s.participant_id ORDER BY sc.position').all();
 for(const s of scenarios)s.results=steps.filter(step=>step.scenario_id===s.id);
 const round=db.prepare('SELECT * FROM agent_rounds ORDER BY number DESC LIMIT 1').get()||null,stored=db.prepare('SELECT preview_json FROM agent_round_state WHERE id=1').get().preview_json;
 return {nextAgent:candidate(db).nextAgent,agents:agents(db),scenarios,queue:scenarios.filter(s=>s.round_number==null),round,rounds:db.prepare('SELECT * FROM agent_rounds ORDER BY number DESC').all(),preview:stored?JSON.parse(stored):null};
}
module.exports={setup,create,next,assign,overview};
