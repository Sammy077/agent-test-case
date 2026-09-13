'use strict';
const fs=require('node:fs'),path=require('node:path');
function openDatabase({env=process.env,localPath}){
 const url=env.TURSO_DATABASE_URL,token=env.TURSO_AUTH_TOKEN;
 if(url||token){
  if(!url)throw Error('Set TURSO_DATABASE_URL for shared storage');
  if(!token)throw Error('Set TURSO_AUTH_TOKEN for shared storage');
  if(!/^(libsql|https):\/\/[^\s/]+/.test(url))throw Error('TURSO_DATABASE_URL must use libsql:// or https://');
  const Database=require('libsql');
  return {db:new Database(url,{authToken:token,timeout:30}),shared:true};
 }
 const testMemory=env.NODE_ENV==='test'&&env.VERCEL!=='1';
 if((env.SERVERLESS==='true'||env.VERCEL==='1')&&!testMemory)throw Error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before deploying; in-memory storage cannot preserve accounts');
 if(localPath!==':memory:')fs.mkdirSync(path.dirname(localPath),{recursive:true});
 return {db:new (require('node:sqlite').DatabaseSync)(localPath),shared:false};
}
module.exports={openDatabase};
