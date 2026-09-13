'use strict';
process.env.APP_SECRET='demo-test-secret';
const assert=require('node:assert/strict');
const {Readable,Writable}=require('node:stream');
const handler=require('../api/demo');
function request(url,method='GET',body='',cookie='',parsedBody){
 return new Promise((resolve,reject)=>{
  const req=Readable.from([Buffer.from(body)]);req.url=url;req.method=method;if(parsedBody!==undefined)req.body=parsedBody;req.headers={cookie,'content-type':'application/x-www-form-urlencoded'};
  const chunks=[],headers={};const res=new Writable({write(chunk,encoding,done){chunks.push(Buffer.from(chunk));done()}});
  res.setHeader=(key,value)=>headers[key.toLowerCase()]=value;res.writeHead=(status,values={})=>{res.statusCode=status;for(const [key,value]of Object.entries(values))res.setHeader(key,value)};
  res.on('finish',()=>resolve({status:res.statusCode,headers,body:Buffer.concat(chunks).toString()}));res.on('error',reject);Promise.resolve(handler(req,res)).catch(reject);
 });
}
(async()=>{
 let parsedLogin=await request('/actions/login','POST','','',{username:'admin',password:'Admin@123'});assert.equal(parsedLogin.status,303,'Vercel parsed form login');
 const production=require('../server');assert.equal(production.server.listening,false);assert.equal(production.db.prepare('SELECT COUNT(*) n FROM test_cases').get().n,0);
 assert.equal(production.db.prepare('SELECT COUNT(*) n FROM users').get().n,1);
 assert.equal(production.db.prepare('SELECT COUNT(*) n FROM participants').get().n,0);
 const crypto=require('node:crypto');
 for(const [name,password,role]of [['observer01','Observer@123','OBSERVER'],['manager01','Manager@123','MANAGER']])production.db.prepare('INSERT INTO users(username,password_hash,role,display_name) VALUES(?,?,?,?)').run(name,crypto.pbkdf2Sync(password,'ptc-v1',120000,32,'sha256').toString('hex'),role,name);
 production.db.prepare("INSERT INTO participants(code,name,type) VALUES('A01','Fixture Agent','AGENT'),('B01','Fixture Branch','BRANCH')").run();
 production.db.prepare("INSERT INTO observer_participants SELECT id,1,CURRENT_TIMESTAMP FROM users WHERE username='observer01'").run();
 let r=await request('/actions/login','POST','username=observer01&password=Observer%40123');assert.equal(r.status,303);const cookie=r.headers['set-cookie'].split(';')[0];assert.match(cookie,/ptc_session=/);
 r=await request('/observer','GET','',cookie);assert.equal(r.status,200);assert.match(r.body,/A01/);assert.match(r.body,/DEMO/);
 for(const tv of ['management','agents','branches','technical']){const screen=await request('/tv/'+tv,'GET','',cookie);assert.equal(screen.status,200);assert.match(screen.body,/Technical TV/);if(tv==='management'){assert.match(screen.body,/>Passed</);assert.doesNotMatch(screen.body,/>Completed</)}}
 for(const api of ['/api/dashboard','/api/tv/participants?type=AGENT','/api/tv/participants?type=BRANCH','/api/tv/technical'])assert.equal((await request(api,'GET','',cookie)).status,200);
 r=await request('/api/events','GET','',cookie);assert.equal(r.status,204);
 r=await request('/api/me','GET','',cookie);assert.equal(r.status,200);const session=JSON.parse(r.body).user;
 r=await request('/actions/observer/link','POST','participantId=2&_csrf='+encodeURIComponent(session.csrf),cookie);assert.equal(r.status,303);assert.equal(production.db.prepare('SELECT observer_user_id FROM observer_participants WHERE participant_id=2').get().observer_user_id,session.id);
 r=await request('/api/me','GET','',cookie+'tampered');assert.equal(r.status,401);
 assert.equal(production.db.prepare('PRAGMA database_list').get().file,'');
 r=await request('/style.css');assert.equal(r.status,200);
 r=await request('/actions/login','POST','username=manager01&password=Manager%40123');assert.equal(r.status,303);r=await request('/tv/management','GET','',r.headers['set-cookie'].split(';')[0]);assert.equal(r.status,200);assert.match(r.body,/hx-trigger="every 10s"/);assert.doesNotMatch(r.body,/sse-connect=/);
 r=await request('/actions/login','POST','username=admin&password=Admin%40123');assert.equal(r.status,303);
 console.log('PASS: Vercel empty startup, explicit fixtures, port-free handler, form login, Observer page, static assets, finite events');production.db.close();
})().catch(error=>{console.error(error);process.exitCode=1});
