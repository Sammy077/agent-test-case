'use strict';
// Opens pre-feature schema and verifies durable records/results survive feature backfill.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'ptc-metadata-migration-')),file=path.join(directory,'legacy.db'),legacy=new DatabaseSync(file);
legacy.exec(`CREATE TABLE test_cases(id INTEGER PRIMARY KEY,case_code TEXT UNIQUE NOT NULL,title TEXT NOT NULL,process TEXT NOT NULL,priority INTEGER DEFAULT 3,steps TEXT,expected_result TEXT,status TEXT DEFAULT 'NOT_STARTED',qa_status TEXT DEFAULT 'PENDING',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE assignments(id INTEGER PRIMARY KEY,test_case_id INTEGER NOT NULL,participant_id INTEGER,sequence_no INTEGER DEFAULT 1,status TEXT DEFAULT 'NOT_STARTED',actual_result TEXT,evidence_ref TEXT,updated_by TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,source_details_json TEXT DEFAULT '{}');
INSERT INTO test_cases(case_code,title,process) VALUES('OLD','Legacy case','Classification fallback');`);
legacy.prepare('INSERT INTO assignments(test_case_id,status,actual_result,source_details_json) VALUES(1,?,?,?)').run('COMPLETED','Saved execution',JSON.stringify({'main service feature':'Cash Service','sub feature':'Top Up'}));legacy.close();
process.env.NODE_ENV='test';process.env.SERVERLESS='true';process.env.DB_FILE=file;process.env.DEMO_MODE='false';
const {db}=require('../server');
try{const c=db.prepare('SELECT * FROM test_cases').get();assert.equal(c.id,1);assert.equal(c.main_feature,'Cash Service');assert.equal(c.sub_feature,'Top Up');assert.equal(c.category,null);assert.equal(c.type,null);assert.equal(c.process,'Classification fallback');assert.equal(db.prepare('SELECT actual_result FROM assignments').get().actual_result,'Saved execution');assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');console.log('PASS: pre-feature schema migration, feature backfill, nullable metadata, preserved execution')}finally{db.close();fs.rmSync(directory,{recursive:true,force:true})}
