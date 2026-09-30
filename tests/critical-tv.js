'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
Object.assign(process.env,{SERVERLESS:'true',NODE_ENV:'test',DB_FILE:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ptc-critical-tv-')),'test.db'),DEMO_MODE:'false'});
const {server,db}=require('../server');
const crypto=require('node:crypto');
const workbook=require('./fixtures/master-critical').buildFixture();
let base;
const hash=password=>crypto.pbkdf2Sync(password,'ptc-v1',120000,32,'sha256').toString('hex');
const signIn=async(username,password)=>{const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});const body=await response.json();return {cookie:response.headers.get('set-cookie').split(';')[0],csrf:body.user.csrf,user:body.user}};
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 for(const [username,password,role] of [['manager1','Manager@123','MANAGER'],['display1','Display@123','DISPLAY'],['qa1','Qa@12345','QA_LEAD']])db.prepare('INSERT INTO users(username,password_hash,role,display_name) VALUES(?,?,?,?)').run(username,hash(password),role,username);
 db.prepare("INSERT INTO participants(code,name,type) VALUES('A01','Agent One','AGENT'),('B01','Branch One','BRANCH')").run();
 db.prepare("INSERT INTO users(username,password_hash,role,display_name,participant_id) VALUES('agent1',?,'AGENT','Agent One',(SELECT id FROM participants WHERE code='A01'))").run(hash('Agent@123'));
 db.prepare("INSERT INTO users(username,password_hash,role,display_name,participant_id) VALUES('branch1',?,'BRANCH','Branch One',(SELECT id FROM participants WHERE code='B01'))").run(hash('Branch@123'));
 const admin=await signIn('admin','Admin@123');
 const imported=await fetch(base+'/api/critical-dashboard/import',{method:'POST',headers:{Cookie:admin.cookie,'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','X-CSRF-Token':admin.csrf},body:workbook});
 assert.equal(imported.status,200);

 const page=await (await fetch(base+'/tv/critical',{headers:{Cookie:admin.cookie}})).text();
 assert.match(page,/Unified Core Testing Dashboard/);
 assert.match(page,/MANAGEMENT TV · CRITICAL TEST ONLY/);
 assert.match(page,/ALL TID COMPLETE/);
 assert.match(page,/Critical Test Cases per Tester/);
 assert.match(page,/No Perform TXN/);
 assert.match(page,/Det Dam/);
 assert.match(page,/href="\/tv\/critical"[^>]*aria-current="page"/,'the tab marks itself current');
 assert.match(page,/href="\/tv\/management"/,'other TV tabs remain');
 assert.doesNotMatch(page,/style="/,'CSP forbids inline style attributes');
 assert.match(page,/data-clock="time"/);

 for(const [username,password] of [['manager1','Manager@123'],['display1','Display@123'],['qa1','Qa@12345']]){const session=await signIn(username,password);assert.equal((await fetch(base+'/tv/critical',{headers:{Cookie:session.cookie}})).status,200,username+' may read the Critical TV');}
 for(const [username,password] of [['agent1','Agent@123'],['branch1','Branch@123']]){const session=await signIn(username,password);assert.equal((await fetch(base+'/tv/critical',{headers:{Cookie:session.cookie}})).status,403,username+' is refused');}
 assert.equal((await fetch(base+'/tv/critical',{redirect:'manual'})).status,303,'signed-out users are redirected to login');

 const management=await (await fetch(base+'/tv/management',{headers:{Cookie:admin.cookie}})).text();
 assert.match(management,/Channel QA \/ result overview/,'existing Management TV is unchanged');
 assert.doesNotMatch(management,/Unified Core Testing Dashboard/);
 assert.match(management,/href="\/tv\/critical"/,'Management TV links to the new tab');

 db.exec('DELETE FROM critical_cases');
 const blank=await (await fetch(base+'/tv/critical',{headers:{Cookie:admin.cookie}})).text();
 assert.match(blank,/No Critical test cases found\./);
 console.log('PASS: Critical TV renders the reference layout, enforces TV roles, keeps Management TV intact and handles an empty dataset');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await new Promise(resolve=>server.close(resolve));db.close()});
