'use strict';

const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {openDatabase}=require('./lib/database');
const ExcelJS=require('exceljs');
const QRCode=require('./vendor/qrcode');
const {parseProductionWorkbook}=require('./lib/production-workbook');
const {backupDatabase,replaceProductionData}=require('./lib/production-replacement');
const views=require('./lib/htmx-views');
const myAgent=require('./lib/my-agent');
const agentLoop=require('./lib/agent-loop');
const {caseOrder,sortSelection,observerCaseFilter}=require('./lib/case-query');
const {migrateMultipleCaseUsers,addCaseUser:rawAddCaseUser,hydrateCaseUsers,caseJoins}=require('./lib/case-assignments');

const DEMO_MODE=process.env.DEMO_MODE==='true';
const SERVERLESS=process.env.SERVERLESS==='true';
const PORT=Number(process.env.PORT||8080);
const HOST=process.env.HOST||'0.0.0.0';
const BASE_URL=process.env.BASE_URL||(process.env.VERCEL_URL?'https://'+process.env.VERCEL_URL:('http://localhost:'+PORT));
const SECRET=process.env.APP_SECRET||'change-this-secret-before-production';
const COOKIE_SECURE=process.env.COOKIE_SECURE==='true'||(DEMO_MODE&&process.env.VERCEL==='1');
const ROOT=__dirname;
const PUBLIC=path.join(ROOT,'public');
const MY_AGENT_CLIENT_VERSION=crypto.createHash('sha256').update(fs.readFileSync(path.join(PUBLIC,'my-agent.js'))).digest('hex').slice(0,12);
const XLSX_LIMIT=10*1024*1024;
const XLSX_ROW_LIMIT=10000;
const FRONTEND_MODE=process.env.FRONTEND_MODE||'htmx';

