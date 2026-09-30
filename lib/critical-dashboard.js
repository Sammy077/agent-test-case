'use strict';
const {readRecords}=require('./xlsx-lite');

const SHEET='MASTER - All Test Cases';
const PRIORITY='Critical';
const TID_EXEMPT=['no perform txn'];
const REQUIRED=['Record Key','Platform','Test Case ID','Priority Level','Status','TID','QA Tester','Finance Status'];
const WANTED=['Record Key','Platform','Test Case ID','Priority Level','Service / Main Feature','Sub Feature','Test Scenario','Expected Result','Test Step / Instruction','Execute Date','TID','Status','QA Tester','Finance Status','Finance Remark','QA Remark','Jira Link','Actual Result','Source Sheet'];
const STATUS_ALIASES={
  '':'not executed','not execute':'not executed','not executed':'not executed','not test':'not executed','not tested':'not executed',
  'pass':'passed','passed':'passed','fail':'failed','failed':'failed','block':'blocked','blocked':'blocked','retest':'retest required','retest required':'retest required',
};
const STATUS_NAMES=['not executed','passed','failed','blocked','retest required'];

function clean(value){return String(value??'').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').replace(/\s+/g,' ').trim()}
function folded(value){return clean(value).toLowerCase()}
function normalizeStatus(value){const key=folded(value);return STATUS_ALIASES[key]??key}
function financeName(value){const key=folded(value)||'not verify yet';return TID_EXEMPT.includes(key)?'no perform txn':key}
function channelFromPlatform(value){
  const platform=folded(value);
  if(platform.includes('pos'))return 'POS';
  if(platform.includes('ekyc')||platform.includes('e-kyc')||platform.includes('e kyc'))return 'eKYC';
  return 'Other';
}
function setup(db){
  db.exec(`CREATE TABLE IF NOT EXISTS critical_cases(id INTEGER PRIMARY KEY,record_key TEXT NOT NULL DEFAULT '',case_id TEXT NOT NULL DEFAULT '',platform TEXT NOT NULL DEFAULT '',channel TEXT NOT NULL DEFAULT 'Other',priority_level TEXT NOT NULL DEFAULT '',status_norm TEXT NOT NULL DEFAULT '',finance_norm TEXT NOT NULL DEFAULT '',tester TEXT NOT NULL DEFAULT '',tid TEXT NOT NULL DEFAULT '',tid_required INTEGER NOT NULL DEFAULT 1,main_feature TEXT NOT NULL DEFAULT '',sub_feature TEXT NOT NULL DEFAULT '',scenario TEXT NOT NULL DEFAULT '',instruction TEXT NOT NULL DEFAULT '',expected_result TEXT NOT NULL DEFAULT '',actual_result TEXT NOT NULL DEFAULT '',execute_date TEXT NOT NULL DEFAULT '',finance_remark TEXT NOT NULL DEFAULT '',qa_remark TEXT NOT NULL DEFAULT '',jira_link TEXT NOT NULL DEFAULT '',source_sheet TEXT NOT NULL DEFAULT '',row_number INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS critical_dashboard_source(id INTEGER PRIMARY KEY CHECK(id=1),file_name TEXT NOT NULL DEFAULT '',sheet_name TEXT NOT NULL DEFAULT '',priority_filter TEXT NOT NULL DEFAULT 'Critical',imported_at TEXT,imported_by TEXT NOT NULL DEFAULT '',all_tid_completed_at TEXT,source_key TEXT NOT NULL DEFAULT '');
  INSERT OR IGNORE INTO critical_dashboard_source(id,sheet_name,priority_filter) VALUES(1,'MASTER - All Test Cases','Critical');
  UPDATE critical_dashboard_source SET sheet_name='MASTER - All Test Cases',priority_filter='Critical' WHERE id=1;
  CREATE INDEX IF NOT EXISTS idx_critical_cases_channel ON critical_cases(channel);`);
}
function parseWorkbook(buffer,fileName='critical.xlsx'){
  const {records,headerRow,sheetNames}=readRecords(buffer,{sheetName:SHEET,required:REQUIRED,wanted:WANTED});
  const wanted=new Set(WANTED),excluded={rows:0};
  const parsed=[];
  records.forEach((record,index)=>{
    if(!clean(record['Record Key'])&&!clean(record['Test Case ID']))return;
    if(folded(record['Priority Level'])!==PRIORITY.toLowerCase()){excluded.rows++;return}
    const finance=financeName(record['Finance Status']);
    parsed.push({
      record_key:clean(record['Record Key']||'').slice(0,200),
      case_id:clean(record['Test Case ID']||'').slice(0,100),
      platform:clean(record['Platform']||'').slice(0,200),
      channel:channelFromPlatform(record['Platform']),
      priority_level:clean(record['Priority Level']||'').slice(0,50),
      status_norm:normalizeStatus(record['Status']).slice(0,50),
      finance_norm:finance.slice(0,50),
      tester:clean(record['QA Tester']||'').slice(0,120),
      tid:clean(record['TID']||'').slice(0,200),
      tid_required:TID_EXEMPT.includes(finance)?0:1,
      main_feature:clean(record['Service / Main Feature']||'').slice(0,200),
      sub_feature:clean(record['Sub Feature']||'').slice(0,200),
      scenario:clean(record['Test Scenario']||'').slice(0,500),
      instruction:clean(record['Test Step / Instruction']||'').slice(0,1000),
      expected_result:clean(record['Expected Result']||'').slice(0,500),
      actual_result:clean(record['Actual Result']||'').slice(0,500),
      execute_date:clean(record['Execute Date']||'').slice(0,50),
      finance_remark:clean(record['Finance Remark']||'').slice(0,500),
      qa_remark:clean(record['QA Remark']||'').slice(0,500),
      jira_link:clean(record['Jira Link']||'').slice(0,500),
      source_sheet:clean(record['Source Sheet']||'').slice(0,200),
      row_number:headerRow+2+index,
    });
  });
  Object.defineProperty(parsed,'excludedRows',{value:excluded.rows,enumerable:false});
  return {records:parsed,excludedRows:excluded.rows,sheetNames,headerRow,wanted:wanted.size};
}
function resolveTidCompletion(db,missingTid){
  const row=db.prepare('SELECT all_tid_completed_at FROM critical_dashboard_source WHERE id=1').get()||{};
  if(Number(missingTid)===0){
    if(!row.all_tid_completed_at){const value=new Date().toISOString();db.prepare('UPDATE critical_dashboard_source SET all_tid_completed_at=? WHERE id=1').run(value);return value}
    return row.all_tid_completed_at;
  }
  if(row.all_tid_completed_at!==null&&row.all_tid_completed_at!==undefined)db.prepare('UPDATE critical_dashboard_source SET all_tid_completed_at=NULL WHERE id=1').run();
  return null;
}
function importWorkbook(db,buffer,actor,audit,fileName='critical.xlsx'){
  const {records}=parseWorkbook(buffer,fileName);
  const missingTid=records.filter(record=>record.tid_required&&!record.tid).length;
  db.exec('BEGIN IMMEDIATE');
  try{
    db.exec('DELETE FROM critical_cases');
    const insert=db.prepare(`INSERT INTO critical_cases(record_key,case_id,platform,channel,priority_level,status_norm,finance_norm,tester,tid,tid_required,main_feature,sub_feature,scenario,instruction,expected_result,actual_result,execute_date,finance_remark,qa_remark,jira_link,source_sheet,row_number) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for(const record of records)insert.run(record.record_key,record.case_id,record.platform,record.channel,record.priority_level,record.status_norm,record.finance_norm,record.tester,record.tid,record.tid_required,record.main_feature,record.sub_feature,record.scenario,record.instruction,record.expected_result,record.actual_result,record.execute_date,record.finance_remark,record.qa_remark,record.jira_link,record.source_sheet,record.row_number);
    db.prepare("UPDATE critical_dashboard_source SET file_name=?,sheet_name=?,priority_filter=?,imported_at=CURRENT_TIMESTAMP,imported_by=?,source_key=? WHERE id=1").run(clean(fileName),SHEET,PRIORITY,actor,clean(fileName)+'|'+SHEET+'|'+PRIORITY);
    const allTidCompletedAt=resolveTidCompletion(db,missingTid);
    db.exec('COMMIT');
    if(audit)audit(actor,'IMPORT_CRITICAL_DASHBOARD','CRITICAL_DASHBOARD',1,JSON.stringify({file:clean(fileName),imported:records.length,missingTid}));
    return {imported:records.length,missingTid,allTidCompletedAt,fileName:clean(fileName),sheetName:SHEET};
  }catch(error){db.exec('ROLLBACK');throw error}
}
function summary(db){
  const source=db.prepare('SELECT file_name,sheet_name,priority_filter,imported_at,imported_by,all_tid_completed_at FROM critical_dashboard_source WHERE id=1').get()||{};
  const totals=db.prepare(`SELECT COUNT(*) total,COALESCE(SUM(channel='POS'),0) pos,COALESCE(SUM(channel='eKYC'),0) ekyc,COALESCE(SUM(channel='Other'),0) other_channel,COALESCE(SUM(status_norm='not executed'),0) not_executed,COALESCE(SUM(status_norm='passed'),0) passed,COALESCE(SUM(status_norm='failed'),0) failed,COALESCE(SUM(status_norm='blocked'),0) blocked,COALESCE(SUM(status_norm='retest required'),0) retest_required,COALESCE(SUM(tid_required=1 AND TRIM(tid)=''),0) missing_tid,COALESCE(SUM(tid_required),0) tid_required,COALESCE(SUM(tid_required=1 AND TRIM(tid)<>''),0) tid_completed,COALESCE(SUM(finance_norm='correct'),0) finance_correct,COALESCE(SUM(finance_norm='incorrect'),0) finance_error,COALESCE(SUM(finance_norm='no perform txn'),0) finance_no_txn FROM critical_cases`).get();
  const finance_pending=totals.total-totals.finance_correct-totals.finance_error-totals.finance_no_txn;
  const metrics={
    total:totals.total,pos:totals.pos,ekyc:totals.ekyc,other_channel:totals.other_channel,
    not_executed:totals.not_executed,passed:totals.passed,failed:totals.failed,blocked:totals.blocked,retest_required:totals.retest_required,
    missing_tid:totals.missing_tid,tid_required:totals.tid_required,tid_completed:totals.tid_completed,
    tid_completion_pct:totals.tid_required?Math.round(totals.tid_completed/totals.tid_required*1000)/10:100,
    finance_correct:totals.finance_correct,finance_error:totals.finance_error,finance_pending,
    finance_no_txn:totals.finance_no_txn,finance_verified:totals.finance_correct+totals.finance_error+totals.finance_no_txn,
    finance_completion_pct:totals.total?Math.round((totals.finance_correct+totals.finance_error+totals.finance_no_txn)/totals.total*1000)/10:0,
  };
  const testers=db.prepare(`SELECT CASE WHEN TRIM(tester)='' THEN 'Unassigned' ELSE tester END name,COUNT(*) total,COALESCE(SUM(status_norm='passed'),0) passed,COALESCE(SUM(status_norm='failed'),0) failed,COALESCE(SUM(status_norm='blocked'),0) blocked,COALESCE(SUM(status_norm='retest required'),0) retest_required,COALESCE(SUM(status_norm NOT IN ('passed','failed','blocked','retest required')),0) not_executed,COALESCE(SUM(tid_required=1 AND TRIM(tid)=''),0) missing_tid,COALESCE(SUM(finance_norm='correct'),0) finance_correct,COALESCE(SUM(finance_norm='incorrect'),0) finance_error,COALESCE(SUM(finance_norm='no perform txn'),0) finance_no_txn FROM critical_cases GROUP BY name ORDER BY total DESC,name COLLATE NOCASE`).all()
    .map(row=>{const executed=row.passed+row.failed+row.blocked+row.retest_required;return {...row,finance_pending:row.total-row.finance_correct-row.finance_error-row.finance_no_txn,executed,pending:Math.max(0,row.total-executed),completion_pct:row.total?Math.round(executed/row.total*1000)/10:0}});
  return {
    source:{file_name:source.file_name||'',sheet_name:source.sheet_name||SHEET,priority_filter:source.priority_filter||PRIORITY,imported_at:source.imported_at||null,imported_by:source.imported_by||''},
    metrics,
    channels:[{name:'POS',value:metrics.pos},{name:'eKYC',value:metrics.ekyc}],
    finance:[{name:'Correct',value:metrics.finance_correct},{name:'Incorrect',value:metrics.finance_error},{name:'Not Verify Yet',value:metrics.finance_pending},{name:'No Perform TXN',value:metrics.finance_no_txn}],
    testers,
    allTidCompletedAt:source.all_tid_completed_at||null,
  };
}
function sourceSummary(db){
  const row=db.prepare(`SELECT s.file_name,s.sheet_name,s.imported_at,s.imported_by,COUNT(c.id) total_rows,COALESCE(SUM(c.tid_required=1 AND TRIM(c.tid)=''),0) missing_tid FROM critical_dashboard_source s LEFT JOIN critical_cases c ON 1=1 WHERE s.id=1 GROUP BY s.id`).get()||{};
  return {file_name:row.file_name||'',sheet_name:row.sheet_name||SHEET,imported_at:row.imported_at||null,imported_by:row.imported_by||'',total_rows:row.total_rows||0,missing_tid:row.missing_tid||0};
}

module.exports={SHEET,PRIORITY,TID_EXEMPT,normalizeStatus,channelFromPlatform,setup,parseWorkbook,importWorkbook,resolveTidCompletion,summary,sourceSummary};
