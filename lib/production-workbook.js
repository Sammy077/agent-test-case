'use strict';

const ExcelJS=require('exceljs');

const MAX_RECORDS=10000;
const REFERENCE_SHEETS=new Set(['wcx ekyc','wingpay','group','mastersheet']);
const STATUS_CODES=Object.freeze({
  passed:'PASSED',failed:'FAILED',pending:'PENDING',dependency:'DEPENDENCY',
  'not executed':'NOT_EXECUTED',ncfl:'NCFL','production test':'PRODUCTION_TEST',
  'production bug':'PRODUCTION_BUG','n/a':'NOT_APPLICABLE','in progress':'IN_PROGRESS','stage test':'STAGE_TEST'
});
const HEADER_ALIASES=Object.freeze({
  sourceCaseId:['no'],scenario:['test scenario','scenarios'],steps:['instruction','test step'],
  mainFeature:['main feature','main service feature'],subFeature:['sub feature'],
  actualResult:['acutal result','actual result'],executedAt:['excecute date','date'],
  expectedResult:['expected result'],status:['status'],priority:['priority level'],caseType:['case type'],
  qaTester:['qa tester'],qaRemark:['qa remark'],jiraLink:['jira link'],financeStatus:['finance status'],
  financeRemark:['finance remark'],category:['category'],type:['type']
});

function cleanText(value){return String(value??'').replace(/[\u200B-\u200D\u2060\uFEFF]/g,'').replace(/\s+/g,' ').trim()}
function normalizedHeader(value){return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}
function normalizeKeyPart(value){return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'')}
function normalizeProductionStatus(value){return STATUS_CODES[cleanText(value).toLowerCase().replace(/[_-]+/g,' ').replace(/\s+/g,' ')]||null}
function priorityValue(value){const match=cleanText(value).match(/[1-4]/);return match?Number(match[0]):null}
function cellValue(cell){
  const value=cell?.value;
  if(value===null||value===undefined)return '';
  if(value instanceof Date)return value;
  if(typeof value==='object'){
    if(Object.hasOwn(value,'formula'))return value.result??'';
    if(value.hyperlink)return value.text||value.hyperlink;
    if(Array.isArray(value.richText))return value.richText.map(part=>part.text).join('');
    if(value.text)return value.text;
  }
  return value;
}
function dateValue(value){if(!value)return null;const date=value instanceof Date?value:new Date(value);return Number.isFinite(date.getTime())?date.toISOString():null}
function headerIndex(sheet){
  for(let rowNumber=1;rowNumber<=Math.min(sheet.rowCount,20);rowNumber++){
    const headers=new Map();
    sheet.getRow(rowNumber).eachCell({includeEmpty:false},(cell,column)=>headers.set(normalizedHeader(cellValue(cell)),column));
    const columnFor={};
    for(const [field,aliases] of Object.entries(HEADER_ALIASES))columnFor[field]=aliases.map(alias=>headers.get(alias)).find(Boolean);
    if(headers.has('no')&&columnFor.scenario&&columnFor.priority&&columnFor.expectedResult&&columnFor.status)return {rowNumber,columnFor,headers};
  }
  return null;
}
function inheritedReader(sheet,header){
  const last=new Map();
  return (row,field)=>{
    const column=header.columnFor[field];
    if(!column)return '';
    const raw=cellValue(row.getCell(column));
    if(cleanText(raw)!==''){last.set(field,raw);return raw}
    return last.get(field)||'';
  };
}
function detailsFor(row,headers){
  const result={};
  for(const [name,column] of headers){
    const value=cellValue(row.getCell(column));
    if(cleanText(value)!=='')result[name]=value instanceof Date?value.toISOString():cleanText(value);
  }
  return result;
}

