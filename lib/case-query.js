'use strict';

const SORT_FIELDS=Object.freeze({
 caseId:"COALESCE(NULLIF(tc.source_case_id,''),tc.case_code)",channel:'tc.channel',
 classification:"COALESCE(NULLIF(tc.subcategory,''),tc.source_sheet)",scenario:'tc.title',
 priority:'tc.priority',assignedUser:'p.name',mainFeature:'tc.main_feature',subFeature:'tc.sub_feature'
});
function sortSelection(url){
 const sortBy=url.searchParams.get('sortBy')??'default',orderBy=url.searchParams.get('orderBy')??'asc';
 if((sortBy!=='default'&&!Object.hasOwn(SORT_FIELDS,sortBy))||!['asc','desc'].includes(orderBy))throw Object.assign(Error('Unsupported Sort By or Order By'),{status:400});
 return {sortBy,orderBy};
}
function caseIdTerms(direction,blank){
 const field=SORT_FIELDS.caseId;
 // Compare trailing digit runs by significant length, then digits. Avoid integer
 // casts so long source IDs stay exact; leading zeroes remain equal numeric IDs.
 const prefix=`RTRIM(${field},'0123456789')`;
 const digits=`LTRIM(SUBSTR(${field},LENGTH(${prefix})+1),'0')`;
 return [blank(field),`${prefix} COLLATE NOCASE ${direction}`,`LENGTH(${digits}) ${direction}`,`${digits} COLLATE NOCASE ${direction}`];
}
function caseOrder(url,defaultOrder,id='tc.id'){
 const {sortBy,orderBy}=sortSelection(url);
 if(sortBy==='default')return defaultOrder+', '+id+' ASC';
 const field=SORT_FIELDS[sortBy],direction=orderBy.toUpperCase();
 const blank=expression=>`CASE WHEN ${expression} IS NULL OR TRIM(${expression})='' THEN 1 ELSE 0 END ASC`;
 const terms=sortBy==='caseId'?caseIdTerms(direction,blank):[blank(field),field+(sortBy==='priority'?'':' COLLATE NOCASE')+' '+direction];
 if(sortBy==='classification')terms.push(...caseIdTerms('ASC',blank));
 if(sortBy==='assignedUser')terms.push(blank('p.code'),'p.code COLLATE NOCASE '+direction);
 terms.push(id+' ASC');return terms.join(', ');
}
function observerCaseFilter(url){
 const sql=[],args=[],priority=url.searchParams.get('priority');
 if(priority){if(!/^[1-4]$/.test(priority))throw Object.assign(Error('Priority must be 1–4'),{status:400});sql.push('tc.priority=?');args.push(Number(priority))}
 for(const [key,column] of [['mainFeature','main_feature'],['subFeature','sub_feature']]){
  const value=url.searchParams.get(key);if(value){sql.push('tc.'+column+'=?');args.push(value)}
 }
 return {sql:sql.length?' AND '+sql.join(' AND '):'',args};
}
module.exports={caseOrder,sortSelection,observerCaseFilter};
