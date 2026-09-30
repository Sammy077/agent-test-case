'use strict';
// Builds the reader fixture in memory; running this file directly also writes it for manual inspection.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');

const CRC_TABLE=(()=>{const table=new Int32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;table[n]=c}return table})();
function crc32(buffer){let c=0xffffffff;for(const byte of buffer)c=CRC_TABLE[(c^byte)&0xff]^(c>>>8);return (c^0xffffffff)>>>0}
function zip(entries){
  const chunks=[],central=[];let offset=0;
  for(const entry of entries){
    const name=Buffer.from(entry.name,'utf8'),raw=Buffer.from(entry.data,'utf8'),method=entry.store?0:8,payload=entry.store?raw:zlib.deflateRawSync(raw,{level:9}),crc=crc32(raw);
    const header=Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(20,4);header.writeUInt16LE(0,6);header.writeUInt16LE(method,8);header.writeUInt16LE(0x21,10);header.writeUInt16LE(0x21,12);header.writeUInt32LE(crc,14);header.writeUInt32LE(payload.length,18);header.writeUInt32LE(raw.length,22);header.writeUInt16LE(name.length,26);header.writeUInt16LE(0,28);
    const record=Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50,0);record.writeUInt16LE(20,4);record.writeUInt16LE(20,6);record.writeUInt16LE(0,8);record.writeUInt16LE(method,10);record.writeUInt16LE(0x21,12);record.writeUInt16LE(0x21,14);record.writeUInt32LE(crc,16);record.writeUInt32LE(payload.length,20);record.writeUInt32LE(raw.length,24);record.writeUInt16LE(name.length,28);record.writeUInt32LE(0,30);record.writeUInt16LE(0,34);record.writeUInt16LE(0,36);record.writeUInt16LE(0,38);record.writeUInt32LE(offset,42);
    chunks.push(header,name,payload);central.push(record,name);offset+=header.length+name.length+payload.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([...chunks,directory,end]);
}
// The bank workbook prefixes every element name (x:sheet, x:sst, x:si, x:t, x:worksheet, x:row, x:c, x:v); the fixture mirrors that.
const NS='xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
const cell=(ref,value,type='')=>'<x:c r="'+ref+'"'+(type?' t="'+type+'"':'')+'>'+(value===''?'':'<x:v>'+value+'</x:v>')+'</x:c>';
const inline=(ref,text)=>'<x:c r="'+ref+'" t="inlineStr"><x:is><x:t>'+text+'</x:t></x:is></x:c>';
const row=(number,cells)=>'<x:row r="'+number+'">'+cells+'</x:row>';

const headers=['Record Key','Platform','Test Case ID','Priority Level','Service / Main Feature','Sub Feature','Test Scenario','Expected Result','Execute Date','TID','Status','QA Tester','Finance Status','Finance Remark'];
const data=[
  ['R-1','WCX POS Standard','CR-1','Critical','Cash In','Manual','Scenario 1','Pass','46200','','Not executed','','Not Verify Yet',''],
  ['R-2','WCX eKYC Android','CR-2','Critical','Login','Verify','Scenario 2','Pass','','N/A','Passed','Koemly Hort','No Perform TXN',''],
  ['R-3','Wing eKYC iOS','CR-3','Critical','Cash Out','QR','Scenario 3','Fail','','','Failed','Det Dam','Incorrect',''],
  ['R-4','Other Bank','CR-4','Critical','Cash Out','Bakong','Scenario 4','Pass','','T-9','Retest Required','Det Dam','Correct',''],
  ['R-5','WCX POS Premium','NC-1','None-Critical','Cash In','Manual','Scenario 5','Pass','','T-10','Passed','Koemly Hort','Correct',''],
  ['R-6','WCX POS Standard','NC-2','None-Critical','Cash In','Manual','Scenario 6','Pass','','','Not executed','','Not Verify Yet',''],
  ['R-7','Some Bank','CR-5','Critical','Cash Out','Swift','Scenario 7','Pass','','','In Progress','Sakhorn Pok','Not Verify Yet',''],
];
// Every text value goes through the shared string table. One entry uses two rich-text runs.
const runs=[...headers.map(name=>[name]),...data.flat().filter(value=>value&&!/^\d+$/.test(value)).map(value=>[value]),['Cash ','In']];
const shared=[...new Map(runs.map(item=>[item.join(''),item])).values()];
const sharedXml='<?xml version="1.0" encoding="UTF-8"?><x:sst '+NS+' count="'+shared.length+'" uniqueCount="'+shared.length+'">'+shared.map(item=>'<x:si>'+item.map(run=>'<x:t>'+run+'</x:t>').join('')+'</x:si>').join('')+'</x:sst>';
const stringIndex=value=>{const index=shared.findIndex(item=>item.join('')===value);if(index<0)throw Error('Fixture string missing from the shared table: '+value);return index};
const columnName=index=>{let name='',value=index+1;while(value>0){const remainder=(value-1)%26;name=String.fromCharCode(65+remainder)+name;value=Math.floor((value-1)/26)}return name};
const dataXml=data.map((values,index)=>{
  const cells=values.map((value,column)=>{
    const ref=columnName(column)+(index+4);
    if(value==='')return cell(ref,'');
    if(value==='Scenario 3')return inline(ref,value);
    return /^\d+$/.test(value)?cell(ref,value):cell(ref,stringIndex(value),'s');
  });
  return row(index+4,cells.join(''));
}).join('');

const sheetXml='<?xml version="1.0" encoding="UTF-8"?><x:worksheet '+NS+'><x:sheetData>'
  +row(1,inline('A1','MASTER - All Test Cases fixture'))
  +row(2,'')
  +row(3,headers.map((name,index)=>cell(columnName(index)+'3',stringIndex(name),'s')).join(''))
  +dataXml
  +'</x:sheetData></x:worksheet>';
const notesXml='<?xml version="1.0" encoding="UTF-8"?><x:worksheet '+NS+'><x:sheetData>'+row(1,inline('A1','Notes are not the master sheet'))+'</x:sheetData></x:worksheet>';

const workbookXml='<?xml version="1.0" encoding="UTF-8"?><x:workbook '+NS+' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><x:sheets><x:sheet name="MASTER - All Test Cases" sheetId="1" r:id="rId1"/><x:sheet name="Notes" sheetId="2" r:id="rId2"/></x:sheets></x:workbook>';
// Absolute targets are what break exceljs 4.4.0; keep them so the regression is locked in.
const relsXml='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="/xl/sharedStrings.xml"/></Relationships>';
const rootRels='<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
const contentTypes='<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>';

const buffer=zip([
  {name:'[Content_Types].xml',data:contentTypes,store:true},
  {name:'_rels/.rels',data:rootRels},
  {name:'xl/workbook.xml',data:workbookXml},
  {name:'xl/_rels/workbook.xml.rels',data:relsXml},
  {name:'xl/sharedStrings.xml',data:sharedXml},
  {name:'xl/worksheets/sheet1.xml',data:sheetXml},
  {name:'xl/worksheets/sheet2.xml',data:notesXml,store:true},
]);
module.exports={buildFixture:()=>buffer};
if(require.main===module){
  const target=path.join(__dirname,'master-critical.xlsx');
  fs.writeFileSync(target,buffer);
  console.log('Wrote '+target+' ('+buffer.length+' bytes)');
}
