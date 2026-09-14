'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const {openDatabase}=require('../lib/database');
assert.throws(()=>openDatabase({env:{SERVERLESS:'true'},localPath:':memory:'}),/TURSO_DATABASE_URL/);
assert.throws(()=>openDatabase({env:{TURSO_DATABASE_URL:'libsql://test.turso.io'},localPath:':memory:'}),/TURSO_AUTH_TOKEN/);
assert.throws(()=>openDatabase({env:{TURSO_DATABASE_URL:'file:private.db',TURSO_AUTH_TOKEN:'test'},localPath:':memory:'}),/libsql.*https/);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'shared-database-')),file=path.join(dir,'shared.db');
// Local backing fixture needs its own lock wait; hosted Turso manages concurrency itself.
// Reject Cloud-unsupported PRAGMAs at production boundary while exercising real SQL otherwise.
const prefix=`process.env.SERVERLESS='true';process.env.DEMO_MODE='true';process.env.APP_SECRET='shared-test-secret';process.env.TURSO_DATABASE_URL='libsql://fixture.turso.io';process.env.TURSO_AUTH_TOKEN='fixture';const Real=require('libsql');require.cache[require.resolve('libsql')].exports=class extends Real{constructor(url,options){super(${JSON.stringify(file)},{timeout:30});Real.prototype.exec.call(this,'PRAGMA busy_timeout=30000')}exec(sql){if(/PRAGMA\\s+(busy_timeout|journal_mode)/i.test(sql))throw Error('Sqlite3UnsupportedStatement');return super.exec(sql)}};`;
function worker(code){const r=spawnSync(process.execPath,['-e',prefix+code],{cwd:path.join(__dirname,'..'),encoding:'utf8'});assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout)}
const requestCode=`const {Readable,Writable}=require('node:stream');const {requestHandler,db}=require('./server');function request(url,body,cookie='',csrf=''){return new Promise((resolve,reject)=>{const req=Readable.from([Buffer.from(JSON.stringify(body||{}))]);req.url=url;req.method=body?'POST':'GET';req.headers={'content-type':'application/json',cookie,'x-csrf-token':csrf};const chunks=[],headers={};const res=new Writable({write(c,e,done){chunks.push(Buffer.from(c));done()}});res.setHeader=(k,v)=>headers[k.toLowerCase()]=v;res.writeHead=(s,h={})=>{res.statusCode=s;Object.entries(h).forEach(([k,v])=>res.setHeader(k,v))};res.on('finish',()=>resolve({status:res.statusCode,headers,body:JSON.parse(Buffer.concat(chunks).toString())}));requestHandler(req,res).catch(reject)})}`;
try{
 const coldPrefix=prefix.replace(JSON.stringify(file),JSON.stringify(path.join(dir,'concurrent.db')));
 const concurrent=spawnSync(process.execPath,['-e',`const {spawn}=require('node:child_process');Promise.all(Array.from({length:4},()=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,['-e',${JSON.stringify(coldPrefix+"const {db}=require('./server');db.close()") }]);let error='';child.stderr.on('data',chunk=>error+=chunk);child.on('exit',code=>code?reject(Error(error)):resolve())}))).catch(error=>{console.error(error);process.exitCode=1})`],{cwd:path.join(__dirname,'..'),encoding:'utf8'});assert.equal(concurrent.status,0,concurrent.stderr);
 const created=worker(requestCode+`;(async()=>{const admin=await request('/api/login',{username:'admin',password:'Admin@123'});const r=await request('/api/users',{username:'shared-observer',password:'Observer-test',displayName:'Shared Observer',role:'OBSERVER'},admin.headers['set-cookie'].split(';')[0],admin.body.user.csrf);db.close();console.log(JSON.stringify(r))})()`);assert.equal(created.status,201);

 const login=worker(requestCode+`;(async()=>{const r=await request('/api/login',{username:'shared-observer',password:'Observer-test'});db.close();console.log(JSON.stringify(r))})()`);assert.equal(login.status,200);const cookie=login.headers['set-cookie'].split(';')[0];
 const next=worker(requestCode+`; (async()=>{const r=await request('/api/me',null,${JSON.stringify(cookie)});db.close();console.log(JSON.stringify(r))})()`);assert.equal(next.status,200);assert.equal(next.body.user.role,'OBSERVER');
 const db=new (require('libsql'))(file);assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n,2);db.close();
 console.log('PASS: shared driver SQL compatibility, Observer login/session across processes, fail-closed configuration');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
