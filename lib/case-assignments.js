'use strict';
function migrateMultipleCaseUsers(db){
 const schema=()=>db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='assignments'").get().sql;
 if(/UNIQUE\s*\(\s*test_case_id\s*\)/i.test(schema())){
  db.exec('PRAGMA foreign_keys=OFF');
  try{
   db.exec('BEGIN IMMEDIATE');
   const original=schema();
   if(/UNIQUE\s*\(\s*test_case_id\s*\)/i.test(original)){
    const indexes=db.prepare("SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name='assignments' AND sql IS NOT NULL AND name<>'idx_assignments_one_agent_per_case'").all();
    db.exec(original.replace(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["`\[]?assignments["`\]]?/i,'CREATE TABLE assignments_many').replace(/UNIQUE\s*\(\s*test_case_id\s*\)/i,'UNIQUE(test_case_id,participant_id)'));
    db.exec('INSERT INTO assignments_many SELECT * FROM assignments');
    db.exec('DROP TABLE assignments');db.exec('ALTER TABLE assignments_many RENAME TO assignments');
    for(const index of indexes)db.exec(index.sql);
   }
   db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}finally{db.exec('PRAGMA foreign_keys=ON')}
 }
 db.exec('DROP INDEX IF EXISTS idx_assignments_one_agent_per_case');
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_case_user ON assignments(test_case_id,participant_id)');
 db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_assignments_unassigned_case ON assignments(test_case_id) WHERE participant_id IS NULL');
}
function addCaseUser(db,caseId,participantId,actor){
 const duplicate=db.prepare('SELECT id FROM assignments WHERE test_case_id=? AND participant_id=?').get(caseId,participantId);
 if(duplicate)return {id:duplicate.id,added:false};
 const source=db.prepare('SELECT * FROM assignments WHERE test_case_id=? ORDER BY participant_id IS NULL DESC,id LIMIT 1').get(caseId);
 if(source?.participant_id==null&&source){
  db.prepare("UPDATE assignments SET participant_id=?,workflow_state='ASSIGNED',updated_by=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(participantId,actor,source.id);
  return {id:source.id,added:true};
 }
 const result=db.prepare(`INSERT INTO assignments(test_case_id,participant_id,sequence_no,source_case_id,source_details_json,updated_by,workflow_state) VALUES(?,?,?,?,?,?,'ASSIGNED')`).run(caseId,participantId,source?.sequence_no||1,source?.source_case_id||'',source?.source_details_json||'{}',actor);
 return {id:result.lastInsertRowid,added:true};
}
function hydrateCaseUsers(db,cases){
 if(!cases.length)return cases;
 const groups=new Map(cases.map(item=>[item.id,[]]));
 const users=db.prepare('SELECT a.id,a.test_case_id,a.participant_id,a.status,a.production_status,p.code,p.name FROM assignments a JOIN participants p ON p.id=a.participant_id WHERE a.test_case_id IN ('+cases.map(()=>'?').join(',')+') ORDER BY p.name COLLATE NOCASE,p.code COLLATE NOCASE,a.id').all(...cases.map(item=>item.id));
 for(const user of users)groups.get(user.test_case_id).push(user);
 return cases.map(item=>({...item,assigned_users:groups.get(item.id)}));
}
// Representative user determines case-level Assigned User sorting; all users are
// returned separately. Case pagination never expands into assignment rows.
const caseJoins=` LEFT JOIN assignments a ON a.id=(SELECT ax.id FROM assignments ax LEFT JOIN participants px ON px.id=ax.participant_id WHERE ax.test_case_id=tc.id ORDER BY ax.participant_id IS NULL,CASE WHEN px.name IS NULL OR TRIM(px.name)='' THEN 1 ELSE 0 END,px.name COLLATE NOCASE,CASE WHEN px.code IS NULL OR TRIM(px.code)='' THEN 1 ELSE 0 END,px.code COLLATE NOCASE,ax.id LIMIT 1) LEFT JOIN participants p ON p.id=a.participant_id `;
module.exports={migrateMultipleCaseUsers,addCaseUser,hydrateCaseUsers,caseJoins};