const DB_PATH=DEMO_MODE?':memory:':process.env.DB_FILE||path.join(ROOT,'data','test-center.db');
const {db,shared:SHARED_DATABASE}=openDatabase({localPath:DB_PATH});
// Hosted Turso manages locks/journaling and rejects these local SQLite PRAGMAs.
if(!SHARED_DATABASE){db.exec('PRAGMA busy_timeout=30000');db.exec('PRAGMA journal_mode=WAL')}
db.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,username TEXT UNIQUE NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL,display_name TEXT NOT NULL,active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS participants(id INTEGER PRIMARY KEY,code TEXT UNIQUE NOT NULL,name TEXT NOT NULL,type TEXT NOT NULL CHECK(type IN ('AGENT','BRANCH')),observer TEXT,active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS test_cases(id INTEGER PRIMARY KEY,case_code TEXT UNIQUE NOT NULL,title TEXT NOT NULL,process TEXT NOT NULL,priority INTEGER NOT NULL DEFAULT 3,steps TEXT,expected_result TEXT,status TEXT NOT NULL DEFAULT 'NOT_STARTED',qa_status TEXT NOT NULL DEFAULT 'PENDING',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS assignments(id INTEGER PRIMARY KEY,test_case_id INTEGER NOT NULL,participant_id INTEGER NOT NULL,sequence_no INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'NOT_STARTED',actual_result TEXT,evidence_ref TEXT,updated_by TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(test_case_id,participant_id),FOREIGN KEY(test_case_id) REFERENCES test_cases(id),FOREIGN KEY(participant_id) REFERENCES participants(id));
CREATE TABLE IF NOT EXISTS defects(id INTEGER PRIMARY KEY,assignment_id INTEGER UNIQUE NOT NULL,severity TEXT NOT NULL DEFAULT 'HIGH',status TEXT NOT NULL DEFAULT 'REPORTED',owner TEXT,root_cause TEXT,resolution TEXT,build_version TEXT,updated_by TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(assignment_id) REFERENCES assignments(id));
CREATE TABLE IF NOT EXISTS audit_log(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,entity_type TEXT NOT NULL,entity_id INTEGER,details TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
`);

myAgent.setup(db);
agentLoop.setup(db);
function addCaseUser(db,caseId,participantId,actor){
 const scenario=db.prepare('SELECT s.participant_id FROM agent_scenario_cases sc JOIN agent_scenarios s ON s.id=sc.scenario_id WHERE sc.case_id=?').get(caseId);
 if(scenario&&scenario.participant_id!==participantId)throw Object.assign(Error('My Agent scenario subtasks must stay with round-assigned agent'),{status:409});
 return rawAddCaseUser(db,caseId,participantId,actor);
}

function addColumn(table,name,definition){
  const columns=db.prepare('PRAGMA table_info('+table+')').all().map(row=>row.name);
  if(!columns.includes(name)){
    try{db.exec('ALTER TABLE '+table+' ADD COLUMN '+name+' '+definition)}catch(error){
      if(!db.prepare('PRAGMA table_info('+table+')').all().some(row=>row.name===name)||!String(error.message).toLowerCase().includes('duplicate column'))throw error;
    }
  }
}
addColumn('test_cases','channel',"TEXT NOT NULL DEFAULT 'Uncategorized'");
addColumn('test_cases','case_type',"TEXT NOT NULL DEFAULT ''");
addColumn('test_cases','source_sheet',"TEXT NOT NULL DEFAULT ''");
addColumn('test_cases','subcategory',"TEXT NOT NULL DEFAULT ''");
addColumn('test_cases','source_case_id',"TEXT NOT NULL DEFAULT ''");
addColumn('test_cases','durable_key',"TEXT NOT NULL DEFAULT ''");
addColumn('test_cases','category','TEXT');
addColumn('test_cases','type','TEXT');
addColumn('test_cases','main_feature',"TEXT NOT NULL DEFAULT ''");
addColumn('test_cases','sub_feature',"TEXT NOT NULL DEFAULT ''");
addColumn('assignments','tester',"TEXT NOT NULL DEFAULT ''");
addColumn('assignments','executed_at',"TEXT");
addColumn('assignments','qa_remark',"TEXT NOT NULL DEFAULT ''");
addColumn('assignments','jira_link',"TEXT NOT NULL DEFAULT ''");
addColumn('assignments','finance_status',"TEXT NOT NULL DEFAULT ''");
addColumn('assignments','finance_remark',"TEXT NOT NULL DEFAULT ''");
addColumn('assignments','source_details_json',"TEXT NOT NULL DEFAULT '{}'");
addColumn('assignments','reported_result',"TEXT NOT NULL DEFAULT ''");
addColumn('assignments','submission_note',"TEXT NOT NULL DEFAULT ''");
addColumn('assignments','production_status',"TEXT NOT NULL DEFAULT 'PENDING'");
addColumn('assignments','workflow_state',"TEXT NOT NULL DEFAULT 'ASSIGNED'");
addColumn('assignments','source_case_id',"TEXT NOT NULL DEFAULT ''");
// Backfill source feature metadata only when missing; never derive from process/classification.
for(const row of db.prepare("SELECT tc.id,tc.main_feature,tc.sub_feature,a.source_details_json FROM test_cases tc JOIN assignments a ON a.test_case_id=tc.id WHERE tc.main_feature='' OR tc.sub_feature=''").all()){
 let details;try{details=JSON.parse(row.source_details_json)||{}}catch{continue}
 const main=cleanText(details['main feature']??details['main service feature']),sub=cleanText(details['sub feature']);
 if(main||sub)db.prepare("UPDATE test_cases SET main_feature=CASE WHEN main_feature='' THEN ? ELSE main_feature END,sub_feature=CASE WHEN sub_feature='' THEN ? ELSE sub_feature END WHERE id=?").run(main,sub,row.id);
}
addColumn('users','participant_id','INTEGER');

function migrateAssignmentsForUnassignedCases(){
  const participant=db.prepare('PRAGMA table_info(assignments)').all().find(column=>column.name==='participant_id');
  if(!participant||participant.notnull===0)return;
  db.exec('PRAGMA foreign_keys=OFF');
  try{
    db.exec('BEGIN IMMEDIATE');
    if(db.prepare('PRAGMA table_info(assignments)').all().find(column=>column.name==='participant_id')?.notnull===0){db.exec('COMMIT');return}
    db.exec(`CREATE TABLE assignments_next(
      id INTEGER PRIMARY KEY,
      test_case_id INTEGER NOT NULL,
      participant_id INTEGER,
      sequence_no INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'NOT_STARTED',
      workflow_state TEXT NOT NULL DEFAULT 'ASSIGNED',
      production_status TEXT NOT NULL DEFAULT 'PENDING',
      source_case_id TEXT NOT NULL DEFAULT '',
      actual_result TEXT,
      evidence_ref TEXT,
      updated_by TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      tester TEXT NOT NULL DEFAULT '',
      executed_at TEXT,
      qa_remark TEXT NOT NULL DEFAULT '',
      jira_link TEXT NOT NULL DEFAULT '',
      finance_status TEXT NOT NULL DEFAULT '',
      finance_remark TEXT NOT NULL DEFAULT '',
      source_details_json TEXT NOT NULL DEFAULT '{}',
      reported_result TEXT NOT NULL DEFAULT '',
      submission_note TEXT NOT NULL DEFAULT '',
      UNIQUE(test_case_id,participant_id),
      FOREIGN KEY(test_case_id) REFERENCES test_cases(id),
      FOREIGN KEY(participant_id) REFERENCES participants(id)
    )`);
    db.exec(`INSERT INTO assignments_next(
      id,test_case_id,participant_id,sequence_no,status,workflow_state,production_status,source_case_id,
      actual_result,evidence_ref,updated_by,updated_at,tester,executed_at,qa_remark,jira_link,
      finance_status,finance_remark,source_details_json,reported_result,submission_note
    ) SELECT id,test_case_id,participant_id,sequence_no,status,
      CASE WHEN status IN ('NOT_STARTED','') THEN 'ASSIGNED' WHEN status='IN_PROGRESS' THEN 'IN_PROGRESS'
           WHEN status='PENDING_QA' THEN 'PENDING_QA' WHEN status='RETESTING' THEN 'RETESTING' ELSE 'QA_VERIFIED' END,
      CASE WHEN status='COMPLETED' THEN 'PASSED' WHEN status='FAILED' THEN 'FAILED' WHEN status='BLOCKED' THEN 'DEPENDENCY'
           WHEN status='IN_PROGRESS' THEN 'IN_PROGRESS' ELSE 'PENDING' END,
      '',actual_result,evidence_ref,updated_by,updated_at,tester,executed_at,qa_remark,jira_link,
      finance_status,finance_remark,source_details_json,reported_result,submission_note FROM assignments`);
    db.exec('DROP TABLE assignments');
    db.exec('ALTER TABLE assignments_next RENAME TO assignments');
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}finally{db.exec('PRAGMA foreign_keys=ON')}
}
migrateAssignmentsForUnassignedCases();
migrateMultipleCaseUsers(db);
db.exec('CREATE INDEX IF NOT EXISTS idx_test_cases_channel ON test_cases(channel COLLATE NOCASE)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_test_cases_durable_key ON test_cases(durable_key) WHERE durable_key<>\'\'');
db.exec('CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status)');
db.exec('CREATE INDEX IF NOT EXISTS idx_assignments_workflow_state ON assignments(workflow_state)');
db.exec('DROP INDEX IF EXISTS idx_users_participant_login');
const duplicateParticipantLogin=db.prepare("SELECT participant_id FROM users WHERE participant_id IS NOT NULL AND role IN ('AGENT','BRANCH') GROUP BY participant_id HAVING COUNT(*)>1 LIMIT 1").get();
if(duplicateParticipantLogin)throw new Error('Cannot enforce one Agent or Branch login for participant_id '+duplicateParticipantLogin.participant_id);
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_participant_role_login ON users(participant_id) WHERE participant_id IS NOT NULL AND role IN ('AGENT','BRANCH')");
db.exec(`CREATE TABLE IF NOT EXISTS observer_participants(observer_user_id INTEGER NOT NULL REFERENCES users(id),participant_id INTEGER PRIMARY KEY REFERENCES participants(id),linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
try{
  db.exec('BEGIN IMMEDIATE');
  const duplicate=db.prepare("SELECT participant_id FROM users WHERE role='OBSERVER' AND participant_id IS NOT NULL GROUP BY participant_id HAVING COUNT(*)>1 LIMIT 1").get();
  if(duplicate)throw Error('Cannot enforce one Observer login for participant_id '+duplicate.participant_id);
  const legacy=db.prepare("SELECT id,participant_id FROM users WHERE role='OBSERVER' AND participant_id IS NOT NULL").all();
  for(const row of legacy){
    const owner=db.prepare('SELECT observer_user_id FROM observer_participants WHERE participant_id=?').get(row.participant_id);
    if(owner&&owner.observer_user_id!==row.id)throw Error('Cannot enforce one Observer login for participant_id '+row.participant_id);
    db.prepare('INSERT OR IGNORE INTO observer_participants(observer_user_id,participant_id) VALUES(?,?)').run(row.id,row.participant_id);
  }
  db.prepare("UPDATE users SET participant_id=NULL WHERE role='OBSERVER'").run();
  db.exec('DROP INDEX IF EXISTS idx_users_observer_login; COMMIT');
}catch(error){db.exec('ROLLBACK');throw error}

const hash=p=>crypto.pbkdf2Sync(p,'ptc-v1',120000,32,'sha256').toString('hex');
if(!db.prepare("SELECT id FROM users WHERE role='ADMIN'").get())db.prepare('INSERT OR IGNORE INTO users(username,password_hash,role,display_name) VALUES(?,?,?,?)').run('admin',hash('Admin@123'),'ADMIN','System Admin');
function sessionKey(sid,session){
 if(!DEMO_MODE)return sid;
 const payload=Buffer.from(JSON.stringify(session)).toString('base64url');return payload+'.'+crypto.createHmac('sha256',SECRET).update(payload).digest('base64url');
}
function demoSession(token){
 if(!DEMO_MODE||!token)return null;
 try{const [payload,signature,extra]=token.split('.');if(extra||!payload||!signature)return null;const expected=crypto.createHmac('sha256',SECRET).update(payload).digest();const actual=Buffer.from(signature,'base64url');if(actual.length!==expected.length||!crypto.timingSafeEqual(actual,expected))return null;const s=JSON.parse(Buffer.from(payload,'base64url'));if(s.exp<Date.now())return null;if(String(s.id).startsWith('participant:')){const p=db.prepare('SELECT code,type FROM participants WHERE id=? AND active=1').get(s.participantId);return p&&s.username==='qr:'+p.code&&s.role===p.type?s:null}const user=db.prepare('SELECT username,role FROM users WHERE id=? AND active=1').get(s.id);return user&&user.username===s.username&&user.role===s.role?s:null}catch{return null}
}
const sessions=new Map(),clients=new Set();
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data))}
function readBody(req,limit=5e6){if(req.body!==undefined){const raw=Buffer.isBuffer(req.body)?req.body:Buffer.from(typeof req.body==='string'?req.body:JSON.stringify(req.body));return raw.length>limit?Promise.reject(Object.assign(Error('Payload too large'),{status:413})):Promise.resolve(raw)}return new Promise((resolve,reject)=>{const chunks=[];let size=0,settled=false;req.on('data',chunk=>{if(settled)return;size+=chunk.length;if(size>limit){settled=true;reject(Object.assign(Error('Payload too large'),{status:413}));req.destroy();return}chunks.push(chunk)});req.on('end',()=>{if(!settled)resolve(Buffer.concat(chunks))});req.on('error',error=>{if(!settled)reject(error)})})}
async function bodyJson(req,limit=5e6){const raw=await readBody(req,limit);return JSON.parse(raw.toString('utf8')||'{}')}
function parseCookies(req){return Object.fromEntries((req.headers.cookie||'').split(';').filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),decodeURIComponent(x.slice(i+1))]}))}
let resetToken=db.prepare("SELECT details FROM audit_log WHERE action='FRESH_START_RESET' ORDER BY id DESC LIMIT 1").get()?.details;
function refreshSessions(){if(!DEMO_MODE){const current=db.prepare("SELECT details FROM audit_log WHERE action='FRESH_START_RESET' ORDER BY id DESC LIMIT 1").get()?.details;if(current!==resetToken){sessions.clear();resetToken=current}}}
function auth(req){refreshSessions();const sid=parseCookies(req).ptc_session,s=sessions.get(sid)||demoSession(sid);if(!s||s.exp<Date.now()){if(sid)sessions.delete(sid);return null}return s}
function requireRole(req,res,roles){const u=auth(req);if(!u){json(res,401,{error:'Authentication required'});return null}if(roles&&!roles.includes(u.role)){json(res,403,{error:'Access denied'});return null}return u}
function csrf(req,u){return req.headers['x-csrf-token']===u.csrf}
function requireWrite(req,res,roles){const u=requireRole(req,res,roles);if(!u)return null;if(!csrf(req,u)){json(res,403,{error:'Invalid security token'});return null}return u}
function audit(actor,action,type,id,details){db.prepare('INSERT INTO audit_log(actor,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)').run(actor,action,type,id,details||'')}
function broadcast(event,data){const nl=String.fromCharCode(10),msg='event: '+event+nl+'data: '+JSON.stringify(data)+nl+nl;for(const r of clients){try{r.write(msg)}catch{clients.delete(r)}}}
function observerOwns(user,id){return !!db.prepare(`SELECT 1 FROM observer_participants op JOIN participants p ON p.id=op.participant_id JOIN users u ON u.id=op.observer_user_id WHERE op.observer_user_id=? AND p.id=? AND p.active=1 AND u.active=1 AND u.role='OBSERVER'`).get(user.id,id)}
function observerScope(user,alias='p'){return user?.role==='OBSERVER'?{sql:` AND ${alias}.active=1 AND ${alias}.id IN (SELECT participant_id FROM observer_participants WHERE observer_user_id=?)`,args:[user.id]}:{sql:'',args:[]}}
function scopedFilter(user,url){const channel=channelWhere(url),scope=observerScope(user);return {sql:channel.sql+scope.sql,args:[...channel.args,...scope.args]}}
function scopedChannels(user){const scope=observerScope(user);return db.prepare(`SELECT DISTINCT tc.channel FROM test_cases tc JOIN assignments a ON a.test_case_id=tc.id JOIN participants p ON p.id=a.participant_id WHERE 1=1${scope.sql} ORDER BY tc.channel COLLATE NOCASE`).all(...scope.args).map(x=>x.channel)}
function observerTesters(user){return {items:db.prepare(`SELECT p.id,p.code,p.name,p.type,p.active,COUNT(a.id) assigned,COALESCE(SUM(a.status IN ('COMPLETED','RESOLVED')),0) completed FROM observer_participants op JOIN participants p ON p.id=op.participant_id LEFT JOIN assignments a ON a.participant_id=p.id WHERE op.observer_user_id=? GROUP BY p.id ORDER BY p.type,p.code`).all(user.id),available:db.prepare('SELECT p.id,p.code,p.name,p.type FROM participants p WHERE p.active=1 AND NOT EXISTS(SELECT 1 FROM observer_participants op WHERE op.participant_id=p.id) ORDER BY p.type,p.code').all()}}
function observerAssignments(user,url,all=false){
  const filter=scopedFilter(user,url),raw=url.searchParams.get('participantId')||url.searchParams.get('participant');
  if(raw){const p=db.prepare('SELECT id FROM participants WHERE id=? OR code=?').get(Number(raw)||0,raw);if(!p||!observerOwns(user,p.id))throw Object.assign(Error('Tester is not linked to this Observer'),{status:403});filter.sql+=' AND p.id=?';filter.args.push(p.id)}
  const featureFrom=` FROM assignments a JOIN test_cases tc ON tc.id=a.test_case_id JOIN participants p ON p.id=a.participant_id WHERE 1=1${filter.sql}`;
  const options=column=>db.prepare(`SELECT DISTINCT tc.${column} value${featureFrom} AND TRIM(tc.${column})<>'' ORDER BY tc.${column} COLLATE NOCASE`).all(...filter.args).map(x=>x.value);
  const availableMainFeatures=all?options('main_feature'):[],availableSubFeatures=all?options('sub_feature'):[];
  if(all){const extra=observerCaseFilter(url);filter.sql+=extra.sql;filter.args.push(...extra.args)}
  const rawPage=url.searchParams.get('page'),page=all?1:(rawPage===null?1:Number(rawPage)),limit=all?-1:50;if(!Number.isSafeInteger(page)||page<1)throw Object.assign(Error('Valid page required'),{status:400});
  const from=` FROM assignments a JOIN test_cases tc ON tc.id=a.test_case_id JOIN participants p ON p.id=a.participant_id WHERE 1=1${filter.sql}`;
  const total=db.prepare('SELECT COUNT(*) total'+from).get(...filter.args).total;
  const order=all?caseOrder(url,'tc.channel COLLATE NOCASE,tc.priority,a.sequence_no','a.id'):'tc.channel COLLATE NOCASE,tc.priority,a.sequence_no,a.id';
  const items=db.prepare('SELECT a.*,tc.case_code,tc.source_case_id,tc.subcategory,tc.source_sheet,tc.category,tc.type,tc.case_type,tc.main_feature,tc.sub_feature,tc.title,tc.priority,tc.steps,tc.process,tc.expected_result,tc.channel,p.id participant_id,p.code,p.name,p.type participant_type'+from+' ORDER BY '+order+' LIMIT ? OFFSET ?').all(...filter.args,limit,(page-1)*limit).map(x=>({...x,source_details:safeJson(x.source_details_json),source_details_json:undefined}));
  return {items,total,page,limit,availableChannels:scopedChannels(user),availableMainFeatures,availableSubFeatures,filters:Object.fromEntries(url.searchParams),...(all?sortSelection(url):{})};
}
function cleanText(value){return String(value??'').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').replace(/\s+/g,' ').trim()}
function decodedWorkbook(value,label){
  if(!value||typeof value.fileName!=='string'||!value.fileName.toLowerCase().endsWith('.xlsx')||typeof value.dataBase64!=='string')throw Object.assign(Error(label+' must be an .xlsx file'),{status:400});
  if(!/^[A-Za-z0-9+/]*={0,2}$/.test(value.dataBase64)||value.dataBase64.length%4===1)throw Object.assign(Error(label+' file encoding is invalid'),{status:400});
  const data=Buffer.from(value.dataBase64,'base64');
  if(data.length<4||data.length>XLSX_LIMIT||data[0]!==0x50||data[1]!==0x4b)throw Object.assign(Error(label+' must be a valid .xlsx file smaller than 10 MB'),{status:400});
  return {fileName:path.basename(value.fileName),data};
}
const PRODUCTION_STATUSES=Object.freeze({
  PASSED:'Passed',FAILED:'Failed',PENDING:'Pending',DEPENDENCY:'Dependency',
  NOT_EXECUTED:'Not Executed',NCFL:'NCFL',PRODUCTION_TEST:'Production Test',
  PRODUCTION_BUG:'Production Bug',NOT_APPLICABLE:'N/A',IN_PROGRESS:'In Progress',STAGE_TEST:'Stage Test'
});
const WORKFLOW_STATES=Object.freeze(['UNASSIGNED','ASSIGNED','IN_PROGRESS','PENDING_QA','RETESTING','QA_VERIFIED']);
function normalizeProductionStatus(value){
  const key=cleanText(value).toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ');
  return Object.keys(PRODUCTION_STATUSES).find(code=>PRODUCTION_STATUSES[code].toLowerCase()===key)||null;
}
function safeJson(value){try{return JSON.parse(value||'{}')}catch{return {}}}
function channelWhere(url,column='tc.channel'){const value=cleanText(url.searchParams.get('channel'));return value?{sql:' AND '+column+' = ? COLLATE NOCASE',args:[value]}:{sql:'',args:[]}}

function assignmentCaseFilter(url){
 const filter=channelWhere(url),sheet=url.searchParams.get('sheet')||'',priority=cleanText(url.searchParams.get('priority'));
 if(sheet){filter.sql+=' AND tc.source_sheet=?';filter.args.push(sheet)}
 if(priority){if(!/^[1234]$/.test(priority))throw Object.assign(Error('Priority must be 1, 2, 3 or 4'),{status:400});filter.sql+=' AND tc.priority=?';filter.args.push(Number(priority))}
 return filter;
}
function assignmentSheets(url){const filter=channelWhere(url);return db.prepare(`SELECT DISTINCT tc.source_sheet FROM test_cases tc WHERE tc.source_sheet<>''${filter.sql} ORDER BY tc.source_sheet COLLATE NOCASE`).all(...filter.args).map(x=>x.source_sheet)}
function summary(){
  const totals=db.prepare(`SELECT COUNT(*) total,COALESCE(SUM(status IN ('COMPLETED','RESOLVED')),0) completed,COALESCE(SUM(status='FAILED'),0) failed,COALESCE(SUM(status='BLOCKED'),0) blocked,COALESCE(SUM(status='RESOLVED'),0) resolved,COALESCE(SUM(status IN ('NOT_STARTED','IN_PROGRESS','PENDING_QA','RETESTING')),0) pending FROM assignments`).get();
  const counts=db.prepare(`SELECT COALESCE(SUM(type='AGENT'),0) agents,COALESCE(SUM(type='BRANCH'),0) branches FROM participants WHERE active=1`).get();
  const channelRows=db.prepare(`SELECT tc.channel channel,COUNT(*) total,COALESCE(SUM(a.status IN ('COMPLETED','RESOLVED')),0) completed,COALESCE(SUM(a.status='FAILED'),0) failed,COALESCE(SUM(a.status='BLOCKED'),0) blocked,COALESCE(SUM(a.status='RESOLVED'),0) resolved,COALESCE(SUM(a.status IN ('NOT_STARTED','IN_PROGRESS','PENDING_QA','RETESTING')),0) pending,COALESCE(SUM(TRIM(a.finance_status)<>'' AND LOWER(TRIM(a.finance_status)) NOT IN ('verified','passed','complete','completed')),0) financePending FROM assignments a JOIN test_cases tc ON tc.id=a.test_case_id GROUP BY tc.channel ORDER BY failed+blocked DESC,tc.channel COLLATE NOCASE`).all().map(row=>({...row,completionPercent:row.total?Math.round(row.completed*100/row.total):0}));
  const people=db.prepare(`SELECT p.id,p.code,p.name,p.type,p.observer,COUNT(a.id) total,COALESCE(SUM(a.status IN ('COMPLETED','RESOLVED')),0) completed,COUNT(DISTINCT CASE WHEN a.status NOT IN ('COMPLETED','RESOLVED') THEN tc.channel END) activeChannels,COALESCE(MAX(CASE WHEN a.status='FAILED' THEN 6 WHEN a.status='BLOCKED' THEN 5 WHEN a.status='IN_PROGRESS' THEN 4 WHEN a.status='PENDING_QA' THEN 3 WHEN a.status='COMPLETED' THEN 2 ELSE 1 END),1) rank FROM participants p LEFT JOIN assignments a ON a.participant_id=p.id LEFT JOIN test_cases tc ON tc.id=a.test_case_id WHERE p.active=1 GROUP BY p.id ORDER BY p.type,p.code`).all().map(p=>({...p,status:['','NOT_STARTED','COMPLETED','PENDING_QA','IN_PROGRESS','BLOCKED','FAILED'][p.rank]}));
  const last=db.prepare("SELECT MAX(updated_at) value FROM assignments").get().value;
  return {...totals,...counts,people,channels:channelRows,availableChannels:channelRows.map(x=>x.channel),goLive:'2026-10-02T00:00:00+07:00',lastUpdated:last||new Date().toISOString(),serverTime:new Date().toISOString()};
}

function participantTvSummary(user,type){
  const privileged=['ADMIN','QA_LEAD','MANAGER','DISPLAY','OBSERVER'].includes(user.role);
  const participantOnly=['AGENT','BRANCH'].includes(user.role);
  if(!privileged&&!participantOnly)return null;
  if(participantOnly&&user.role!==type)return null;
  const scope=participantOnly?' AND p.id=?':'',args=participantOnly?[type,user.participantId]:[type];
  if(participantOnly&&!user.participantId)return null;
  const submitted="'PENDING_QA','COMPLETED','FAILED','BLOCKED','RESOLVED'";
  const items=db.prepare(`SELECT p.id,p.code,p.name,p.type,COUNT(a.id) assigned,
    COALESCE(SUM(a.status IN (${submitted})),0) submitted,
    COUNT(DISTINCT tc.channel) activeChannels,
    MAX(a.updated_at) updatedAt
    FROM participants p
    JOIN assignments a ON a.participant_id=p.id
    JOIN test_cases tc ON tc.id=a.test_case_id
    WHERE p.active=1 AND p.type=?${scope}
    GROUP BY p.id
    ORDER BY p.code COLLATE NOCASE`).all(...args).map(row=>({
      ...row,
      progressPercent:row.assigned?Math.round(row.submitted*100/row.assigned):0,
      status:row.assigned>0&&row.submitted===row.assigned?'Done':'Testing'
    }));
  const assignedCases=items.reduce((total,item)=>total+item.assigned,0);
  const submittedCases=items.reduce((total,item)=>total+item.submitted,0);
  return {type,assignedCases,submittedCases,testingParticipants:items.filter(item=>item.status==='Testing').length,doneParticipants:items.filter(item=>item.status==='Done').length,lastUpdated:items.map(item=>item.updatedAt).filter(Boolean).sort().at(-1)||new Date().toISOString(),items};
}

function cellValue(cell){
  const value=cell?.value;
  if(value===null||value===undefined)return '';
  if(value instanceof Date)return value;
  if(typeof value==='object'){
    if(Object.hasOwn(value,'result'))return value.result??'';
    if(value.hyperlink)return value.text||value.hyperlink;
    if(Array.isArray(value.richText))return value.richText.map(x=>x.text).join('');
    if(value.text)return value.text;
  }
  return value;
}
function normalizedHeader(value){return cleanText(value).toLowerCase().replace(/[^a-z0-9#]+/g,' ').trim()}
function priorityValue(value){const match=cleanText(value).match(/[1-4]/);return match?Number(match[0]):null}
function statusValue(value){
  const key=cleanText(value).toUpperCase().replace(/[^A-Z]+/g,'_').replace(/^_|_$/g,'');
  return {PASSED:'COMPLETED',PASS:'COMPLETED',COMPLETED:'COMPLETED',FAILED:'FAILED',FAIL:'FAILED',BLOCKED:'BLOCKED',IN_PROGRESS:'IN_PROGRESS',PENDING_QA:'PENDING_QA',RETESTING:'RETESTING',RESOLVED:'RESOLVED',NOT_STARTED:'NOT_STARTED','':'NOT_STARTED'}[key]||null;
}
function qaStatus(status){return status==='COMPLETED'?'PASSED':status==='FAILED'?'FAILED':status==='BLOCKED'?'BLOCKED':'PENDING'}
function dateValue(value){if(!value)return null;const date=value instanceof Date?value:new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null}
function parseWorkbook(workbook){
  const required=['case id','participant code','channel','scenario','priority level','expected result','status'];
  const errors=[],records=[],caseDefinitions=new Map();
  let rowCount=0;
  for(const sheet of workbook.worksheets){
    let headerRow=null,indexes=null;
    for(let rowNumber=1;rowNumber<=Math.min(sheet.rowCount,20);rowNumber++){
      const map=new Map();
      sheet.getRow(rowNumber).eachCell({includeEmpty:false},(cell,column)=>{const key=normalizedHeader(cellValue(cell));if(key){if(!map.has(key))map.set(key,[]);map.get(key).push(column)}});
      if(map.has('scenario')||map.has('case id')){headerRow=rowNumber;indexes=map;break}
    }
    if(!headerRow)continue;
    for(const field of required)if(!indexes.has(field))errors.push({sheet:sheet.name,row:headerRow,field,title:'Missing required column',message:'Missing required column: '+field});
    if(required.some(field=>!indexes.has(field)))continue;
    const get=(row,name,occurrence=0)=>{const column=indexes.get(name)?.[occurrence];return column?cellValue(row.getCell(column)):''};
    for(let rowNumber=headerRow+1;rowNumber<=sheet.rowCount;rowNumber++){
      const row=sheet.getRow(rowNumber);
      if(!row.hasValues)continue;
      row.eachCell({includeEmpty:false},(cell,column)=>{
        const value=cell.value;
        if(value&&typeof value==='object'&&Object.hasOwn(value,'formula')&&(value.result===null||value.result===undefined)){
          const header=[...indexes.entries()].find(([,columns])=>columns.includes(column))?.[0]||('Column '+column);
          errors.push({sheet:sheet.name,row:rowNumber,field:header,message:'Formula cell has no cached result; recalculate and save the workbook before import'});
        }
      });
      const caseCode=cleanText(get(row,'case id')),participantCode=cleanText(get(row,'participant code')),channel=cleanText(get(row,'channel')),title=cleanText(get(row,'scenario'));
      if(!caseCode&&!participantCode&&!channel&&!title)continue;
      rowCount++;
      if(rowCount>XLSX_ROW_LIMIT){errors.push({sheet:sheet.name,row:rowNumber,field:'Workbook',message:'Workbook exceeds '+XLSX_ROW_LIMIT+' case rows'});break}
      const priority=priorityValue(get(row,'priority level')),status=statusValue(get(row,'status'));
      for(const [field,value] of [['Case ID',caseCode],['Participant Code',participantCode],['Channel',channel],['Scenario',title]])if(!value)errors.push({sheet:sheet.name,row:rowNumber,field,message:field+' is required'});
      const participant=participantCode?db.prepare('SELECT id FROM participants WHERE code=? COLLATE NOCASE AND active=1').get(participantCode):null;
      if(participantCode&&!participant)errors.push({sheet:sheet.name,row:rowNumber,field:'Participant Code',message:'Unknown or inactive participant '+participantCode});
      if(priority===null)errors.push({sheet:sheet.name,row:rowNumber,field:'Priority Level',message:'Priority must contain a number from 1 to 4'});
      if(status===null)errors.push({sheet:sheet.name,row:rowNumber,field:'Status',message:'Unsupported status '+cleanText(get(row,'status'))});
      const expected=cleanText(get(row,'expected result')),caseType=cleanText(get(row,'case type')),process=cleanText(get(row,'cos'))||sheet.name;
      const signature=JSON.stringify([channel.toLowerCase(),title,process,priority,expected,caseType]);
      if(caseDefinitions.has(caseCode)&&caseDefinitions.get(caseCode)!==signature)errors.push({sheet:sheet.name,row:rowNumber,field:'Case ID',message:'Duplicate Case ID has inconsistent case fields'});
      else if(caseCode)caseDefinitions.set(caseCode,signature);
      const details={
        senderAccountType:cleanText(get(row,'account type',0)),senderAccount:cleanText(get(row,'sender account#')),senderCurrency:cleanText(get(row,'currency',0)),
        service:cleanText(get(row,'cos',0)),amountCashIn:get(row,'amount cash in'),customerFee:get(row,'customer fee agent collect cash'),
        agentCollectCash:get(row,'agent collect cash from customer'),senderAmount:get(row,'sender amount wcx'),wingRevenue:get(row,'wing revenue'),commission:get(row,'commission wcx'),
        exchangeRate:get(row,'exchange rate'),rateType:cleanText(get(row,'rate type')),receiverAccountType:cleanText(get(row,'account type',1)),
        receiverAccount:cleanText(get(row,'receiver account')),receiverCurrency:cleanText(get(row,'currency',1)||get(row,'receiver currency')),
        receiverService:cleanText(get(row,'cos',1)||get(row,'receiver cos')),receiverAmount:get(row,'reciver amount')||get(row,'receiver amount'),tid:cleanText(get(row,'tid')),hash:cleanText(get(row,'hash'))
      };
      for(const field of ['master','commission','fee'])if(indexes.has(field))details[field]=get(row,field);
      const category=cleanText(get(row,'category'))||null,type=cleanText(get(row,'type'))||null,mainFeature=cleanText(get(row,'main feature')||get(row,'main service feature')),subFeature=cleanText(get(row,'sub feature'));
      details['main feature']=mainFeature;details['sub feature']=subFeature;
      records.push({sheet:sheet.name,row:rowNumber,caseCode,participantCode,participantId:participant?.id,channel,title,priority,status,expected,caseType,process,category,type,mainFeature,subFeature,actualResult:cleanText(get(row,'actual result')),tester:cleanText(get(row,'tester')),executedAt:dateValue(get(row,'date')),qaRemark:cleanText(get(row,'qa remark')),jiraLink:cleanText(get(row,'jira link')),financeStatus:cleanText(get(row,'finance status')),financeRemark:cleanText(get(row,'finance remark')),details});
    }
  }
  if(!records.length&&!errors.length)errors.push({sheet:'Workbook',row:0,field:'Workbook',message:'No test-case worksheet was found'});
  return {records,errors};
}
async function importXlsx(buffer,actor){
  if(buffer.length<4||buffer[0]!==0x50||buffer[1]!==0x4b)throw Object.assign(Error('A valid .xlsx file is required'),{status:415});
  const workbook=new ExcelJS.Workbook();
  try{await workbook.xlsx.load(buffer,{ignoreNodes:['dataValidations','externalLinks']})}catch{throw Object.assign(Error('The Excel workbook could not be read'),{status:400})}
  const parsed=parseWorkbook(workbook);
  if(parsed.records.some(record=>/^MA-/i.test(record.caseCode)))throw Object.assign(Error('MA- case IDs reserved for My Agent scenarios; workbook import cannot modify them'),{status:409});
  if(parsed.errors.length)throw Object.assign(Error('Workbook validation failed'),{status:400,errors:parsed.errors});
  const findChannel=db.prepare('SELECT channel FROM test_cases WHERE channel=? COLLATE NOCASE LIMIT 1');
  const findCase=db.prepare('SELECT id FROM test_cases WHERE case_code=?');
  const insertCase=db.prepare('INSERT INTO test_cases(case_code,title,process,priority,steps,expected_result,status,qa_status,channel,case_type,source_sheet) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
  const updateCase=db.prepare('UPDATE test_cases SET title=?,process=?,priority=?,expected_result=?,status=?,qa_status=?,channel=?,case_type=?,source_sheet=? WHERE id=?');
  const findAssignment=db.prepare('SELECT id FROM assignments WHERE test_case_id=? AND participant_id=?');
  const insertAssignment=db.prepare('INSERT INTO assignments(test_case_id,participant_id,sequence_no,status,actual_result,tester,executed_at,qa_remark,jira_link,finance_status,finance_remark,source_details_json,updated_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)');
  const updateAssignment=db.prepare('UPDATE assignments SET participant_id=?,sequence_no=?,status=?,actual_result=?,tester=?,executed_at=?,qa_remark=?,jira_link=?,finance_status=?,finance_remark=?,source_details_json=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?');
  let insertedCases=0,updatedCases=0,assignmentsCreated=0,assignmentsUpdated=0;
  const touchedCases=new Set(),channels=new Map(),statusCounts={};
  db.exec('BEGIN');
  try{
    for(const record of parsed.records){
      const canonical=findChannel.get(record.channel)?.channel||channels.get(record.channel.toLowerCase())||record.channel;
      channels.set(record.channel.toLowerCase(),canonical);
      let testCase=findCase.get(record.caseCode);
      if(!testCase){const result=insertCase.run(record.caseCode,record.title,record.process,record.priority,'',record.expected,record.status,qaStatus(record.status),canonical,record.caseType,record.sheet);testCase={id:result.lastInsertRowid};insertedCases++}
      else if(!touchedCases.has(record.caseCode)){updateCase.run(record.title,record.process,record.priority,record.expected,record.status,qaStatus(record.status),canonical,record.caseType,record.sheet,testCase.id);updatedCases++}
      touchedCases.add(record.caseCode);
      db.prepare('UPDATE test_cases SET category=?,type=?,main_feature=?,sub_feature=? WHERE id=?').run(record.category,record.type,record.mainFeature,record.subFeature,testCase.id);
      const assignment=findAssignment.get(testCase.id,record.participantId);
      const args=[record.row,record.status,record.actualResult,record.tester,record.executedAt,record.qaRemark,record.jiraLink,record.financeStatus,record.financeRemark,JSON.stringify(record.details),actor];
      let assignmentId;
      if(assignment){updateAssignment.run(record.participantId,...args,assignment.id);assignmentId=assignment.id;assignmentsUpdated++}
      else{const result=insertAssignment.run(testCase.id,record.participantId,...args);assignmentId=result.lastInsertRowid;assignmentsCreated++}
      if(record.status==='FAILED')db.prepare("INSERT INTO defects(assignment_id,severity,status,owner,updated_by) VALUES(?,'HIGH','REPORTED','',?) ON CONFLICT(assignment_id) DO UPDATE SET status='REOPENED',updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").run(assignmentId,actor);
      statusCounts[record.status]=(statusCounts[record.status]||0)+1;
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error}
  audit(actor,'IMPORT_XLSX','TEST_CASE',null,JSON.stringify({insertedCases,updatedCases,assignmentsCreated,assignmentsUpdated}));
  broadcast('refresh',{scope:'all'});
  return {insertedCases,updatedCases,assignmentsCreated,assignmentsUpdated,channels:[...channels.values()].sort((a,b)=>a.localeCompare(b)),statusCounts,rejectedRows:0};
}

function svgQr(text){const q=new QRCode(-1,1);q.addData(text);q.make();const n=q.getModuleCount(),s=8,p=4,size=(n+p*2)*s;let rects='';for(let y=0;y<n;y++)for(let x=0;x<n;x++)if(q.isDark(y,x))rects+=`<rect x="${(x+p)*s}" y="${(y+p)*s}" width="${s}" height="${s}"/>`;return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="white"/><g fill="#07101f">${rects}</g></svg>`}
function signedQr(id){const exp=Date.now()+8*3600000,p=id+'.'+exp,s=crypto.createHmac('sha256',SECRET).update(p).digest('base64url');return Buffer.from(p+'.'+s).toString('base64url')}
function verifyQr(t){try{const raw=Buffer.from(t,'base64url').toString(),[id,exp,s]=raw.split('.'),expected=crypto.createHmac('sha256',SECRET).update(id+'.'+exp).digest('base64url'),ok=s&&s.length===expected.length&&crypto.timingSafeEqual(Buffer.from(s),Buffer.from(expected));return ok&&Number(exp)>Date.now()?Number(id):null}catch{return null}}

async function api(req,res,url){
  if(url.pathname==='/api/my-agent'||url.pathname.startsWith('/api/my-agent/')){
    const user=req.method==='GET'?requireRole(req,res,['ADMIN']):requireWrite(req,res,['ADMIN']);if(!user)return;
    if(url.pathname==='/api/my-agent/loop'&&req.method==='GET')return json(res,200,agentLoop.overview(db));
    if(url.pathname==='/api/my-agent'&&req.method==='GET')return json(res,200,myAgent.overview(db));
    if(req.method==='POST'){
      const input=await bodyJson(req);
      if(url.pathname==='/api/my-agent/loop/back'){const result=agentLoop.back(db,input,user.username,audit);broadcast('refresh',{scope:'all'});return json(res,200,result)}
      if(url.pathname==='/api/my-agent/loop/next'){const result=agentLoop.next(db,input,user.username,audit);broadcast('refresh',{scope:'all'});return json(res,200,result)}
      if(url.pathname==='/api/my-agent/scenarios'){const result=myAgent.create(db,input,user.username,audit);broadcast('refresh',{scope:'all'});return json(res,201,result)}
      if(url.pathname==='/api/my-agent/next'){const result=myAgent.next(db,user.username,audit);broadcast('refresh',{scope:'all'});return json(res,200,result)}
      if(url.pathname==='/api/my-agent/assign'){const result=myAgent.assign(db,input,user.username,audit,addCaseUser);broadcast('refresh',{scope:'all'});return json(res,200,result)}
      if(url.pathname==='/api/my-agent/cancel'){db.prepare('UPDATE agent_round_state SET preview_json=NULL WHERE id=1').run();return json(res,200,{ok:true})}
    }
    return json(res,404,{error:'Not found'});
  }

  if(url.pathname==='/api/login'&&req.method==='POST'){
    const d=await bodyJson(req),u=db.prepare('SELECT * FROM users WHERE username=? AND active=1').get(cleanText(d.username));
    if(!u||u.password_hash!==hash(d.password))return json(res,401,{error:'Invalid username or password'});
    const participant=u.participant_id&&db.prepare('SELECT id,code,name,type FROM participants WHERE id=? AND active=1').get(u.participant_id);if(u.participant_id&&!participant)return json(res,403,{error:'This login is not linked to an active participant'});
    const maxAge=u.role==='DISPLAY'?604800:43200,sid=crypto.randomBytes(32).toString('base64url'),s={id:u.id,username:u.username,role:u.role,name:u.display_name,participantId:participant?.id,participantCode:participant?.code,csrf:crypto.randomBytes(20).toString('hex'),exp:Date.now()+maxAge*1000};
    const key=sessionKey(sid,s);if(!DEMO_MODE)sessions.set(key,s);res.setHeader('Set-Cookie',`ptc_session=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${COOKIE_SECURE?'; Secure':''}`);audit(u.username,'LOGIN','USER',u.id);return json(res,200,{user:s});
  }
  if(url.pathname==='/api/logout'&&req.method==='POST'){const c=parseCookies(req);sessions.delete(c.ptc_session);res.setHeader('Set-Cookie','ptc_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return json(res,200,{ok:true})}
  if(url.pathname==='/api/me'){const u=requireRole(req,res);if(u)return json(res,200,{user:u,...(DEMO_MODE?{demo:true}:{})});return}
  if(url.pathname==='/api/events'){if(DEMO_MODE){const u=requireRole(req,res);if(!u)return;res.writeHead(204);return res.end()}
    const u=requireRole(req,res);if(!u)return;
    const nl=String.fromCharCode(10);res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write('event: connected'+nl+'data: {}'+nl+nl);clients.add(res);req.on('close',()=>clients.delete(res));return;
  }
  if(url.pathname==='/api/dashboard'){
    const u=requireRole(req,res,['MANAGER','DISPLAY','ADMIN','QA_LEAD','OBSERVER']);if(!u)return;
    return json(res,200,summary());
  }
  if(url.pathname==='/api/tv/participants'&&req.method==='GET'){
    const u=requireRole(req,res);if(!u)return;
    const type=cleanText(url.searchParams.get('type')).toUpperCase();
    if(!['AGENT','BRANCH'].includes(type))return json(res,400,{error:'TV type must be Agent or Branch'});
    const result=participantTvSummary(u,type);if(!result)return json(res,403,{error:'Access denied'});
    return json(res,200,result);
  }
  if(url.pathname.startsWith('/api/observer/')){
    const u=req.method==='GET'?requireRole(req,res,['OBSERVER']):requireWrite(req,res,['OBSERVER']);if(!u)return;
    if(url.pathname==='/api/observer/assignments'&&req.method==='GET')return json(res,200,observerAssignments(u,url));
    if(url.pathname==='/api/observer/testers'&&req.method==='GET')return json(res,200,observerTesters(u));
    const unlink=url.pathname.match(/^\/api\/observer\/testers\/(\d+)$/);
    if((url.pathname==='/api/observer/testers'&&req.method==='POST')||(unlink&&req.method==='DELETE')){
      const d=unlink?{}:await bodyJson(req),id=Number(unlink?unlink[1]:d.participantId);
      if(!Number.isSafeInteger(id)||id<1)return json(res,400,{error:'Valid participantId required'});
      const p=db.prepare('SELECT * FROM participants WHERE id=?').get(id);if(!p)return json(res,404,{error:'Tester not found'});
      if(unlink){const owner=db.prepare('SELECT observer_user_id FROM observer_participants WHERE participant_id=?').get(id);if(!owner||owner.observer_user_id!==u.id)return json(res,403,{error:'Tester is not linked to this Observer'});db.prepare('DELETE FROM observer_participants WHERE participant_id=? AND observer_user_id=?').run(id,u.id)}
      else{if(!p.active)return json(res,400,{error:'Select an active tester'});try{db.prepare('INSERT INTO observer_participants(observer_user_id,participant_id) VALUES(?,?)').run(u.id,id)}catch{return json(res,409,{error:'Tester already belongs to an Observer'})}}
      audit(u.username,unlink?'UNLINK':'LINK','OBSERVER_TESTER',id,p.code);broadcast('refresh',{scope:'all'});return json(res,unlink?200:201,{ok:true});
    }
    return json(res,404,{error:'Not found'});
  }
  if(url.pathname==='/api/users'){
    const u=req.method==='GET'?requireRole(req,res,['ADMIN']):requireWrite(req,res,['ADMIN']);if(!u)return;
    if(req.method==='GET')return json(res,200,{items:db.prepare("SELECT u.id,u.username,u.role,u.display_name,u.active,u.participant_id,p.code participant_code FROM users u LEFT JOIN participants p ON p.id=u.participant_id ORDER BY u.role,u.username").all()});
    if(req.method==='POST'){
      const d=await bodyJson(req),username=cleanText(d.username),displayName=cleanText(d.displayName),role=cleanText(d.role).toUpperCase(),participantId=Number(d.participantId)||null;
      const participant=participantId&&db.prepare('SELECT id,type FROM participants WHERE id=? AND active=1').get(participantId);
      const password=String(d.password||''),supportedRoles=['MANAGER','DISPLAY','AGENT','BRANCH','OBSERVER'],participantRole=['AGENT','BRANCH'].includes(role),linkedRole=participantRole||role==='OBSERVER';
      if(!/^[A-Za-z0-9._-]{3,50}$/.test(username)||!displayName||!supportedRoles.includes(role)||!password)return json(res,400,{error:'Username, display name, supported role and a non-empty password are required'});
      if(participantRole&&(!participant||participant.type!==role))return json(res,400,{error:'Select an active matching participant for an Agent or Branch login'});
      if(role==='OBSERVER'&&participantId&&!participant)return json(res,400,{error:'Select an active Agent or Branch participant for an Observer login'});
      if(!linkedRole&&participantId)return json(res,400,{error:'Manager and Display logins cannot be linked to a participant'});
      try{db.exec('BEGIN IMMEDIATE');const result=db.prepare('INSERT INTO users(username,password_hash,role,display_name,participant_id) VALUES(?,?,?,?,?)').run(username,hash(d.password),role,displayName,role==='OBSERVER'?null:participantId);if(role==='OBSERVER'&&participantId)db.prepare('INSERT INTO observer_participants(observer_user_id,participant_id) VALUES(?,?)').run(result.lastInsertRowid,participantId);audit(u.username,'CREATE','USER',result.lastInsertRowid,role);db.exec('COMMIT');return json(res,201,{id:result.lastInsertRowid})}catch{db.exec('ROLLBACK');return json(res,409,{error:'Username or participant login already exists'})}
    }
    return json(res,405,{error:'Method not allowed'});
  }
  if(url.pathname.match(/^\/api\/users\/\d+\/active$/)&&req.method==='PUT'){
    const u=requireWrite(req,res,['ADMIN']);if(!u)return;const id=Number(url.pathname.split('/')[3]),d=await bodyJson(req),target=db.prepare('SELECT role FROM users WHERE id=?').get(id);
    if(!target||!['MANAGER','DISPLAY'].includes(target.role))return json(res,400,{error:'Only Manager or Display accounts can be changed here'});
    db.prepare('UPDATE users SET active=? WHERE id=?').run(d.active?1:0,id);audit(u.username,d.active?'ACTIVATE':'DEACTIVATE','USER',id);return json(res,200,{ok:true});
  }
  if(url.pathname==='/api/test-cases/import-xlsx'&&req.method==='POST'){
    const u=requireWrite(req,res,['ADMIN']);if(!u)return;
    if(!String(req.headers['content-type']||'').includes('spreadsheetml'))return json(res,415,{error:'A .xlsx workbook is required'});
    try{return json(res,200,await importXlsx(await readBody(req,XLSX_LIMIT),u.username))}catch(error){return json(res,error.status||500,{error:error.message,errors:error.errors||[]})}
  }
  if(url.pathname==='/api/test-cases/import-production'&&req.method==='POST'){
    const u=requireWrite(req,res,['ADMIN']);if(!u)return;
    let channel=cleanText(url.searchParams.get('channel'));if(!channel||channel.length>100)return json(res,400,{error:'Channel name required (maximum 100 characters)'});
    channel=db.prepare('SELECT channel FROM test_cases WHERE channel=? COLLATE NOCASE LIMIT 1').get(channel)?.channel||channel;
    const parsed=await parseProductionWorkbook(await readBody(req,XLSX_LIMIT),{channel,fileName:'production.xlsx'});
    if(parsed.errors.length||!parsed.records.length)return json(res,400,{error:parsed.errors.length?'Production workbook validation failed':'No production test cases found',errors:parsed.errors});
    const summary=require('./lib/production-import').importProductionData(db,parsed.records,u.username);
    broadcast('refresh',{scope:'all'});return json(res,200,{...summary,excludedSheets:parsed.excludedSheets});
  }
  if(url.pathname==='/api/test-cases/replace-production'&&req.method==='POST'){
    const u=requireWrite(req,res,['ADMIN']);if(!u)return;if(DEMO_MODE||SHARED_DATABASE)return json(res,400,{error:'Full database replacement unavailable in serverless/shared storage. Use production sample upload by channel.'});
    try{
      const payload=await bodyJson(req,28*1024*1024);
      if(payload.confirmation!=='REPLACE 800 CASES')return json(res,400,{error:'Type REPLACE 800 CASES to confirm replacement'});
      const pos=decodedWorkbook(payload.pos,'WCX POS'),ekyc=decodedWorkbook(payload.ekyc,'WCX eKYC');
      const parsedPos=await parseProductionWorkbook(pos.data,{channel:'WCX POS',fileName:pos.fileName}),parsedEkyc=await parseProductionWorkbook(ekyc.data,{channel:'WCX eKYC',fileName:ekyc.fileName});
      const errors=[...parsedPos.errors,...parsedEkyc.errors];
      if(errors.length)return json(res,400,{error:'Production workbook validation failed',errors});
      const records=[...parsedPos.records,...parsedEkyc.records];
      if(records.length!==800)return json(res,400,{error:'Production workbook reconciliation failed',errors:[{field:'Workbook',message:'Expected 800 cases; received '+records.length}]});
      const backup=await backupDatabase(DB_PATH,path.join(ROOT,'data','backups'));
      const summary=replaceProductionData(db,records,u.username,[{fileName:pos.fileName,excludedSheets:parsedPos.excludedSheets},{fileName:ekyc.fileName,excludedSheets:parsedEkyc.excludedSheets}]);
      broadcast('refresh',{scope:'all'});return json(res,200,{...summary,backupFile:path.basename(backup)});
    }catch(error){return json(res,error.status||500,{error:error.message==='Payload too large'?'Payload too large':'Production replacement failed',errors:error.errors||[]})}
  }
  if(url.pathname==='/api/test-cases/assignments'&&req.method==='PUT'){
    const u=requireWrite(req,res,['ADMIN']);if(!u)return;const d=await bodyJson(req),participantId=Number(d.participantId),caseIds=[...new Set(Array.isArray(d.caseIds)?d.caseIds.map(Number):[])];
    if(!caseIds.length||caseIds.length>10000||caseIds.some(id=>!Number.isSafeInteger(id)||id<1))return json(res,400,{error:'Select between 1 and 10,000 valid test cases'});
    const participant=db.prepare('SELECT id,code,name FROM participants WHERE id=? AND active=1').get(participantId);if(!participant)return json(res,400,{error:'An active participant is required'});
    let added=0;
    try{db.exec('BEGIN IMMEDIATE');for(const caseId of caseIds){if(!db.prepare('SELECT id FROM test_cases WHERE id=?').get(caseId))throw Object.assign(Error('One or more test cases were not found'),{status:404});const result=addCaseUser(db,caseId,participantId,u.username);if(result.added){added++;audit(u.username,'ADD_CASE_USER','ASSIGNMENT',result.id,String(participantId))}}db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
    broadcast('refresh',{scope:'all'});return json(res,200,{ok:true,updated:added,participant});
  }
  if(url.pathname==='/api/test-cases'&&req.method==='GET'){
    const u=requireRole(req,res,['ADMIN']);if(!u)return;const filter=assignmentCaseFilter(url),limit=Math.min(100,Math.max(1,Number(url.searchParams.get('limit'))||50)),offset=Math.max(0,Number(url.searchParams.get('offset'))||0),status=cleanText(url.searchParams.get('status')).toUpperCase();
    if(status){if(!['NOT_STARTED','IN_PROGRESS','PENDING_QA','COMPLETED','FAILED','BLOCKED','RETESTING','RESOLVED'].includes(status))return json(res,400,{error:'Unknown assignment status'});filter.sql+=' AND EXISTS(SELECT 1 FROM assignments af WHERE af.test_case_id=tc.id AND af.status=?)';filter.args.push(status)}
    const items=db.prepare(`SELECT tc.id,tc.case_code,tc.source_case_id,tc.subcategory,tc.channel,tc.title,tc.process,tc.priority,tc.case_type,tc.source_sheet,tc.category,tc.type,tc.main_feature,tc.sub_feature,(SELECT COUNT(*) FROM assignments ac WHERE ac.test_case_id=tc.id AND ac.participant_id IS NOT NULL) assignments,a.id assignment_id,a.participant_id,p.code participant_code,p.name participant_name,a.status assignment_status,a.production_status FROM test_cases tc${caseJoins}WHERE 1=1${filter.sql} GROUP BY tc.id ORDER BY ${caseOrder(url,'tc.channel COLLATE NOCASE,tc.priority,tc.case_code')} LIMIT ? OFFSET ?`).all(...filter.args,limit,offset);
    const total=db.prepare(`SELECT COUNT(*) count FROM test_cases tc${caseJoins}WHERE 1=1${filter.sql}`).get(...filter.args).count;return json(res,200,{items:hydrateCaseUsers(db,items),total,limit,offset,availableSheets:assignmentSheets(url)});
  }
  if(url.pathname.match(/^\/api\/test-cases\/\d+\/assignment$/)&&req.method==='PUT'){
    const u=requireWrite(req,res,['ADMIN']);if(!u)return;const testCaseId=Number(url.pathname.split('/')[3]),d=await bodyJson(req),participantId=Number(d.participantId);
    if(!db.prepare('SELECT id FROM participants WHERE id=? AND active=1').get(participantId))return json(res,400,{error:'An active participant is required'});
    let result;
    try{db.exec('BEGIN IMMEDIATE');if(!db.prepare('SELECT id FROM test_cases WHERE id=?').get(testCaseId))throw Object.assign(Error('Case not found'),{status:404});result=addCaseUser(db,testCaseId,participantId,u.username);if(result.added)audit(u.username,'ADD_CASE_USER','ASSIGNMENT',result.id,String(participantId));db.exec('COMMIT')}catch(error){db.exec('ROLLBACK');throw error}
    broadcast('refresh',{scope:'all'});return json(res,200,{ok:true,...result});
  }
  if(/^\/api\/assignments\/\d+$/.test(url.pathname)&&req.method==='DELETE'){
    const u=requireWrite(req,res,['ADMIN']);if(!u)return;const id=Number(url.pathname.split('/')[3]);
    try{db.exec('BEGIN IMMEDIATE');const a=db.prepare('SELECT * FROM assignments WHERE id=?').get(id);if(!a||a.participant_id==null)throw Object.assign(Error('Assignment not found'),{status:404});if(a.status!=='NOT_STARTED'||db.prepare('SELECT id FROM defects WHERE assignment_id=?').get(id))throw Object.assign(Error('Only unstarted assignments can be removed'),{status:409});
      if(db.prepare('SELECT case_id FROM agent_scenario_cases WHERE case_id=?').get(a.test_case_id))throw Object.assign(Error('My Agent round subtasks cannot be individually removed'),{status:409});
      const count=db.prepare('SELECT COUNT(*) n FROM assignments WHERE test_case_id=?').get(a.test_case_id).n;
      if(count===1)db.prepare("UPDATE assignments SET participant_id=NULL,workflow_state='UNASSIGNED',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(u.username,id);else db.prepare('DELETE FROM assignments WHERE id=?').run(id);
      audit(u.username,'REMOVE_CASE_USER','ASSIGNMENT',id,String(a.participant_id));db.exec('COMMIT');
    }catch(error){db.exec('ROLLBACK');throw error}
    broadcast('refresh',{scope:'all'});return json(res,200,{ok:true});
  }
  if(url.pathname==='/api/defects'){
    const u=requireRole(req,res,['QA_LEAD','TECH','ADMIN','MANAGER','DISPLAY','OBSERVER']);if(!u)return;const filter=scopedFilter(u,url);
    const items=db.prepare(`SELECT d.*,tc.case_code,tc.source_case_id,tc.title,tc.subcategory,tc.source_sheet,tc.channel,p.code participant_code,p.name participant_name,a.tester,a.qa_remark,a.jira_link,a.finance_status,a.finance_remark FROM defects d JOIN assignments a ON a.id=d.assignment_id JOIN test_cases tc ON tc.id=a.test_case_id JOIN participants p ON p.id=a.participant_id WHERE 1=1${filter.sql} ORDER BY tc.channel COLLATE NOCASE,CASE d.severity WHEN 'CRITICAL' THEN 1 ELSE 2 END,d.updated_at DESC`).all(...filter.args);return json(res,200,{items,availableChannels:u.role==='OBSERVER'?scopedChannels(u):db.prepare('SELECT DISTINCT channel FROM test_cases ORDER BY channel COLLATE NOCASE').all().map(x=>x.channel)});
  }
  if(url.pathname==='/api/qa-submissions'&&req.method==='GET'){
    const u=requireRole(req,res,['QA_LEAD','TECH','ADMIN','OBSERVER']);if(!u)return;const filter=scopedFilter(u,url);
    const items=db.prepare(`SELECT a.id,a.status,a.reported_result,a.submission_note,a.updated_at,tc.case_code,tc.source_case_id,tc.title,tc.subcategory,tc.source_sheet,tc.channel,tc.priority,p.code participant_code,p.name participant_name FROM assignments a JOIN test_cases tc ON tc.id=a.test_case_id JOIN participants p ON p.id=a.participant_id WHERE a.status='PENDING_QA'${filter.sql} ORDER BY tc.channel COLLATE NOCASE,tc.priority,a.updated_at`).all(...filter.args);return json(res,200,{items,availableChannels:u.role==='OBSERVER'?scopedChannels(u):db.prepare('SELECT DISTINCT channel FROM test_cases ORDER BY channel COLLATE NOCASE').all().map(x=>x.channel)});
  }
  if(url.pathname.match(/^\/api\/assignments\/\d+\/qa-review$/)&&req.method==='PUT'){
    const u=requireWrite(req,res,['QA_LEAD','ADMIN','OBSERVER']);if(!u)return;const id=Number(url.pathname.split('/')[3]),d=await bodyJson(req),decision=cleanText(d.decision).toUpperCase(),assignment=db.prepare('SELECT a.*,tc.id test_case_id FROM assignments a JOIN test_cases tc ON tc.id=a.test_case_id WHERE a.id=?').get(id);
    if(!assignment)return json(res,404,{error:'Assignment not found'});if(u.role==='OBSERVER'&&!observerOwns(u,assignment.participant_id))return json(res,403,{error:'Tester is not linked to this Observer'});if(assignment.status!=='PENDING_QA')return json(res,409,{error:'Only Pending QA submissions can be reviewed'});if(!['APPROVE','RETURN'].includes(decision))return json(res,400,{error:'Decision must be Approve or Return'});
    const status=decision==='RETURN'?'RETESTING':{PASSED:'COMPLETED',FAILED:'FAILED',BLOCKED:'BLOCKED'}[assignment.reported_result];if(!status)return json(res,409,{error:'Submission result is missing or invalid'});
    db.prepare('UPDATE assignments SET status=?,qa_remark=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status,cleanText(d.qaRemark),u.username,id);db.prepare('UPDATE test_cases SET status=?,qa_status=? WHERE id=?').run(status,decision==='RETURN'?'PENDING':assignment.reported_result,assignment.test_case_id);
    if(status==='FAILED')db.prepare("INSERT INTO defects(assignment_id,severity,status,owner,updated_by) VALUES(?,?,'REPORTED','',?) ON CONFLICT(assignment_id) DO UPDATE SET status='REOPENED',updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").run(id,'HIGH',u.username);
    audit(u.username,'QA_REVIEW','ASSIGNMENT',id,decision+' -> '+status);broadcast('refresh',{scope:'all'});return json(res,200,{ok:true,status});
  }
  if(url.pathname.match(/^\/api\/defects\/\d+\/status$/)&&req.method==='PUT'){
    const u=requireWrite(req,res,['QA_LEAD','TECH','ADMIN','OBSERVER']);if(!u)return;const id=Number(url.pathname.split('/')[3]),d=await bodyJson(req),allowed=u.role==='TECH'?['ASSIGNED','INVESTIGATING','FIX_IN_PROGRESS','READY_FOR_QA_REVIEW']:['ASSIGNED','INVESTIGATING','FIX_IN_PROGRESS','READY_FOR_QA_REVIEW','READY_FOR_RETEST','RETESTING','RESOLVED','REOPENED'];
    if(!allowed.includes(d.status))return json(res,400,{error:'Invalid status'});const defect=db.prepare('SELECT assignment_id FROM defects WHERE id=?').get(id);if(!defect)return json(res,404,{error:'Defect not found'});if(u.role==='OBSERVER'&&!observerOwns(u,db.prepare('SELECT participant_id FROM assignments WHERE id=?').get(defect.assignment_id).participant_id))return json(res,403,{error:'Tester is not linked to this Observer'});db.prepare('UPDATE defects SET status=?,owner=?,root_cause=?,resolution=?,build_version=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(d.status,d.owner||'',d.rootCause||'',d.resolution||'',d.buildVersion||'',u.username,id);if(d.status==='RESOLVED')db.prepare("UPDATE assignments SET status='RESOLVED',workflow_state='QA_VERIFIED',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(u.username,defect.assignment_id);audit(u.username,'STATUS_UPDATE','DEFECT',id,d.status);broadcast('refresh',{scope:'all'});return json(res,200,{ok:true});
  }
  if(url.pathname==='/api/participants'){
    const u=req.method==='GET'?requireRole(req,res,['ADMIN']):requireWrite(req,res,['ADMIN']);if(!u)return;
    if(req.method==='GET')return json(res,200,{items:db.prepare('SELECT * FROM participants ORDER BY type,code').all()});
    const d=await bodyJson(req);if(!/^([AB])\d{2,4}$/.test(d.code)||!['AGENT','BRANCH'].includes(d.type)||!d.name)return json(res,400,{error:'Valid code, name and type are required'});
    try{const x=db.prepare('INSERT INTO participants(code,name,type,observer) VALUES(?,?,?,?)').run(d.code,d.name,d.type,d.observer||'');audit(u.username,'CREATE','PARTICIPANT',x.lastInsertRowid,d.code);broadcast('refresh',{scope:'all'});return json(res,201,{id:x.lastInsertRowid})}catch{return json(res,409,{error:'Participant code already exists'})}
  }
  if(url.pathname==='/api/my-assignments'){
    const u=requireRole(req,res);if(!u)return;if(u.role==='OBSERVER')return json(res,200,observerAssignments(u,url,true));const participantScoped=['AGENT','BRANCH'].includes(u.role);if(participantScoped&&!u.participantId)return json(res,403,{error:'This login is not linked to an active participant'});const code=u.participantId?'':cleanText(url.searchParams.get('participant'));if(!u.participantId&&!code)return json(res,400,{error:'Participant is required'});const filter=channelWhere(url),scope=u.participantId?'p.id=?':'p.code=?',scopeValue=u.participantId?u.participantId:code;
    const items=db.prepare(`SELECT a.id,a.status,a.actual_result,a.evidence_ref,a.tester,a.executed_at,a.qa_remark,a.jira_link,a.finance_status,a.finance_remark,a.reported_result,a.submission_note,a.source_details_json,tc.case_code,tc.source_case_id,tc.title,tc.subcategory,tc.source_sheet,tc.category,tc.type,tc.main_feature,tc.sub_feature,tc.process,tc.priority,tc.steps,tc.expected_result,tc.channel,tc.case_type,p.code,p.name FROM assignments a JOIN test_cases tc ON tc.id=a.test_case_id JOIN participants p ON p.id=a.participant_id WHERE ${scope}${filter.sql} ORDER BY tc.channel COLLATE NOCASE,tc.priority,a.sequence_no`).all(scopeValue,...filter.args).map(item=>({...item,source_details:safeJson(item.source_details_json),source_details_json:undefined}));
    return json(res,200,{items,availableChannels:[...new Set(items.map(x=>x.channel))]});
  }
  if(url.pathname.match(/^\/api\/assignments\/\d+\/status$/)&&req.method==='PUT'){
    const u=requireWrite(req,res);if(!u)return;const id=Number(url.pathname.split('/')[3]),d=await bodyJson(req),agentAllowed=['IN_PROGRESS','PENDING_QA'],qaAllowed=['COMPLETED','FAILED','BLOCKED','RESOLVED','RETESTING'],executionRoles=['AGENT','BRANCH','OBSERVER'],qaRoles=['QA_LEAD','ADMIN'];if(!executionRoles.includes(u.role)&&!qaRoles.includes(u.role))return json(res,403,{error:'Access denied'});const allowed=qaRoles.includes(u.role)?qaAllowed:agentAllowed,assignment=db.prepare('SELECT participant_id,status FROM assignments WHERE id=?').get(id);if(!allowed.includes(d.status))return json(res,400,{error:'Status is not permitted for your role'});
    if(!assignment)return json(res,404,{error:'Assignment not found'});if(u.role==='OBSERVER'&&!observerOwns(u,assignment.participant_id))return json(res,403,{error:'Tester is not linked to this Observer'});if(['AGENT','BRANCH'].includes(u.role)&&!u.participantId)return json(res,403,{error:'This login is not linked to an active participant'});if(u.participantId&&assignment.participant_id!==u.participantId)return json(res,403,{error:'This assignment belongs to another participant'});if(executionRoles.includes(u.role)&&d.status==='IN_PROGRESS'&&assignment.status!=='NOT_STARTED')return json(res,409,{error:'Only a not-started assignment can be started'});
    let reportedResult='',submissionNote='';if(d.status==='PENDING_QA'){reportedResult=cleanText(d.reportedResult).toUpperCase();submissionNote=cleanText(d.submissionNote);if(!['PASSED','FAILED','BLOCKED'].includes(reportedResult))return json(res,400,{error:'Select Passed, Failed or Blocked before submitting to QA'});if(!['IN_PROGRESS','RETESTING'].includes(assignment.status))return json(res,409,{error:'Only an active or retesting case can be submitted to QA'});if(submissionNote.length>2000)return json(res,400,{error:'Note must be 2,000 characters or fewer'})}
    db.prepare('UPDATE assignments SET status=?,actual_result=?,evidence_ref=?,reported_result=?,submission_note=?,updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(d.status,d.actualResult||'',d.evidenceRef||'',reportedResult,submissionNote,u.username,id);if(d.status==='FAILED')db.prepare("INSERT INTO defects(assignment_id,severity,status,owner,updated_by) VALUES(?,?,'REPORTED','',?) ON CONFLICT(assignment_id) DO UPDATE SET status='REOPENED',updated_by=excluded.updated_by,updated_at=CURRENT_TIMESTAMP").run(id,d.severity||'HIGH',u.username);audit(u.username,'STATUS_UPDATE','ASSIGNMENT',id,d.status+(reportedResult?' · '+reportedResult:''));broadcast('refresh',{scope:'all'});return json(res,200,{ok:true});
  }
  if(url.pathname.match(/^\/api\/participants\/\d+\/qr$/)){
    const u=requireRole(req,res,['ADMIN','QA_LEAD']);if(!u)return;const id=Number(url.pathname.split('/')[3]),token=signedQr(id),link=BASE_URL+'/scan?token='+encodeURIComponent(token);res.writeHead(200,{'Content-Type':'image/svg+xml','Content-Disposition':'inline'});return res.end(svgQr(link));
  }
  return json(res,404,{error:'Not found'});
}

function html(res,status,content,headers={}){res.writeHead(status,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",...headers});res.end(content)}
function redirect(res,location){res.writeHead(303,{Location:location,'Cache-Control':'no-store'});res.end()}
function pageRole(pathname){if(pathname==='/observer')return ['OBSERVER'];if(pathname==='/admin'||pathname==='/my-agent')return ['ADMIN'];if(pathname==='/qa')return ['QA_LEAD','TECH','ADMIN','OBSERVER'];if(pathname==='/tv/management')return ['MANAGER','DISPLAY','ADMIN','QA_LEAD','OBSERVER'];return null}
function assignmentsData(user,url){if(user.role==='OBSERVER')return observerAssignments(user,url,true);
  const participantScoped=['AGENT','BRANCH','OBSERVER'].includes(user.role),code=user.participantId?'':cleanText(url.searchParams.get('participant')),filter=channelWhere(url);
  if(participantScoped&&!user.participantId||!user.participantId&&!code)return {items:[],availableChannels:[]};
  const scope=user.participantId?'p.id=?':'p.code=?',scopeValue=user.participantId?user.participantId:code,items=db.prepare(`SELECT a.id,a.status,a.reported_result,a.submission_note,a.source_details_json,tc.case_code,tc.source_case_id,tc.title,tc.subcategory,tc.source_sheet,tc.category,tc.type,tc.main_feature,tc.sub_feature,tc.priority,tc.expected_result,tc.channel,p.code,p.name FROM assignments a JOIN test_cases tc ON tc.id=a.test_case_id JOIN participants p ON p.id=a.participant_id WHERE ${scope}${filter.sql} ORDER BY tc.channel COLLATE NOCASE,tc.priority,a.sequence_no`).all(scopeValue,...filter.args).map(x=>({...x,source_details:safeJson(x.source_details_json)}));
  return {items,availableChannels:[...new Set(items.map(x=>x.channel))]};
}
function defectData(url,user){const filter=scopedFilter(user,url);return {items:db.prepare(`SELECT d.*,tc.case_code,tc.source_case_id,tc.title,tc.subcategory,tc.source_sheet,tc.channel,p.code participant_code,p.name participant_name,a.tester,a.qa_remark,a.jira_link,a.finance_status FROM defects d JOIN assignments a ON a.id=d.assignment_id JOIN test_cases tc ON tc.id=a.test_case_id JOIN participants p ON p.id=a.participant_id WHERE 1=1${filter.sql} ORDER BY tc.channel COLLATE NOCASE,d.updated_at DESC`).all(...filter.args),availableChannels:user?.role==='OBSERVER'?scopedChannels(user):db.prepare('SELECT DISTINCT channel FROM test_cases ORDER BY channel COLLATE NOCASE').all().map(x=>x.channel)} }
function submissionsData(url,user){const filter=scopedFilter(user,url);return {items:db.prepare(`SELECT a.id,a.reported_result,a.submission_note,tc.case_code,tc.source_case_id,tc.title,tc.subcategory,tc.source_sheet,tc.channel,p.code participant_code,p.name participant_name FROM assignments a JOIN test_cases tc ON tc.id=a.test_case_id JOIN participants p ON p.id=a.participant_id WHERE a.status='PENDING_QA'${filter.sql} ORDER BY tc.channel COLLATE NOCASE,tc.priority,a.updated_at`).all(...filter.args),availableChannels:user?.role==='OBSERVER'?scopedChannels(user):db.prepare('SELECT DISTINCT channel FROM test_cases ORDER BY channel COLLATE NOCASE').all().map(x=>x.channel)} }
function adminData(url){
  const participants=db.prepare('SELECT * FROM participants ORDER BY type,code').all(),users=db.prepare("SELECT u.id,u.username,u.role,u.display_name,u.active FROM users u WHERE u.role IN ('MANAGER','DISPLAY') ORDER BY u.role,u.username").all(),filter=assignmentCaseFilter(url),status=cleanText(url.searchParams.get('status')).toUpperCase(),page=Math.max(1,Number(url.searchParams.get('page'))||1),limit=50,offset=(page-1)*limit;if(status==='NOT_STARTED'){filter.sql+=' AND EXISTS(SELECT 1 FROM assignments af WHERE af.test_case_id=tc.id AND af.status=?)';filter.args.push(status)}
  const cases=db.prepare(`SELECT tc.id,tc.case_code,tc.source_case_id,tc.channel,tc.source_sheet,tc.subcategory,tc.category,tc.type,tc.main_feature,tc.sub_feature,tc.title,tc.priority,a.participant_id,p.code participant_code,p.name participant_name,a.status assignment_status,a.production_status FROM test_cases tc${caseJoins}WHERE 1=1${filter.sql} ORDER BY ${caseOrder(url,'tc.channel COLLATE NOCASE,tc.priority,tc.case_code')} LIMIT ? OFFSET ?`).all(...filter.args,limit,offset);
  const total=db.prepare(`SELECT COUNT(*) count FROM test_cases tc${caseJoins}WHERE 1=1${filter.sql}`).get(...filter.args).count;
  return {createdParticipant:participants.find(p=>p.id===Number(url.searchParams.get('createdParticipant')))||null,participants,users,cases:{items:hydrateCaseUsers(db,cases),offset,limit,total,page},dashboard:summary(),selectedChannel:cleanText(url.searchParams.get('channel')),assignable:status==='NOT_STARTED',availableSheets:assignmentSheets(url),selectedSheet:url.searchParams.get('sheet')||'',selectedPriority:cleanText(url.searchParams.get('priority')),...sortSelection(url),filters:Object.fromEntries(url.searchParams)};
}
function renderHtmxPage(req,res,url){
  const fragment=req.headers['hx-request']==='true'&&req.headers['hx-target']==='content',path=url.pathname,user=auth(req);
  if(path==='/login'){const content=views.login();return html(res,200,fragment?content:views.document({title:'Sign in',path,content}))}
  if(!user)return redirect(res,'/login?return='+encodeURIComponent(path+url.search));
  const roles=pageRole(path);if(roles&&!roles.includes(user.role))return html(res,403,'<section class="notice error">Access denied</section>');
  let title='',content='',tv=false;
  if(path==='/tv/management'){title='Management · Go-live readiness';tv=true;content=views.management(summary(),participantTvSummary(user,'AGENT'),participantTvSummary(user,'BRANCH'))}
  else if(path==='/tv/agents'){if(user.role==='BRANCH')return redirect(res,'/tv/branches');const data=participantTvSummary(user,'AGENT');if(!data)return html(res,403,'<section class="notice error">Access denied</section>');title='Agent TV · Testing progress';tv=true;content=views.participantTv('AGENT',data,user.role==='AGENT')}
  else if(path==='/tv/branches'){if(user.role==='AGENT')return redirect(res,'/tv/agents');const data=participantTvSummary(user,'BRANCH');if(!data)return html(res,403,'<section class="notice error">Access denied</section>');title='Branch TV · Testing progress';tv=true;content=views.participantTv('BRANCH',data,user.role==='BRANCH')}
  else if(path==='/my-agent'){title='My Agent';content='<div id="my-agent-app" aria-live="polite"></div><script src="/my-agent.js?v='+MY_AGENT_CLIENT_VERSION+'" defer></script>'}
  else if(path==='/my-tests'){title='My assigned test cases';content=views.myTests(assignmentsData(user,url),user,cleanText(url.searchParams.get('channel')),user.role==='OBSERVER'?url.searchParams.get('participantId')||url.searchParams.get('participant')||'':'')}
  else if(path==='/qa'){title='QA & technical workspace';content=views.qa(defectData(url,user),submissionsData(url,user),user,cleanText(url.searchParams.get('channel')))}
  else if(path==='/observer'){title='Observer tester management';content=views.observer(observerTesters(user),observerAssignments(user,url),user,url.searchParams)}
  else if(path==='/admin'){title='Administration';content=views.admin(adminData(url),user)}
  else return html(res,404,'Not found');
  return html(res,200,fragment?content:views.document({title,user,path:path+url.search,content,tv,demo:DEMO_MODE}));
}
async function parseForm(req,limit=12*1024*1024){
  if(String(req.headers['content-type']||'').includes('application/x-www-form-urlencoded')&&req.body&&typeof req.body==='object'&&!Buffer.isBuffer(req.body))return req.body;
  const raw=await readBody(req,limit),type=String(req.headers['content-type']||''),result={};
  if(type.includes('multipart/form-data')){const request=new Request(BASE_URL+req.url,{method:'POST',headers:{'content-type':type},body:raw}),form=await request.formData();for(const [key,value] of form){if(Object.hasOwn(result,key))result[key]=[].concat(result[key],value);else result[key]=value}return result}
  for(const [key,value] of new URLSearchParams(raw.toString())){if(Object.hasOwn(result,key))result[key]=[].concat(result[key],value);else result[key]=value}return result;
}
async function proxyApi(req,apiPath,method,payload,contentType='application/json',csrfToken=''){
  const {Readable}=require('node:stream');
  let raw=payload;if(contentType==='application/json'){const copy={...payload};delete copy._csrf;raw=JSON.stringify(copy)}
  const inner=Readable.from([Buffer.isBuffer(raw)?raw:Buffer.from(raw||'')]);
  inner.method=method;inner.url=apiPath;inner.headers={cookie:req.headers.cookie||'','x-csrf-token':String(csrfToken||payload?._csrf||''),'content-type':contentType};
  const headers=new Headers();let status=200,output='';
  const response={setHeader(key,value){headers.set(key,value)},writeHead(code,values={}){status=code;for(const [key,value]of Object.entries(values))headers.set(key,value)},end(value){output+=value||''}};
  await api(inner,response,new URL(apiPath,BASE_URL));
  return {ok:status>=200&&status<300,status,headers,json:async()=>JSON.parse(output||'{}')};
}
function actionDestination(path){if(path.endsWith('/remove'))return '/admin';if(path.startsWith('/actions/observer/'))return '/observer';if(path.includes('/review')||path.startsWith('/actions/defects/'))return '/qa';if(path.startsWith('/actions/assignments/')&&!path.endsWith('/bulk'))return '/my-tests';return '/admin'}
function actionReturn(form,path){
 const destination=actionDestination(path);
 if(typeof form._returnTo!=='string')return destination;
 try{const target=new URL(form._returnTo,BASE_URL);if(target.origin===new URL(BASE_URL).origin&&target.pathname===destination)return target.pathname+target.search}catch{}
 return destination;
}
function serverHome(user){return user?.role==='ADMIN'?'/admin':['AGENT','BRANCH','OBSERVER'].includes(user?.role)?'/my-tests':user?.role==='TECH'?'/qa':'/tv/management'}
async function actions(req,res,url){
  const form=await parseForm(req),hx=req.headers['hx-request']==='true';
  if(url.pathname==='/actions/login'){
    const response=await proxyApi(req,'/api/login','POST',form),data=await response.json();if(!response.ok){const message='<p class="notice error">'+views.esc(data.error)+'</p>';return html(res,response.status,hx?message:views.document({title:'Sign in',path:'/login',content:views.login(message)}))}
    const target=['AGENT','BRANCH','OBSERVER'].includes(data.user.role)?'/my-tests':['MANAGER','DISPLAY'].includes(data.user.role)?'/tv/management':['QA_LEAD','TECH'].includes(data.user.role)?'/qa':data.user.role==='ADMIN'?'/admin':'/my-tests',headers={'Set-Cookie':response.headers.get('set-cookie')};if(hx)return html(res,204,'',{...headers,'HX-Redirect':target});res.writeHead(303,{...headers,Location:target});return res.end();
  }
  if(url.pathname==='/actions/logout'){const response=await proxyApi(req,'/api/logout','POST',form);const headers={'Set-Cookie':response.headers.get('set-cookie')||''};if(hx)return html(res,204,'',{...headers,'HX-Redirect':'/login'});res.writeHead(303,{...headers,Location:'/login'});return res.end()}
  let apiPath='',method='POST',payload=form,contentType='application/json';
  if(url.pathname==='/actions/observer/link')apiPath='/api/observer/testers';
  else if(url.pathname.match(/^\/actions\/observer\/testers\/\d+\/unlink$/)){if(form.confirmed!=='1')return html(res,400,'<section class="notice error">Confirm tester unlink first.</section>');apiPath='/api/observer/testers/'+url.pathname.split('/')[4];method='DELETE'}
  else if(url.pathname==='/actions/participants')apiPath='/api/participants';
  else if(url.pathname==='/actions/users')apiPath='/api/users';
  else if(url.pathname.match(/^\/actions\/users\/\d+\/active$/)){apiPath='/api/users/'+url.pathname.split('/')[3]+'/active';method='PUT';payload={...form,active:form.active==='1'}}
  else if(url.pathname==='/actions/import-production'){if(!form.workbook||typeof form.workbook.arrayBuffer!=='function'||!String(form.workbook.name).toLowerCase().endsWith('.xlsx'))return html(res,400,'<section class="notice error">Select an .xlsx production workbook.</section>');apiPath='/api/test-cases/import-production?channel='+encodeURIComponent(form.channel||'');payload=Buffer.from(await form.workbook.arrayBuffer());contentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
  else if(url.pathname==='/actions/import-xlsx'){apiPath='/api/test-cases/import-xlsx';payload=Buffer.from(await form.workbook.arrayBuffer());contentType='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}
  else if(url.pathname==='/actions/assignments/bulk'){apiPath='/api/test-cases/assignments';method='PUT';payload={...form,caseIds:[].concat(form.caseIds||[]).map(Number)}}
  else if(url.pathname.match(/^\/actions\/test-cases\/\d+\/assignment$/)){apiPath='/api/test-cases/'+url.pathname.split('/')[3]+'/assignment';method='PUT'}
  else if(url.pathname.match(/^\/actions\/assignments\/\d+\/start$/)){apiPath='/api/assignments/'+url.pathname.split('/')[3]+'/status';method='PUT';payload={...form,status:'IN_PROGRESS'}}
  else if(url.pathname.match(/^\/actions\/assignments\/\d+\/submit$/)){apiPath='/api/assignments/'+url.pathname.split('/')[3]+'/status';method='PUT';payload={...form,status:'PENDING_QA'}}
  else if(url.pathname.match(/^\/actions\/assignments\/\d+\/remove$/)){apiPath='/api/assignments/'+url.pathname.split('/')[3];method='DELETE'}
  else if(url.pathname.match(/^\/actions\/assignments\/\d+\/review$/)){apiPath='/api/assignments/'+url.pathname.split('/')[3]+'/qa-review';method='PUT'}
  else if(url.pathname.match(/^\/actions\/defects\/\d+$/)){apiPath='/api/defects/'+url.pathname.split('/')[3]+'/status';method='PUT'}
  else return html(res,404,'<section class="notice error">Action not found</section>');
  const response=await proxyApi(req,apiPath,method,payload,contentType,form._csrf),data=await response.json().catch(()=>({}));
  if(!response.ok){const content='<section class="notice error"><b>'+views.esc(data.error||'Request failed')+'</b>'+((data.errors||[]).map(x=>'<p>'+views.esc((x.sheet?x.sheet+' ':'')+(x.row?'row '+x.row+' ':'')+(x.field||'')+': '+x.message)+'</p>').join(''))+'</section>';return html(res,response.status,hx?content:views.document({title:'Request error',user:auth(req),path:actionDestination(url.pathname),content}))}
  let target=url.pathname==='/actions/import-production'?'/admin?channel='+encodeURIComponent(data.channel):actionReturn(form,url.pathname);if(url.pathname==='/actions/participants'){const destination=new URL(target,BASE_URL);destination.searchParams.set('createdParticipant',String(data.id));target=destination.pathname+destination.search}if(hx)return html(res,204,'',{'HX-Redirect':target});return redirect(res,target);
}

function file(res,filePath,type='text/html',req){fs.readFile(filePath,(error,data)=>{if(error){res.writeHead(404);return res.end('Not found')}const cacheable=type!=='text/html',headers={'Content-Type':type,'Cache-Control':cacheable?'public, max-age='+(type.startsWith('image/')?'86400':'300')+', must-revalidate':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'"};if(cacheable){headers.ETag='"'+crypto.createHash('sha256').update(data).digest('hex')+'"';if(String(req?.headers['if-none-match']||'').split(',').some(value=>value.trim().replace(/^W\//,'')===headers.ETag)){res.writeHead(304,headers);return res.end()}}res.writeHead(200,headers);res.end(data)})}
const routes={'/my-agent':'index.html','/observer':'index.html','/':'index.html','/login':'index.html','/app':'index.html','/admin':'index.html','/qa':'index.html','/my-tests':'index.html','/tv/management':'index.html','/tv/agents':'index.html','/tv/branches':'index.html','/scan':'index.html'};
const staticAssets=Object.freeze({'/my-agent.js':['my-agent.js','text/javascript; charset=utf-8'],'/request-loading.js':['request-loading.js','text/javascript; charset=utf-8'],'/case-ui.js':['case-ui.js','text/javascript; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/htmx-client.js':['htmx-client.js','text/javascript; charset=utf-8'],'/vendor/htmx-2.0.10.min.js':['vendor/htmx-2.0.10.min.js','text/javascript; charset=utf-8'],'/vendor/htmx-ext-sse-2.2.4.js':['vendor/htmx-ext-sse-2.2.4.js','text/javascript; charset=utf-8'],'/vendor/htmx-ext-response-targets-2.0.4.js':['vendor/htmx-ext-response-targets-2.0.4.js','text/javascript; charset=utf-8'],'/style.css':['style.css','text/css; charset=utf-8'],'/brand.css':['brand.css','text/css; charset=utf-8'],'/wing-logo.svg':['wing-logo.svg','image/svg+xml'],'/brand-background.png':['brand-background.png','image/png'],'/brand-background.jpg':['brand-background.jpg','image/jpeg'],'/brand-background.webp':['brand-background.webp','image/webp'],'/brand-background.svg':['brand-background.svg','image/svg+xml']});
const requestHandler=async(req,res)=>{try{refreshSessions();const url=new URL(req.url,BASE_URL);if(url.pathname.startsWith('/api/'))return await api(req,res,url);if(url.pathname.startsWith('/actions/')&&req.method==='POST')return await actions(req,res,url);if(url.pathname==='/scan'){const id=verifyQr(url.searchParams.get('token')||''),participant=id&&db.prepare('SELECT id,code,name,type FROM participants WHERE id=? AND active=1').get(id);if(!participant){res.writeHead(403);return res.end('QR code is invalid, expired or inactive')}const sid=crypto.randomBytes(32).toString('base64url'),session={id:'participant:'+participant.id,username:'qr:'+participant.code,role:participant.type,name:participant.name,participantId:participant.id,participantCode:participant.code,csrf:crypto.randomBytes(20).toString('hex'),exp:Date.now()+28800000};const key=sessionKey(sid,session);if(!DEMO_MODE)sessions.set(key,session);res.setHeader('Set-Cookie',`ptc_session=${key}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${COOKIE_SECURE?'; Secure':''}`);if(FRONTEND_MODE==='htmx'){const target=new URL('/my-tests',BASE_URL),content=views.myTests(assignmentsData(session,target),session,'');return html(res,200,views.document({title:'My assigned test cases',user:session,path:'/my-tests',content}))}}if(FRONTEND_MODE==='htmx'&&(url.pathname==='/'||url.pathname==='/app')){const user=auth(req);return redirect(res,user?serverHome(user):'/login')}if(url.pathname==='/my-agent')return renderHtmxPage(req,res,url);if(FRONTEND_MODE==='htmx'&&routes[url.pathname]&&url.pathname!=='/scan')return renderHtmxPage(req,res,url);if(FRONTEND_MODE!=='htmx'&&routes[url.pathname]&&!['/','/app','/login','/scan'].includes(url.pathname)){const user=auth(req);if(!user)return redirect(res,'/login?return='+encodeURIComponent(url.pathname+url.search));const roles=pageRole(url.pathname);if(roles&&!roles.includes(user.role))return html(res,403,'<section class="notice error">Access denied</section>')}if(routes[url.pathname])return file(res,path.join(PUBLIC,routes[url.pathname]));if(Object.hasOwn(staticAssets,url.pathname)){const [name,type]=staticAssets[url.pathname];return file(res,path.join(PUBLIC,name),type,req)}res.writeHead(404);res.end('Not found')}catch(error){if(!error.status)console.error(error);if(!res.headersSent){if(String(req.headers.accept||'').includes('text/html'))html(res,error.status||500,'<section class="notice error">'+views.esc(error.status?error.message:'Internal server error')+'</section>');else json(res,error.status||500,{error:error.status?error.message:'Internal server error'})}}};
const server=http.createServer(requestHandler);
if(!SERVERLESS)server.listen(PORT,HOST,()=>console.log('Production Test Center listening on '+BASE_URL));
module.exports={requestHandler,server,db,cleanText,statusValue,normalizeProductionStatus,PRODUCTION_STATUSES,WORKFLOW_STATES,parseWorkbook,summary,signedQr};
