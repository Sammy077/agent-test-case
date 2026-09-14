'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/app.js','utf8'),calls=[];
const selection={value:'2',dataset:{currentTester:'TC-1 → A01 · Alice'}};
const context={confirm:()=>{throw Error('Additive assignment must not request replacement')},$$:()=>[{value:'1',dataset:{currentTester:'Alice'}}],$:selector=>selector==='#content'?{prepend:()=>{}}:selection,api:async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return {updated:1,participant:{code:'A02',name:'Bob'}}},admin:async()=>{},document:{createElement:()=>({})}};
vm.createContext(context);
for(const name of ['assignCase','bulkAssign'])vm.runInContext(source.split('\n').find(line=>line.startsWith('async function '+name+'(')),context);
(async()=>{await vm.runInContext('assignCase(1)',context);await vm.runInContext('bulkAssign()',context);assert.equal(calls.length,2);assert.deepEqual(calls[0].body,{participantId:2});assert.deepEqual(calls[1].body,{caseIds:[1],participantId:2});assert.doesNotMatch(fs.readFileSync('public/htmx-client.js','utf8'),/Replace existing tester/);console.log('PASS: additive single and bulk controls issue requests without replacement confirmation')})().catch(error=>{console.error(error);process.exitCode=1});
