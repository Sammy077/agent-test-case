'use strict';
// Shared presentation contract for server-rendered and legacy browser case views.
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.caseUI=factory()})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const fields=[['default','Default'],['caseId','Case ID'],['channel','Channel'],['classification','Classification'],['scenario','Scenario'],['priority','Priority'],['assignedUser','Assigned User'],['mainFeature','Main Feature'],['subFeature','Sub Feature']];
 function select(title,key,options,selected,legacy=false,disabled=false){return '<label>'+esc(title)+'<select '+(legacy?'data-filter':'name')+'="'+key+'"'+(disabled?' disabled':'')+'>'+options.map(([value,label])=>'<option value="'+esc(value)+'"'+(String(value)===String(selected)?' selected':'')+'>'+esc(label)+'</option>').join('')+'</select></label>'}
 function sortControls(filters={},legacy=false){const key=filters.sortBy||'default';return select('Sort By','sortBy',fields,key,legacy)+select('Order By','orderBy',[['asc','Ascending'],['desc','Descending']],filters.orderBy||'asc',legacy,key==='default')}
 function observerControls(data,legacy=false){const f=data.filters||{};return select('Priority','priority',[['','All priorities'],...[1,2,3,4].map(x=>[x,'Priority '+x])],f.priority||'',legacy)+select('Main Feature','mainFeature',[['','All main features'],...(data.availableMainFeatures||[]).map(x=>[x,x])],f.mainFeature||'',legacy)+select('Sub Feature','subFeature',[['','All sub features'],...(data.availableSubFeatures||[]).map(x=>[x,x])],f.subFeature||'',legacy)+sortControls(f,legacy)}
 function caseLabel(item){const id=item.source_case_id||item.case_code,classification=item.subcategory||item.source_sheet;return id+(classification?' · '+classification:'')}
 function uniqueReference(item){const parts=[item.channel,item.subcategory||item.source_sheet,item.source_case_id||item.case_code].filter(value=>value!=null&&value!=='');return parts.join(' / ')+' · #'+(item.test_case_id||item.id)}
 function assignedUsersHtml(item,legacy=false,security=''){
  return '<div class="assigned-user-list">'+(item.assigned_users||[]).map(user=>'<div><b>'+esc(user.code+' · '+user.name)+'</b><small>'+esc(user.status.replaceAll('_',' '))+'</small>'+(user.status==='NOT_STARTED'?(legacy?'<button type="button" class="alt" data-action="remove-case-user" data-id="'+esc(user.id)+'">Remove</button>':'<form method="post" action="/actions/assignments/'+esc(user.id)+'/remove" hx-post="/actions/assignments/'+esc(user.id)+'/remove" hx-target="#content" hx-target-4*="#action-message" hx-target-5*="#action-message">'+security+'<button class="alt">Remove</button></form>'):'')+'</div>').join('')+'</div>';
 }
 function detailsHtml(item){
  const source=item.source_details||{},details={};
  for(const [key,title]of [['master','Master'],['commission','Commission'],['fee','Fee']])if(Object.hasOwn(source,key))details[title]=source[key];
  details.Category=item.category;details.Type=item.type;
  for(const [key,value]of Object.entries(source)){
   const normalized=key.toLowerCase().replace(/[_\s]+/g,' ').trim();
   if(['master','commission','fee','category','type'].includes(normalized)||/^(standard|platinum|gold|master agent|premium) (commission|fee)\d*$/.test(normalized))continue;
   details[key.replaceAll('_',' ')]=value;
  }
  return Object.entries(details).filter(([,v])=>v!==''&&v!=null).map(([k,v])=>'<span><b>'+esc(k)+'</b>: '+esc(v)+'</span>').join('');
 }
 function clearHref(filters={}){const params=new URLSearchParams();for(const key of ['participantId','participant','sortBy','orderBy'])if(filters[key])params.set(key,filters[key]);return '/my-tests'+(params.size?'?'+params:'')}
 function returnInput(path,filters={}){const params=new URLSearchParams(filters);return '<input type="hidden" name="_returnTo" value="'+esc(path+(params.size?'?'+params:''))+'">'}
 return {sortControls,observerControls,caseLabel,uniqueReference,assignedUsersHtml,detailsHtml,clearHref,returnInput};
});
