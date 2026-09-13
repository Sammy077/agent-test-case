'use strict';
function importProductionData(db,records,actor){
 const summary={channel:records[0].channel,insertedCases:0,updatedCases:0,total:records.length};
 try{
  db.exec('BEGIN IMMEDIATE');
  for(const r of records){
   const existing=db.prepare('SELECT id FROM test_cases WHERE durable_key=?').get(r.durableKey);
   const values=[r.scenario,r.mainFeature||r.subcategory,r.priority,r.steps,r.expectedResult,r.channel,r.caseType,r.sourceSheet,r.subcategory,r.sourceCaseId];
   let id;
   if(existing){id=existing.id;db.prepare('UPDATE test_cases SET title=?,process=?,priority=?,steps=?,expected_result=?,channel=?,case_type=?,source_sheet=?,subcategory=?,source_case_id=? WHERE id=?').run(...values,id);summary.updatedCases++}
   else{id=db.prepare('INSERT INTO test_cases(title,process,priority,steps,expected_result,channel,case_type,source_sheet,subcategory,source_case_id,case_code,durable_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(...values,r.durableKey,r.durableKey).lastInsertRowid;summary.insertedCases++}
   // Existing execution, QA results, defects and participant linkage remain untouched.
   if(!db.prepare('SELECT id FROM assignments WHERE test_case_id=?').get(id))db.prepare(`INSERT INTO assignments(test_case_id,participant_id,sequence_no,status,workflow_state,production_status,source_case_id,actual_result,tester,executed_at,qa_remark,jira_link,finance_status,finance_remark,source_details_json,updated_by) VALUES(?,NULL,?,'NOT_STARTED','UNASSIGNED',?,?,?,?,?,?,?,?,?,?,?)`).run(id,r.row,r.productionStatus,r.sourceCaseId,r.actualResult,r.qaTester,r.executedAt,r.qaRemark,r.jiraLink,r.financeStatus,r.financeRemark,JSON.stringify(r.details),actor);
  }
  db.prepare('INSERT INTO audit_log(actor,action,entity_type,details) VALUES(?,?,?,?)').run(actor,'IMPORT_PRODUCTION_CHANNEL','TEST_CASE',JSON.stringify(summary));
  db.exec('COMMIT');return summary;
 }catch(error){db.exec('ROLLBACK');throw error}
}
module.exports={importProductionData};
