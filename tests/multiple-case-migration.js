'use strict';
const assert=require('node:assert/strict'),Database=require('libsql');
const {migrateMultipleCaseUsers}=require('../lib/case-assignments');
const db=new Database(':memory:');
db.exec(`PRAGMA foreign_keys=ON;
 CREATE TABLE test_cases(id INTEGER PRIMARY KEY);CREATE TABLE participants(id INTEGER PRIMARY KEY);
 INSERT INTO test_cases VALUES(1);INSERT INTO participants VALUES(1),(2);
 CREATE TABLE assignments(id INTEGER PRIMARY KEY,test_case_id INTEGER NOT NULL,participant_id INTEGER,status TEXT,actual_result TEXT,source_details_json TEXT,UNIQUE(test_case_id),FOREIGN KEY(test_case_id) REFERENCES test_cases(id));
 CREATE UNIQUE INDEX idx_assignments_one_agent_per_case ON assignments(test_case_id);
 CREATE INDEX custom_status_index ON assignments(status);
 CREATE TABLE defects(id INTEGER PRIMARY KEY,assignment_id INTEGER REFERENCES assignments(id));
 INSERT INTO assignments VALUES(77,1,1,'FAILED','Saved result','{"fee":0}');INSERT INTO defects VALUES(9,77);`);
try{
 const before=db.prepare('SELECT * FROM assignments').all();migrateMultipleCaseUsers(db);migrateMultipleCaseUsers(db);
 assert.deepEqual(db.prepare('SELECT * FROM assignments').all(),before);
 db.prepare("INSERT INTO assignments(id,test_case_id,participant_id,status) VALUES(78,1,2,'NOT_STARTED')").run();
 assert.throws(()=>db.prepare('INSERT INTO assignments(test_case_id,participant_id) VALUES(1,2)').run());
 assert.equal(db.prepare('SELECT assignment_id FROM defects').get().assignment_id,77);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.ok(db.prepare("SELECT name FROM sqlite_master WHERE name='custom_status_index'").get());
 console.log('PASS: existing one-user schema upgrade, stable IDs/results/details/defects, repeat migration, preserved indexes, pair uniqueness');
}finally{db.close()}
