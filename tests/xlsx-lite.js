'use strict';
const assert=require('node:assert/strict');
const {readSheetRows,readRecords,zipEntries}=require('../lib/xlsx-lite');
const buffer=require('./fixtures/master-critical').buildFixture();
const sheet='MASTER - All Test Cases';
const wanted=['Record Key','Platform','Test Case ID','Priority Level','Service / Main Feature','Sub Feature','Test Scenario','Expected Result','Execute Date','TID','Status','QA Tester','Finance Status','Finance Remark'];
const required=['Record Key','Platform','Test Case ID','Priority Level','Status','TID','QA Tester','Finance Status'];

const entries=zipEntries(buffer);
assert.ok(entries.has('xl/worksheets/sheet1.xml'),'zip entries are listed');
assert.equal(entries.get('xl/worksheets/sheet2.xml').method,0,'stored entry is listed');

const rows=readSheetRows(buffer,sheet);
assert.equal(rows.length,9,'title, blank, header and six data rows');
assert.equal(rows[2][1],'Record Key','header row is returned raw');
assert.equal(rows[3][9],'46200','numbers pass through as text');
assert.equal(rows[3][5],'Cash In','shared rich-text runs are joined');
assert.equal(rows[5][7],'Scenario 3','inline strings are read');

const {records,headerRow,sheetNames}=readRecords(buffer,{sheetName:sheet,required,wanted});
assert.equal(headerRow,2,'header is the third row');
assert.deepEqual(sheetNames,['MASTER - All Test Cases','Notes']);
assert.equal(records.length,6);
assert.equal(records[0]['Record Key'],'R-1');
assert.equal(records[0]['Service / Main Feature'],'Cash In');
assert.equal(records[1]['TID'],'N/A');

assert.throws(()=>readRecords(buffer,{sheetName:'Sheet1',required,wanted}),error=>error.status===400&&/MASTER - All Test Cases/.test(error.message),'missing sheet names the available sheets');
assert.throws(()=>readRecords(buffer,{sheetName:sheet,required:required.concat(['Not A Column']),wanted}),error=>error.status===400&&/Not A Column/.test(error.message),'missing header is reported');
assert.throws(()=>readRecords(Buffer.from('not a zip'),{sheetName:sheet,required,wanted}),error=>error.status===400,'unreadable archive is a 400');
console.log('PASS: xlsx-lite reads sheets, shared/inline strings, numbers, absolute targets and fails loudly');
