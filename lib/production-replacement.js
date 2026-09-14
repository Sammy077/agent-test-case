'use strict';

const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');

function sqlString(value){return "'"+String(value).replace(/'/g,"''")+"'"}
async function backupDatabase(dbPath,backupDirectory){
  fs.mkdirSync(backupDirectory,{recursive:true});
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const backupPath=path.resolve(backupDirectory,'test-center-'+stamp+'.db');
  if(fs.existsSync(backupPath))throw Error('Backup path already exists');
  const source=new DatabaseSync(dbPath);
  try{source.exec('VACUUM INTO '+sqlString(backupPath))}finally{source.close()}
  return backupPath;
}

function replaceProductionData(db,records,actor,sources=[]){
  if(!Array.isArray(records)||records.length!==800)throw Error('Production replacement requires exactly 800 validated cases');
  const keys=new Set(records.map(record=>record.durableKey));
  if(keys.size!==records.length||records.some(record=>!record.durableKey||!record.sourceCaseId||!record.channel||!record.subcategory||!record.scenario))throw Error('Production records are missing a durable source identity');
  const channels={},subcategories={},statusCounts={};
  for(const record of records){channels[record.channel]=(channels[record.channel]||0)+1;subcategories[record.subcategory]=(subcategories[record.subcategory]||0)+1;statusCounts[record.productionStatus]=(statusCounts[record.productionStatus]||0)+1}
  if(channels['WCX POS']!==530||channels['WCX eKYC']!==270)throw Error('Production channel reconciliation failed');
  const insertCase=db.prepare(`INSERT INTO test_cases(case_code,title,process,priority,steps,expected_result,status,qa_status,channel,case_type,source_sheet,subcategory,source_case_id,durable_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  const insertAssignment=db.prepare(`INSERT INTO assignments(
    test_case_id,participant_id,sequence_no,status,workflow_state,production_status,source_case_id,
    actual_result,tester,executed_at,qa_remark,jira_link,finance_status,finance_remark,source_details_json,updated_by
  ) VALUES(?,NULL,?,'NOT_STARTED','UNASSIGNED',?,?,?,?,?,?,?,?,?,?,?)`);
  try{
    db.exec('BEGIN IMMEDIATE');
    db.exec('DELETE FROM defects');db.exec('DELETE FROM assignments');db.exec('DELETE FROM test_cases');
    for(const record of records){
      const caseRow=insertCase.run(record.durableKey,record.scenario,record.mainFeature||record.subcategory,record.priority,record.steps,record.expectedResult,'NOT_STARTED','PENDING',record.channel,record.caseType,record.sourceSheet,record.subcategory,record.sourceCaseId,record.durableKey);
      db.prepare('UPDATE test_cases SET category=?,type=?,main_feature=?,sub_feature=? WHERE id=?').run(record.category||null,record.type||null,record.mainFeature||'',record.subFeature||'',caseRow.lastInsertRowid);
      insertAssignment.run(caseRow.lastInsertRowid,record.row,record.productionStatus,record.sourceCaseId,record.actualResult,record.qaTester,record.executedAt,record.qaRemark,record.jiraLink,record.financeStatus,record.financeRemark,JSON.stringify(record.details||{}),actor);
    }
    db.exec('COMMIT');
  }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}
  const summary={total:records.length,channels,subcategories,statusCounts,sources:sources.map(source=>({fileName:path.basename(source.fileName||''),excludedSheets:source.excludedSheets||[]}))};
  db.prepare('INSERT INTO audit_log(actor,action,entity_type,entity_id,details) VALUES(?,?,?,?,?)').run(actor,'REPLACE_PRODUCTION_DATA','TEST_CASE',null,JSON.stringify(summary));
  return summary;
}

module.exports={backupDatabase,replaceProductionData};
