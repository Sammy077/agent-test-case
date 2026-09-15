'use strict';
const assert=require('node:assert/strict');
Object.assign(process.env,{SERVERLESS:'true',NODE_ENV:'test',DB_FILE:':memory:',DEMO_MODE:'false'});
const {server,db}=require('../server');
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'Admin@123'})}),cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).user.csrf;
 const create=await fetch(base+'/actions/participants',{method:'POST',redirect:'manual',headers:{Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded','HX-Request':'true'},body:new URLSearchParams({_csrf:csrf,code:'A01',name:'Created Agent',type:'AGENT'})});assert.equal(create.status,204);
 const page=await (await fetch(base+create.headers.get('hx-redirect'),{headers:{Cookie:cookie}})).text();assert.match(page,/Participant created/,'creation needs visible success feedback');assert.match(page,/Participants/);assert.match(page,/A01/);assert.match(page,/Created Agent/);
 const duplicate=await fetch(base+'/actions/participants',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/x-www-form-urlencoded','HX-Request':'true'},body:new URLSearchParams({_csrf:csrf,code:'A01',name:'Duplicate',type:'AGENT'})});assert.equal(duplicate.status,409);assert.match(await duplicate.text(),/already exists/);
 const agents=await (await fetch(base+'/api/my-agent',{headers:{Cookie:cookie}})).json();assert.equal(agents.agents[0].code,'A01');
 console.log('PASS: Admin Create feedback, participant listing, duplicate error, My Agent visibility');
})().catch(error=>{console.error(error);process.exitCode=1}).finally(async()=>{await new Promise(resolve=>server.close(resolve));db.close()});
