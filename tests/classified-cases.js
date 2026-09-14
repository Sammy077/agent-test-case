'use strict';
// Catches reference-sheet ingestion, metadata loss on reimport, and cross-class result coupling.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),ExcelJS=require('exceljs');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ptc-classified-'));
process.env.SERVERLESS='true';process.env.NODE_ENV='test';process.env.DEMO_MODE='true';process.env.DB_FILE=path.join(directory,'test.db');process.env.FRONTEND_MODE='htmx';
const {db,parseWorkbook}=require('../server');
const {parseProductionWorkbook}=require('../lib/production-workbook');
const {importProductionData}=require('../lib/production-import');
async function fixture(){
 const w=new ExcelJS.Workbook();
 for(const name of ['Group','MasterSheet','Standard','Gold']){
  const s=w.addWorksheet(name);s.addRow(['No','Test Scenario','Expected Result','Status','Priority Level','Main Feature','Sub_Feature','Category','Type','Case Type','Master','Commission','Fee','Gold Commission']);
  s.addRow(['TC-1','Scenario','Expected','',2,'Cash Service','Top Up','Cash-In','QR','Positive',100,0,1.25,900]);
 }
 return parseProductionWorkbook(await w.xlsx.writeBuffer(),{channel:'Cash',fileName:'fixture.xlsx'});
}
(async()=>{
 const parsed=await fixture();assert.deepEqual(parsed.excludedSheets,['Group','MasterSheet']);assert.equal(parsed.records.length,2);assert.equal(parsed.errors.length,0);
 assert.equal(parsed.records[0].category,'Cash-In');assert.equal(parsed.records[0].type,'QR');assert.equal(parsed.records[0].caseType,'Positive');
 importProductionData(db,parsed.records,'admin');
 const cases=db.prepare('SELECT * FROM test_cases ORDER BY id').all();assert.equal(cases[0].main_feature,'Cash Service');assert.equal(cases[0].sub_feature,'Top Up');assert.equal(cases[0].category,'Cash-In');
 db.prepare("INSERT INTO participants(code,name,type) VALUES('A01','Alice','AGENT'),('A02','Bob','AGENT')").run();
 db.prepare("UPDATE assignments SET participant_id=1,status='COMPLETED',actual_result='Saved result',qa_remark='Saved QA' WHERE test_case_id=?").run(cases[0].id);
 db.prepare('UPDATE assignments SET participant_id=2 WHERE test_case_id=?').run(cases[1].id);
 parsed.records[0].details.master='200';parsed.records[0].mainFeature='Updated service';parsed.records[0].category=null;
 const summary=importProductionData(db,parsed.records,'admin');assert.equal(summary.insertedCases,0);assert.equal(summary.updatedCases,2);
 const a=db.prepare('SELECT * FROM assignments ORDER BY id').all();assert.equal(a[0].participant_id,1);assert.equal(a[0].status,'COMPLETED');assert.equal(a[0].actual_result,'Saved result');assert.equal(a[0].qa_remark,'Saved QA');assert.equal(JSON.parse(a[0].source_details_json).master,'200');assert.equal(a[1].status,'NOT_STARTED');
 assert.equal(db.prepare('SELECT category FROM test_cases WHERE id=?').get(cases[0].id).category,null);
 const optional=new ExcelJS.Workbook(),optionalSheet=optional.addWorksheet('Optional');optionalSheet.addRows([['No','Test Scenario','Expected Result','Status','Priority Level','Category','Type'],['T1','First','Expected','',1,'Cash-In','QR'],['T2','Second','Expected','',2,'',''],['T2','Repeated source row','Expected','',3]]);
 const optionalParsed=await parseProductionWorkbook(await optional.xlsx.writeBuffer(),{channel:'Optional',fileName:'optional.xlsx'});assert.equal(optionalParsed.errors.length,0);assert.equal(optionalParsed.records[1].category,null);assert.equal(optionalParsed.records[1].type,null);assert.equal(new Set(optionalParsed.records.map(x=>x.durableKey)).size,3);assert.match(optionalParsed.records[2].durableKey,/::row-4$/);
 const legacy=new ExcelJS.Workbook(),sheet=legacy.addWorksheet('Legacy');sheet.addRow(['Case ID','Participant Code','Channel','Scenario','Priority Level','Expected Result','Status','Category','Type','Main Feature','Sub Feature','Master','Commission','Fee']);sheet.addRow(['L1','A01','Legacy','Legacy case',1,'Expected','Not Started','Cash-Out','Bakong','Payments','Withdrawal',50,0,'Free']);
 const legacyParsed=parseWorkbook(legacy);assert.equal(legacyParsed.errors.length,0);assert.equal(legacyParsed.records[0].category,'Cash-Out');assert.equal(legacyParsed.records[0].mainFeature,'Payments');assert.equal(legacyParsed.records[0].details.commission,0);
 console.log('PASS: classified identity, reference exclusions, optional metadata, independent results, safe metadata reimport');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>{db.close();fs.rmSync(directory,{recursive:true,force:true})});