async function parseProductionWorkbook(buffer,source){
  const workbook=new ExcelJS.Workbook();
  try{await workbook.xlsx.load(buffer,{ignoreNodes:['dataValidations','externalLinks']})}catch{return {records:[],excludedSheets:[],errors:[{workbook:source.fileName,sheet:'Workbook',row:0,field:'Workbook',message:'The Excel workbook could not be read'}]}}
  const records=[],errors=[],excludedSheets=[],durableKeys=new Set();
  for(const sheet of workbook.worksheets){
    if(REFERENCE_SHEETS.has(cleanText(sheet.name).toLowerCase())){excludedSheets.push(sheet.name);continue}
    const header=headerIndex(sheet);
    if(!header){
      if(sheet.rowCount>1&&sheet.getSheetValues().some(value=>cleanText(value).toLowerCase().includes('status')))errors.push({workbook:source.fileName,sheet:sheet.name,row:0,field:'Worksheet',message:'Worksheet appears to contain cases but does not match a supported production layout'});
      continue;
    }
    const read=inheritedReader(sheet,header);
    const direct=(row,field)=>{
      const column=header.columnFor[field];
      return column?cellValue(row.getCell(column)):'';
    };
    const subcategory=cleanText(sheet.name);
    for(let rowNumber=header.rowNumber+1;rowNumber<=sheet.rowCount;rowNumber++){
      const row=sheet.getRow(rowNumber);if(!row.hasValues)continue;
      let formulaError=false;
      row.eachCell({includeEmpty:false},cell=>{const value=cell.value;if(value&&typeof value==='object'&&Object.hasOwn(value,'formula')&&(value.result===null||value.result===undefined)){errors.push({workbook:source.fileName,sheet:sheet.name,row:rowNumber,field:'Formula',message:'Formula cell has no cached result; recalculate and save the workbook before import'});formulaError=true}});
      if(formulaError)continue;
      const sourceCaseId=cleanText(direct(row,'sourceCaseId'));
      const scenario=cleanText(direct(row,'scenario'));
      // Production replacement uses the workbook's source Case ID as identity. Rows without one
      // are worksheet notes/continuations, not independently assignable cases.
      if(!sourceCaseId)continue;
      const priority=priorityValue(read(row,'priority'));
      // Execution results belong to each case; blank cells represent fresh Pending cases.
      const sourceStatus=cleanText(direct(row,'status'));
      const productionStatus=sourceStatus?normalizeProductionStatus(sourceStatus):'PENDING';
      if(!scenario)errors.push({workbook:source.fileName,sheet:sheet.name,row:rowNumber,field:'Scenario',message:'Scenario is required'});
      // Some supplied production rows leave Priority blank; retain them at the normal
      // operational default while preserving the source value in details.
      if(!productionStatus)errors.push({workbook:source.fileName,sheet:sheet.name,row:rowNumber,field:'Status',message:'Unsupported production status '+sourceStatus});
      const baseDurableKey=[source.channel,subcategory,sourceCaseId].map(normalizeKeyPart).join('::');
      // One supplied POS sheet repeats TC-35 for two distinct rows. Retain both source rows,
      // while preserving the original source Case ID for reporting and audit.
      const durableKey=durableKeys.has(baseDurableKey)?baseDurableKey+'::row-'+rowNumber:baseDurableKey;
      durableKeys.add(durableKey);
      records.push({durableKey,sourceCaseId,channel:cleanText(source.channel),subcategory,sourceSheet:sheet.name,priority:priority||3,
        caseType:cleanText(read(row,'caseType')),mainFeature:cleanText(read(row,'mainFeature')),subFeature:cleanText(read(row,'subFeature')),
        category:cleanText(direct(row,'category'))||null,type:cleanText(direct(row,'type'))||null,
        scenario,steps:cleanText(direct(row,'steps')),expectedResult:cleanText(direct(row,'expectedResult')),actualResult:cleanText(direct(row,'actualResult')),
        productionStatus:productionStatus||'PENDING',executedAt:dateValue(direct(row,'executedAt')),qaTester:cleanText(direct(row,'qaTester')),
        qaRemark:cleanText(direct(row,'qaRemark')),jiraLink:cleanText(direct(row,'jiraLink')),financeStatus:cleanText(direct(row,'financeStatus')),
        financeRemark:cleanText(direct(row,'financeRemark')),details:detailsFor(row,header.headers),row:rowNumber});
      if(records.length>MAX_RECORDS)errors.push({workbook:source.fileName,sheet:sheet.name,row:rowNumber,field:'Workbook',message:'Combined workbook rows exceed '+MAX_RECORDS});
    }
  }
  return {records,excludedSheets,errors};
}

module.exports={parseProductionWorkbook,cleanText,normalizeProductionStatus,normalizeKeyPart,HEADER_ALIASES};
