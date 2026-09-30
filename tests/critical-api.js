'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
Object.assign(process.env,{SERVERLESS:'true',NODE_ENV:'test',DB_FILE:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ptc-critical-api-')),'test.db'),DEMO_MODE:'false'});
const {server,db}=require('../server');
let base,cookie;
const hash=password=>crypto.pbkdf2Sync(password,'ptc-v1',120000,32,'sha256').toString('hex');
const signIn=async(username,password)=>{const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const body=await response.json();return {cookie:response.headers.get('set-cookie').split(';')[0],csrf:body.user.csrf}};
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'Admin@123'})});cookie=login.headers.get('set-cookie').split(';')[0];

 const payload=await (await fetch(base+'/api/critical-dashboard',{headers:{Cookie:cookie}})).json();
 assert.equal(payload.metrics.total,114,'the Critical dashboard is the static reference dataset');
 assert.equal(payload.metrics.pos,38);
 assert.equal(payload.metrics.ekyc,46);
 assert.equal(payload.metrics.other_channel,30);
 assert.equal(payload.metrics.not_executed,74);
 assert.equal(payload.metrics.missing_tid,47);
 assert.equal(payload.metrics.tid_completion_pct,58.8);
 assert.equal(payload.metrics.finance_pending,47);
 assert.deepEqual(payload.channels,[{name:'POS',value:38},{name:'eKYC',value:46},{name:'Others',value:30}]);
 assert.equal(payload.finance.length,5);
 assert.equal(payload.testers.length,13);
 assert.equal(payload.testers[0].name,'Koemly Hort');

 const status=async method=>{const response=await fetch(base+'/api/critical-dashboard',{method,headers:{Cookie:cookie}});return response.status};
 assert.equal(await status('GET'),200);

 // The workbook upload path has been retired; the screen and the API carry no upload state.
 assert.equal((await fetch(base+'/api/critical-dashboard/import',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'},body:Buffer.from('not a workbook')})).status,404,'the Critical upload endpoint is retired');
 const page=await (await fetch(base+'/admin',{headers:{Cookie:cookie}})).text();
 assert.doesNotMatch(page,/Import Critical Test workbook/,'the Administration upload card is retired');

 db.prepare("INSERT INTO users(username,password_hash,role,display_name) VALUES('manager1',?,'MANAGER','Manager')").run(hash('Manager@123'));
 db.prepare("INSERT INTO participants(code,name,type) VALUES('A01','Agent One','AGENT')").run();
 db.prepare("INSERT INTO users(username,password_hash,role,display_name,participant_id) VALUES('agent1',?,'AGENT','Agent One',(SELECT id FROM participants WHERE code='A01'))").run(hash('Agent@123'));
 const asManager=await signIn('manager1','Manager@123'),asAgent=await signIn('agent1','Agent@123');
 assert.equal((await fetch(base+'/api/critical-dashboard',{headers:{Cookie:asManager.cookie}})).status,200,'Manager can read the dashboard');
 assert.equal((await fetch(base+'/api/critical-dashboard',{headers:{Cookie:asAgent.cookie}})).status,403,'Agent cannot read the dashboard');
 assert.equal((await fetch(base+'/api/critical-dashboard')).status,401,'signed-out reads are refused');
 console.log('PASS: Critical dashboard is a static read-only screen (reference values, roles, retired upload path and Administration card)');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await new Promise(resolve=>server.close(resolve));db.close()});
