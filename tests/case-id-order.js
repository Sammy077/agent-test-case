'use strict';
const assert=require('node:assert/strict'),Database=require('libsql');
const {caseOrder}=require('../lib/case-query');
const db=new Database(':memory:');
db.exec('CREATE TABLE test_cases(id INTEGER PRIMARY KEY,source_case_id TEXT,case_code TEXT,subcategory TEXT,source_sheet TEXT)');
const values=['TC-10','TC-2','tc-002','TC-189','TC-190','TC-100000000000000000000','TC-99999999999999999999','ABC',''];
for(const [i,value]of values.entries())db.prepare('INSERT INTO test_cases VALUES(?,?,?,?,?)').run(i+1,value,i===8?'TC-3':value,'Standard',null);
const ids=(key,direction)=>db.prepare('SELECT tc.id FROM test_cases tc ORDER BY '+caseOrder(new URL('http://local/?sortBy='+key+'&orderBy='+direction),'tc.id')).all().map(x=>x.id);
try{
 assert.deepEqual(ids('caseId','asc'),[8,2,3,9,1,4,5,7,6]);
 assert.deepEqual(ids('caseId','desc'),[6,7,5,4,1,9,2,3,8]);
 assert.deepEqual(ids('classification','desc'),[8,2,3,9,1,4,5,7,6]);
 console.log('PASS: numeric Case ID suffixes, leading-zero ties, case matching, fallback, large numbers, classification secondary order');
}finally{db.close()}
