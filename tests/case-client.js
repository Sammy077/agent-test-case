'use strict';
// Executes legacy renderers and filter event handler; catches missing controls/query forwarding.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/app.js','utf8');
const caseUI=require('../public/case-ui');
const element={innerHTML:''},nodes={};let requested=[],replaced;
const context={caseUI,URL,URLSearchParams,me:{role:'OBSERVER'},location:new URL('http://localhost/my-tests?participantId=2&priority=1&mainFeature=Cash&sortBy=priority&orderBy=desc'),history:{replaceState:(_s,_t,url)=>{replaced=url;context.location=new URL(url)}},requireSession:async()=>true,shell:()=>{},currentChannel:()=>'',escapeHtml:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;'),count:v=>Number(v)||0,label:v=>v,badge:v=>v,channelBadge:v=>v,channelFilter:()=>'<label>Channel</label>',route:()=>{},updateBulkSelection:()=>{},$:selector=>selector==='#content'?element:(nodes[selector]??={}),$$:()=>[],api:async url=>{requested.push(url);if(url.startsWith('/api/my-assignments'))return {items:[{id:1,source_case_id:'TC-1',subcategory:'Gold',title:'Case',priority:1,status:'NOT_STARTED',type:'QR',category:'Cash-In',source_details:{master:10,commission:0,fee:'Free','premium fee':999}}],filters:{participantId:'2',priority:'1',mainFeature:'Cash',sortBy:'priority',orderBy:'desc'},availableChannels:[],availableMainFeatures:['Cash'],availableSubFeatures:['QR']};if(url==='/api/participants')return {items:[]};if(url==='/api/users')return {items:[]};if(url==='/api/dashboard')return {channels:[],availableChannels:[]};return {items:[],total:100,offset:0,availableSheets:[]}}};
context.productionBadge=context.badge;
vm.createContext(context);
function load(name){const start=source.indexOf('async function '+name+'()'),end=source.indexOf('\nasync function ',start+1);vm.runInContext(source.slice(start,end),context)}
load('myTests');load('admin');
(async()=>{
 await vm.runInContext('myTests()',context);
 assert.match(element.innerHTML,/data-filter="mainFeature"/);assert.match(element.innerHTML,/data-filter="subFeature"/);assert.match(element.innerHTML,/data-filter="sortBy"/);assert.match(element.innerHTML,/data-filter="orderBy"/);assert.match(element.innerHTML,/TC-1 · Gold/);assert.match(element.innerHTML,/>Commission<\/b>: 0/);assert.doesNotMatch(element.innerHTML,/999/);assert.match(element.innerHTML,/participantId=2/);
 context.me.role='ADMIN';context.location=new URL('http://localhost/admin?channel=Cash&sortBy=mainFeature&orderBy=desc&page=2');requested=[];
 await vm.runInContext('admin()',context);assert.match(requested.find(x=>x.startsWith('/api/test-cases')),/sortBy=mainFeature&orderBy=desc/);
 const api=context.api;context.api=async url=>url.startsWith('/api/test-cases')?{items:[{id:1,case_code:'L1',source_sheet:'Legacy classification',title:'Case',priority:1,assignment_status:'COMPLETED'}],total:100,offset:0,availableSheets:[]}:api(url);
 await vm.runInContext('admin()',context);assert.match(element.innerHTML,/<th>Classification<\/th>/);assert.match(element.innerHTML,/<th>Unique Reference<\/th>/);assert.match(element.innerHTML,/Legacy classification/);assert.match(element.innerHTML,/Legacy classification \/ L1 · #1/);assert.match(element.innerHTML,/data-filter="sortBy"/);assert.match(element.innerHTML,/data-filter="orderBy"/);
 const standard={id:12,channel:'CI-PTU',source_case_id:'TC-12',subcategory:'1. Standard'},platinum={...standard,id:13,subcategory:'2. Platinum'};
 assert.notEqual(caseUI.uniqueReference(standard),caseUI.uniqueReference(platinum));
 assert.notEqual(caseUI.uniqueReference(standard),caseUI.uniqueReference({...standard,id:14}));
 let handler;context.app={addEventListener:(_event,fn)=>{handler=fn}};
 vm.runInContext(source.split('\n').find(x=>x.startsWith("app.addEventListener('change'")),context);
 handler({target:{id:'',dataset:{filter:'sortBy'},matches:()=>false,value:'priority'}});assert.equal(replaced.searchParams.get('sortBy'),'priority');assert.equal(replaced.searchParams.get('orderBy'),'desc');assert.equal(replaced.searchParams.get('channel'),'Cash');assert.equal(replaced.searchParams.has('page'),false);
 assert.match(caseUI.sortControls({sortBy:'default'}),/name="orderBy" disabled/);assert.doesNotMatch(caseUI.sortControls({sortBy:'priority'}),/disabled/);
 assert.equal(caseUI.clearHref({participantId:'2',channel:'Cash',priority:'1',sortBy:'priority',orderBy:'desc'}),'/my-tests?participantId=2&sortBy=priority&orderBy=desc');
 console.log('PASS: both legacy case renderers, financial formatting, control state, query forwarding, filter/sort URL persistence');
})().catch(e=>{console.error(e);process.exitCode=1});
