'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{DatabaseSync}=require('node:sqlite');
Object.assign(process.env,{SERVERLESS:'true',NODE_ENV:'test',DB_FILE:path.join(fs.mkdtempSync(path.join(os.tmpdir(),'ptc-critical-')),'test.db'),DEMO_MODE:'false'});
const {db}=require('../server');
const critical=require('../lib/critical-dashboard');
critical.setup(db);
const buffer=require('./fixtures/master-critical').buildFixture();

assert.equal(critical.SHEET,'MASTER - All Test Cases');
assert.equal(critical.normalizeStatus('Not tested'),'not executed');
assert.equal(critical.normalizeStatus('Retest Required'),'retest required');
assert.equal(critical.normalizeStatus(''),'not executed');
assert.equal(critical.channelFromPlatform('WCX eKYC Android'),'eKYC');
assert.equal(critical.channelFromPlatform('WCX POS Standard'),'POS');
assert.equal(critical.channelFromPlatform('Other Bank'),'Other');

const parsed=critical.parseWorkbook(buffer);
assert.equal(parsed.records.length,5,'None-Critical rows are excluded');
assert.equal(parsed.excludedRows,2);
assert.deepEqual(parsed.records.map(record=>record.case_id),['CR-1','CR-2','CR-3','CR-4','CR-5']);
assert.equal(parsed.records[0].tid_required,1);
assert.equal(parsed.records[1].tid_required,0,'No Perform TXN does not require a TID');
assert.equal(parsed.records[1].tid,'N/A');
assert.equal(parsed.records[0].tester,'','blank tester is stored blank and labelled later');

const before=critical.summary(db);
assert.equal(before.metrics.total,0,'nothing is stored before the first import');

const imported=critical.importWorkbook(db,buffer,'admin',()=>{},'master-critical.xlsx');
assert.equal(imported.imported,5);
assert.equal(imported.missingTid,3);
assert.equal(imported.allTidCompletedAt,null,'three required TIDs are missing');
assert.equal(db.prepare('SELECT COUNT(*) n FROM critical_cases').get().n,5);

const summary=critical.summary(db);
assert.deepEqual(summary.metrics,{
  total:5,pos:1,ekyc:2,other_channel:2,
  not_executed:1,passed:1,failed:1,blocked:0,retest_required:1,
  missing_tid:3,tid_required:4,tid_completed:1,tid_completion_pct:25,
  finance_correct:1,finance_error:1,finance_pending:2,finance_no_txn:1,
  finance_verified:3,finance_completion_pct:60,
});
assert.deepEqual(summary.channels,[{name:'POS',value:1},{name:'eKYC',value:2}]);
assert.deepEqual(summary.finance,[{name:'Correct',value:1},{name:'Incorrect',value:1},{name:'Not Verify Yet',value:2},{name:'No Perform TXN',value:1}]);
assert.deepEqual(summary.testers.map(tester=>tester.name),['Det Dam','Koemly Hort','Sakhorn Pok','Unassigned']);
assert.deepEqual(summary.testers[0],{name:'Det Dam',total:2,passed:0,failed:1,not_executed:0,blocked:0,retest_required:1,missing_tid:1,finance_correct:1,finance_error:1,finance_pending:0,finance_no_txn:0,executed:2,pending:0,completion_pct:100});
assert.deepEqual(summary.testers[2],{name:'Sakhorn Pok',total:1,passed:0,failed:0,not_executed:0,blocked:0,retest_required:0,missing_tid:1,finance_correct:0,finance_error:0,finance_pending:1,finance_no_txn:0,executed:0,pending:1,completion_pct:0});
assert.deepEqual(summary.testers[3],{name:'Unassigned',total:1,passed:0,failed:0,not_executed:1,blocked:0,retest_required:0,missing_tid:1,finance_correct:0,finance_error:0,finance_pending:1,finance_no_txn:0,executed:0,pending:1,completion_pct:0});
assert.equal(summary.testers.reduce((sum,tester)=>sum+tester.not_executed,0),summary.metrics.not_executed,'tester Not Executed must agree with the KPI, including for unrecognised statuses');
assert.equal(summary.source.file_name,'master-critical.xlsx');
assert.equal(summary.source.priority_filter,'Critical');

// TID completion time is set once when nothing is missing and cleared when something is.
const already=critical.resolveTidCompletion(db,0);
assert.ok(already,'completion time is recorded');
assert.equal(critical.resolveTidCompletion(db,0),already,'a second zero reading keeps the first timestamp');
assert.equal(critical.resolveTidCompletion(db,1),null,'a missing required TID clears it');

assert.equal(critical.importWorkbook(db,buffer,'admin',()=>{},'master-critical.xlsx').imported,5,'re-import replaces rather than appends');
assert.equal(db.prepare('SELECT COUNT(*) n FROM critical_cases').get().n,5);
const source=critical.sourceSummary(db);
assert.equal(source.total_rows,5);
assert.equal(source.missing_tid,3);

assert.throws(()=>critical.parseWorkbook(Buffer.from('nope')),error=>error.status===400);
console.log('PASS: critical calculations, Critical-only filter, finance/TID rules, tester rows, replacement import, TID completion state');
db.close();
