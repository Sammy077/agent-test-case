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
 let parsedLogin=await request('/actions/login','POST','','',{username:'observer01',password:'Observer@123'});assert.equal(parsedLogin.status,303,'Vercel parsed form login');
 const production=require('../server');assert.equal(production.server.listening,false);assert.equal(production.db.prepare('SELECT COUNT(*) n FROM test_cases').get().n,150);
 let r=await request('/actions/login','POST','username=observer01&password=Observer%40123');assert.equal(r.status,303);const cookie=r.headers['set-cookie'].split(';')[0];assert.match(cookie,/ptc_session=/);
 r=await request('/observer','GET','',cookie);assert.equal(r.status,200);assert.match(r.body,/A01/);assert.match(r.body,/DEMO/);
 r=await request('/api/events','GET','',cookie);assert.equal(r.status,204);
 r=await request('/api/me','GET','',cookie);assert.equal(r.status,200);const session=JSON.parse(r.body).user;
 r=await request('/actions/observer/link','POST','participantId=2&_csrf='+encodeURIComponent(session.csrf),cookie);assert.equal(r.status,303);assert.equal(production.db.prepare('SELECT observer_user_id FROM observer_participants WHERE participant_id=2').get().observer_user_id,session.id);
 r=await request('/api/me','GET','',cookie+'tampered');assert.equal(r.status,401);
 assert.equal(production.db.prepare('PRAGMA database_list').get().file,'');
 r=await request('/style.css');assert.equal(r.status,200);
 r=await request('/actions/login','POST','username=manager01&password=Manager%40123');assert.equal(r.status,303);r=await request('/tv/management','GET','',r.headers['set-cookie'].split(';')[0]);assert.equal(r.status,200);assert.match(r.body,/hx-trigger="every 10s"/);assert.doesNotMatch(r.body,/sse-connect=/);
 r=await request('/actions/login','POST','username=admin&password=Admin%40123');assert.equal(r.status,303);
 console.log('PASS: Vercel demo seeds, port-free handler, form login, Observer page, static assets, finite events');production.db.close();
})().catch(error=>{console.error(error);process.exitCode=1});
