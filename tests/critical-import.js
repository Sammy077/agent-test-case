'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
Object.assign(process.env,{SERVERLESS:'true',NODE_ENV:'test',DB_FILE:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ptc-critical-import-')),'test.db'),DEMO_MODE:'false'});
const {server,db}=require('../server');
let base,cookie,csrf,crypto;
const workbook=()=>require('./fixtures/master-critical').buildFixture();
async function upload(token=csrf,type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'){const response=await fetch(base+'/api/critical-dashboard/import',{method:'POST',headers:{Cookie:cookie||'','Content-Type':type,'X-CSRF-Token':token||''},body:workbook()});return {status:response.status,data:await response.json()}}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 crypto=require('node:crypto');
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'Admin@123'})});cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).user.csrf;

 assert.equal((await upload()).status,200,'Admin can import the Master workbook');
 const stored=db.prepare('SELECT COUNT(*) n FROM critical_cases').get().n;
 assert.equal(stored,4);
 assert.equal((await upload()).status,200,'re-import replaces the previous upload');
 assert.equal(db.prepare('SELECT COUNT(*) n FROM critical_cases').get().n,4,'no duplicate rows');
 assert.equal((await upload('wrong')).status,403,'CSRF is enforced');
 assert.equal((await upload(csrf,'application/json')).status,415,'only .xlsx payloads are accepted');

 const dashboard=await fetch(base+'/api/critical-dashboard',{headers:{Cookie:cookie}});
 assert.equal(dashboard.status,200);
 const payload=await dashboard.json();
 assert.equal(payload.metrics.total,4);
 assert.equal(payload.metrics.missing_tid,2);

 const manager=crypto.pbkdf2Sync('Manager@123','ptc-v1',120000,32,'sha256').toString('hex');
 db.prepare("INSERT INTO users(username,password_hash,role,display_name) VALUES('manager1',?,'MANAGER','Manager')").run(manager);
 const agent=crypto.pbkdf2Sync('Agent@123','ptc-v1',120000,32,'sha256').toString('hex');
 db.prepare("INSERT INTO users(username,password_hash,role,display_name) VALUES('agent1',?,'AGENT','Agent')").run(agent);
 db.prepare("INSERT INTO participants(code,name,type) VALUES('A01','Agent One','AGENT')").run();
 const signIn=async(username,password)=>{const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const body=await response.json();return {cookie:response.headers.get('set-cookie').split(';')[0],csrf:body.user.csrf}};
 const asManager=await signIn('manager1','Manager@123'),asAgent=await signIn('agent1','Agent@123');
 assert.equal((await fetch(base+'/api/critical-dashboard',{headers:{Cookie:asManager.cookie}})).status,200,'Manager can read the dashboard');
 assert.equal((await fetch(base+'/api/critical-dashboard',{headers:{Cookie:asAgent.cookie}})).status,403,'Agent cannot read the dashboard');
 const denied=await fetch(base+'/api/critical-dashboard/import',{method:'POST',headers:{Cookie:asManager.cookie,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','X-CSRF-Token':asManager.csrf},body:workbook()});
 assert.equal(denied.status,403,'Manager cannot import');
 assert.equal((await upload(csrf)).status,200);

 // Administration form -> multipart action -> API.
 const form=new FormData();
 form.set('_csrf',csrf);form.set('workbook',new Blob([workbook()],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}),'master.xlsx');
 const action=await fetch(base+'/actions/import-critical',{method:'POST',headers:{Cookie:cookie,'HX-Request':'true'},body:form});
 assert.equal(action.status,204);
 assert.equal(action.headers.get('hx-redirect'),'/admin');
 assert.equal((await fetch(base+'/actions/import-critical',{method:'POST',headers:{Cookie:cookie,'HX-Request':'true'},body:new FormData()})).status,400,'a missing workbook is rejected');
 const page=await (await fetch(base+'/admin',{headers:{Cookie:cookie}})).text();
 assert.match(page,/Import Critical Test workbook/,'Administration shows the upload card');
 assert.match(page,/href="\/tv\/critical"/,'Administration links to the TV screen');
 const after=await (await fetch(base+'/api/critical-dashboard',{headers:{Cookie:cookie}})).json();
 assert.equal(after.source.file_name,'master.xlsx','the uploaded file name is recorded');
 console.log('PASS: critical dashboard upload, replacement, CSRF, role access, no-JS/multipart action and Administration entry point');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await new Promise(resolve=>server.close(resolve));db.close()});
