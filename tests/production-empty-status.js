'use strict';
const assert=require('node:assert/strict'),ExcelJS=require('exceljs');
const {parseProductionWorkbook}=require('../lib/production-workbook');
(async()=>{
 const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('Production');
 sheet.addRow(['No','Test Scenario','Expected Result','Status','Priority Level']);
 sheet.addRow(['TC-1','First case','Expected','Passed',1]);
 sheet.addRow(['TC-2','Fresh case','Expected','',2]);
 sheet.addRow(['TC-3','Whitespace case','Expected',' \u200b ',3]);
 sheet.addRow(['TC-4','Invalid case','Expected','Unknown result',4]);
 const parsed=await parseProductionWorkbook(await workbook.xlsx.writeBuffer(),{fileName:'fixture.xlsx',channel:'WCX eKYC'});
 assert.equal(parsed.records[0].productionStatus,'PASSED');
 assert.equal(parsed.records[1].productionStatus,'PENDING','blank status must not inherit previous Passed result');
 assert.equal(parsed.records[2].productionStatus,'PENDING');
 assert.equal(parsed.errors.length,1,'only populated unsupported status is invalid');
 assert.equal(parsed.errors[0].row,5);assert.match(parsed.errors[0].message,/Unknown result/);
 assert.equal(parsed.records[1].actualResult,'');assert.equal(parsed.records[1].details.status,undefined);
 console.log('PASS: empty/whitespace production statuses default Pending, no previous-result inheritance, unsupported status rejected');
})().catch(error=>{console.error(error);process.exitCode=1});
