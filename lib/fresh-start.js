'use strict';
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const tables=['defects','assignments','test_cases','observer_participants','participants','users','audit_log'];
function snapshot(db){return Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT COUNT(*) n FROM '+t).get().n]))}
function resetLocalDatabase(dbPath){
 if(dbPath===':memory:'||!fs.existsSync(dbPath))throw Error('Reset requires existing local SQLite database');
 const db=new DatabaseSync(dbPath);let backup;
 try{
  db.exec('PRAGMA foreign_keys=ON; BEGIN IMMEDIATE');
  const admins=db.prepare("SELECT * FROM users WHERE role='ADMIN' ORDER BY id").all();
  if(!admins.some(u=>u.active))throw Error('Reset requires active Administrator');
  const before=snapshot(db),directory=path.join(path.dirname(dbPath),'backups');fs.mkdirSync(directory,{recursive:true});
  backup=path.join(directory,'fresh-start-'+new Date().toISOString().replace(/[:.]/g,'-')+'.db');
  // Copy committed source while write lock prevents concurrent mutations.
  const source=new DatabaseSync(dbPath);try{source.exec("VACUUM INTO '"+backup.replace(/'/g,"''")+"'")}finally{source.close()}
  const copy=new DatabaseSync(backup,{readOnly:true});try{
   if(copy.prepare('PRAGMA integrity_check').get().integrity_check!=='ok'||JSON.stringify(snapshot(copy))!==JSON.stringify(before)||JSON.stringify(copy.prepare("SELECT * FROM users WHERE role='ADMIN' ORDER BY id").all())!==JSON.stringify(admins))throw Error('Backup verification failed; reset cancelled');
  }finally{copy.close()}
  for(const table of tables.filter(t=>t!=='users'))db.exec('DELETE FROM '+table);
  db.exec("DELETE FROM users WHERE role!='ADMIN'");
  db.prepare('INSERT INTO audit_log(actor,action,entity_type,details) VALUES(?,?,?,?)').run(admins[0].username,'FRESH_START_RESET','DATABASE',JSON.stringify({backup,before}));
  db.exec('COMMIT');return {backup,before,after:snapshot(db)};
 }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}finally{db.close()}
}
module.exports={resetLocalDatabase};
