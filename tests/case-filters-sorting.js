'use strict';
// Catches scope leaks, incorrect combined filters, unsafe sort input, and sorting after pagination.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ptc-sort-'));
process.env.NODE_ENV='test';process.env.SERVERLESS='true';process.env.DB_FILE=path.join(directory,'test.db');process.env.FRONTEND_MODE='htmx';process.env.DEMO_MODE='false';
const {server,db}=require('../server');
const hash=p=>crypto.pbkdf2Sync(p,'ptc-v1',120000,32,'sha256').toString('hex');
db.prepare("INSERT INTO users(username,password_hash,role,display_name) VALUES('observer',?,'OBSERVER','Observer')").run(hash('o'));
db.prepare("INSERT INTO participants(code,name,type) VALUES('A01','Zoe','AGENT'),('A02','alice','AGENT'),('A03','','AGENT'),('A04','Hidden','AGENT')").run();
db.prepare("INSERT INTO observer_participants(observer_user_id,participant_id) SELECT u.id,p.id FROM users u JOIN participants p ON p.id<=3 WHERE u.username='observer'").run();
const insert=db.prepare('INSERT INTO test_cases(case_code,source_case_id,title,process,priority,channel,subcategory,main_feature,sub_feature,category,type) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
const rows=[['one','Z','Zulu','',4,'Zebra','Standard','Zebra','Zulu','Cash-In','QR'],['two','A','Alpha','',1,'Alpha','Gold','Alpha','Beta',null,null],['B','','Beta','',2,'Beta','','','',null,null],['four','A','Alpha','',1,'Alpha','Gold','Alpha','Beta',null,null],['five','C','Hidden','',3,'Hidden','Hidden','Hidden','Hidden',null,null]];
for(const [i,row]of rows.entries()){insert.run(...row);db.prepare('INSERT INTO assignments(test_case_id,participant_id,source_details_json) VALUES(?,?,?)').run(i+1,[1,2,3,2,4][i],JSON.stringify({master:'100',commission:'0',fee:'1.25','gold commission':'999','expected result':'Expected'}))}
let base;
async function login(username,password){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});assert.equal(r.status,200);const d=await r.json();return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:d.user.csrf}}
async function get(url,user){const r=await fetch(base+url,{headers:{Cookie:user.cookie}});return {status:r.status,data:await r.json()}}
async function ids(query,user,endpoint='/api/my-assignments'){const {status,data}=await get(endpoint+'?'+query,user);assert.equal(status,200,JSON.stringify(data));return data.items.map(x=>x.test_case_id||x.id)}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
 const observer=await login('observer','o'),admin=await login('admin','Admin@123');
 assert.deepEqual(await ids('priority=1&mainFeature=Alpha&subFeature=Beta',observer),[2,4]);
 assert.deepEqual(await ids('priority=4',observer),[1]);assert.deepEqual(await ids('mainFeature=Zebra',observer),[1]);assert.deepEqual(await ids('subFeature=Zulu',observer),[1]);
 assert.deepEqual(await ids('priority=2&mainFeature=Alpha',observer),[]);assert.deepEqual(await ids('mainFeature=Hidden',observer),[]);
 const {data}=await get('/api/my-assignments?priority=4',observer);assert.deepEqual(data.availableMainFeatures,['Alpha','Zebra']);assert.deepEqual(data.availableSubFeatures,['Beta','Zulu']);
 assert.deepEqual((await get('/api/my-assignments?participantId=2&channel=Alpha',observer)).data.availableMainFeatures,['Alpha']);
 assert.equal((await get('/api/my-assignments?participantId=4',observer)).status,403);
 const cases={caseId:[[2,4,3,1],[1,3,2,4]],channel:[[2,4,3,1],[1,3,2,4]],classification:[[2,4,1,3],[1,2,4,3]],scenario:[[2,4,3,1],[1,3,2,4]],priority:[[2,4,3,1],[1,3,2,4]],assignedUser:[[2,4,1,3],[1,2,4,3]],mainFeature:[[2,4,1,3],[1,2,4,3]],subFeature:[[2,4,1,3],[1,2,4,3]]};
 const adminCases={caseId:[[2,4,3,5,1],[1,5,3,2,4]],channel:[[2,4,3,5,1],[1,5,3,2,4]],classification:[[2,4,5,1,3],[1,5,2,4,3]],scenario:[[2,4,3,5,1],[1,5,3,2,4]],priority:[[2,4,3,5,1],[1,5,3,2,4]],assignedUser:[[2,4,5,1,3],[1,5,2,4,3]],mainFeature:[[2,4,5,1,3],[1,5,2,4,3]],subFeature:[[2,4,5,1,3],[1,5,2,4,3]]};
 for(const [key,want]of Object.entries(cases))for(const [index,direction]of ['asc','desc'].entries()){
  assert.deepEqual(await ids('sortBy='+key+'&orderBy='+direction,observer),want[index],key+direction);
  assert.deepEqual(await ids('sortBy='+key+'&orderBy='+direction,admin,'/api/test-cases'),adminCases[key][index],key+direction+' admin');
 }
 assert.deepEqual(await ids('sortBy=priority&orderBy=desc&limit=2&offset=1',admin,'/api/test-cases'),[5,3]);
 for(const query of ['sortBy=invalid','sortBy=priority&orderBy=drop','sortBy=','orderBy='])for(const endpoint of ['/api/test-cases','/api/my-assignments'])assert.equal((await get(endpoint+'?'+query,endpoint==='/api/test-cases'?admin:observer)).status,400);
 assert.equal((await get('/api/my-assignments?priority=7',observer)).status,400);
 const page=await (await fetch(base+'/my-tests?participantId=1&priority=4&sortBy=priority&orderBy=desc',{headers:{Cookie:observer.cookie}})).text();
 assert.match(page,/name="mainFeature"/);assert.match(page,/name="subFeature"/);assert.match(page,/name="sortBy"/);assert.match(page,/name="orderBy"/);assert.match(page,/Standard/);assert.doesNotMatch(page,/999/);assert.match(page,/>Commission<\/b>: 0/);
 assert.match(page,/_returnTo/);assert.match(page,/No tests match selected filters|Zulu/);
 const adminPage=await (await fetch(base+'/admin?sortBy=priority&orderBy=desc',{headers:{Cookie:admin.cookie}})).text();assert.match(adminPage,/name="sortBy"/);assert.match(adminPage,/name="orderBy"/);
 const returnTo='/my-tests?participantId=1&priority=4&sortBy=priority&orderBy=desc';
 const start=await fetch(base+'/actions/assignments/1/start',{method:'POST',redirect:'manual',headers:{Cookie:observer.cookie,'Content-Type':'application/x-www-form-urlencoded','HX-Request':'true'},body:new URLSearchParams({_csrf:observer.csrf,_returnTo:returnTo})});assert.equal(start.status,204);assert.equal(start.headers.get('hx-redirect'),returnTo);
 const adminReturn='/admin?sortBy=priority&orderBy=desc&page=2';
 const confirmation=await (await fetch(base+'/actions/test-cases/2/assignment',{method:'POST',headers:{Cookie:admin.cookie,'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({_csrf:admin.csrf,participantId:'3',_returnTo:adminReturn})})).text();assert.match(confirmation,/A · Gold/);assert.match(confirmation,/href="\/admin\?sortBy=priority&amp;orderBy=desc&amp;page=2">Cancel/);
 const assign=await fetch(base+'/actions/test-cases/2/assignment',{method:'POST',redirect:'manual',headers:{Cookie:admin.cookie,'Content-Type':'application/x-www-form-urlencoded','HX-Request':'true'},body:new URLSearchParams({_csrf:admin.csrf,participantId:'3',_returnTo:adminReturn})});assert.equal(assign.status,204);assert.equal(assign.headers.get('hx-redirect'),adminReturn);
 const external=await fetch(base+'/actions/test-cases/2/assignment',{method:'POST',redirect:'manual',headers:{Cookie:admin.cookie,'Content-Type':'application/x-www-form-urlencoded','HX-Request':'true'},body:new URLSearchParams({_csrf:admin.csrf,participantId:'2',_returnTo:'https://example.com/admin'})});assert.equal(external.status,204);assert.equal(external.headers.get('hx-redirect'),'/admin');
 console.log('PASS: Observer scope/filters, all sort fields/directions, blanks/ties, pagination, validation, rendered metadata/controls');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{await new Promise(resolve=>server.close(resolve));db.close();fs.rmSync(directory,{recursive:true,force:true})});
