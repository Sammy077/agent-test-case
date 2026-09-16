'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const client=fs.readFileSync(path.join(root,'public/my-agent.js'),'utf8');
const css=fs.readFileSync(path.join(root,'public/style.css'),'utf8');

assert.match(client,/my-agent-tester-grid/,'My Agent must render standalone tester grid');
assert.match(client,/Tester '\+\(index\+1\)/,'card headers must read Tester 1–7');
assert.match(client,/data\.items\.map/,'grid must render current workbook assignment for every tester');
assert.doesNotMatch(client,/schedule\.features\.slice\(0,7\)/,'grid must not invent assignments from feature order');
assert.match(css,/\.my-agent-tester-grid\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/,'desktop grid must use four columns');
assert.match(css,/@media\(max-width:760px\)\{\.my-agent-tester-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)\}\}/,'tablet grid must use two columns');
assert.match(css,/@media\(max-width:440px\)\{\.my-agent-tester-grid\{grid-template-columns:1fr\}\}/,'mobile grid must use one column');
console.log('PASS: seven standalone tester cards use responsive 4/2/1 grid');
