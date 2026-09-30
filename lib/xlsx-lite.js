'use strict';
const zlib=require('node:zlib');

const fail=(message)=>{throw Object.assign(Error(message),{status:400})};
const ZIP_EOCD=0x06054b50,ZIP_CENTRAL=0x02014b50,ZIP_LOCAL=0x04034b50;
const zipCache=new WeakMap();

function zipEntries(buffer){
  if(zipCache.has(buffer))return zipCache.get(buffer);
  let end=-1;
  for(let index=buffer.length-22;index>=0&&index>=buffer.length-22-65535;index--)if(buffer.readUInt32LE(index)===ZIP_EOCD){end=index;break}
  if(end<0)fail('The uploaded file is not a readable .xlsx workbook');
  const count=buffer.readUInt16LE(end+10),start=buffer.readUInt32LE(end+16),entries=new Map();
  let offset=start;
  for(let index=0;index<count;index++){
    if(offset+46>buffer.length||buffer.readUInt32LE(offset)!==ZIP_CENTRAL)fail('The uploaded .xlsx workbook is corrupt');
    const method=buffer.readUInt16LE(offset+10),compressedSize=buffer.readUInt32LE(offset+20),nameLength=buffer.readUInt16LE(offset+28),extraLength=buffer.readUInt16LE(offset+30),commentLength=buffer.readUInt16LE(offset+32),localOffset=buffer.readUInt32LE(offset+42);
    entries.set(buffer.toString('utf8',offset+46,offset+46+nameLength),{method,compressedSize,localOffset});
    offset+=46+nameLength+extraLength+commentLength;
  }
  zipCache.set(buffer,entries);
  return entries;
}
function readEntry(buffer,name){
  const entry=zipEntries(buffer).get(name);
  if(!entry)return null;
  const offset=entry.localOffset;
  if(offset+30>buffer.length||buffer.readUInt32LE(offset)!==ZIP_LOCAL)fail('The uploaded .xlsx workbook is corrupt');
  const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28),payload=buffer.subarray(start,start+entry.compressedSize);
  try{
    if(entry.method===0)return payload;
    if(entry.method===8)return zlib.inflateRawSync(payload);
    return fail('Unsupported zip compression method '+entry.method);
  }catch(error){
    if(error.status)throw error;
    return fail('The uploaded .xlsx workbook is corrupt');
  }
}
function readText(buffer,name){
  const data=readEntry(buffer,name);
  return data===null?null:data.toString('utf8');
}
function decodeXml(value){
  return value.replace(/&#x([0-9a-fA-F]+);/g,(match,hex)=>String.fromCodePoint(parseInt(hex,16)))
    .replace(/&#(\d+);/g,(match,code)=>String.fromCodePoint(Number(code)))
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
}
function elements(xml,tag){
  // Prefixed (x:row) and unprefixed (row) element names must both match: the supplied workbook prefixes every element.
  const pattern=new RegExp('<(?:\\w+:)?'+tag+'(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)<\\/(?:\\w+:)?'+tag+'>)','g'),out=[];
  let match;
  while((match=pattern.exec(xml))!==null)out.push({attributes:match[0].slice(0,match[0].indexOf('>')+1),body:match[1]||''});
  return out;
}
function attribute(opening,name){
  const pattern=new RegExp('(?:\\s|:)'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'="([^"]*)"');
  const match=opening.match(pattern);
  return match?decodeXml(match[1]):'';
}
function columnNumber(reference){
  const letters=(reference.match(/^[A-Z]+/)||[''])[0];
  let value=0;
  for(const letter of letters)value=value*26+(letter.charCodeAt(0)-64);
  return value;
}
function sharedStrings(buffer){
  const xml=readText(buffer,'xl/sharedStrings.xml');
  if(!xml)return [];
  return elements(xml,'si').map(item=>elements(item.body,'t').map(run=>decodeXml(run.body)).join(''));
}
function cellText(opening,body,shared){
  const type=attribute(opening,'t');
  if(type==='inlineStr')return elements(body,'t').map(run=>decodeXml(run.body)).join('');
  const value=elements(body,'v')[0];
  if(!value)return '';
  const raw=decodeXml(value.body);
  if(type==='s'){const index=Number(raw);return Number.isInteger(index)&&shared[index]!==undefined?shared[index]:''}
  return raw;
}
function sheetPath(buffer,name){
  const workbook=readText(buffer,'xl/workbook.xml');
  const rels=readText(buffer,'xl/_rels/workbook.xml.rels');
  if(!workbook||!rels)fail('The uploaded .xlsx workbook has no workbook parts');
  const relationships=new Map(elements(rels,'Relationship').map(item=>[attribute(item.attributes,'Id'),attribute(item.attributes,'Target')]));
  const sheet=elements(workbook,'sheet').find(item=>attribute(item.attributes,'name')===name);
  const available=elements(workbook,'sheet').map(item=>attribute(item.attributes,'name'));
  if(!sheet)fail('Sheet "'+name+'" was not found. Available sheets: '+available.join(', '));
  const target=relationships.get(attribute(sheet.attributes,'r:id'))||'';
  if(!target)fail('Sheet "'+name+'" has no workbook relationship');
  // Supplied workbooks use absolute targets ("/xl/..."); exceljs 4.4.0 rejects those, so normalize here.
  const trimmed=target.startsWith('/')?target.slice(1):target.startsWith('xl/')?target:'xl/'+target.replace(/^\.?\//,'');
  return {path:trimmed,available};
}
function readSheetRows(buffer,sheetName){
  const resolved=sheetPath(buffer,sheetName);
  const xml=readText(buffer,resolved.path);
  if(!xml)fail('Sheet "'+sheetName+'" could not be read from the uploaded workbook');
  const shared=sharedStrings(buffer),rows=[];
  for(const row of elements(xml,'row')){
    const values={};
    for(const cell of elements(row.body,'c')){
      const reference=attribute(cell.attributes,'r');
      if(!reference)continue;
      values[columnNumber(reference)]=cellText(cell.attributes,cell.body,shared);
    }
    rows.push(values);
  }
  return rows;
}
function readRecords(buffer,{sheetName,required,wanted}){
  const resolved=sheetPath(buffer,sheetName);
  const rows=readSheetRows(buffer,sheetName);
  let headerRow=-1,headers={};
  for(let index=0;index<Math.min(rows.length,20);index++){
    const present=new Set(Object.values(rows[index]).map(value=>String(value).trim()).filter(Boolean));
    // Anchor on the first required column so a header row that exists but lacks some columns is reported
    // as missing columns rather than as an absent header row.
    if(present.has(required[0])){headerRow=index;headers=Object.fromEntries(Object.entries(rows[index]).map(([column,value])=>[Number(column),String(value).trim()]));break}
  }
  if(headerRow<0)fail('Could not find the Master header row (looking for '+required.join(', ')+'). Available sheets: '+resolved.available.join(', '));
  const columns={};
  for(const [column,name] of Object.entries(headers))columns[name]=Number(column);
  const missing=required.filter(name=>!columns[name]);
  if(missing.length)fail('Missing columns in sheet "'+sheetName+'": '+missing.join(', '));
  const records=rows.slice(headerRow+1).map(row=>({row,record:Object.fromEntries(wanted.filter(name=>columns[name]).map(name=>[name,String(row[columns[name]]??'').trim()]))}));
  return {records:records.map(item=>item.record),headerRow,headers,sheetNames:resolved.available};
}

module.exports={readSheetRows,readRecords,zipEntries};
