'use strict';
(()=>{
 const indicator=document.createElement('div');
 indicator.className='request-loading';indicator.hidden=true;
 indicator.setAttribute('role','status');indicator.setAttribute('aria-live','polite');
 indicator.innerHTML='<div class="loader" aria-hidden="true"></div><span>Loading…</span>';
 document.body.appendChild(indicator);
 let pending=0,timer;
 const controls=new WeakMap(),requests=new WeakMap();
 function begin(element){
  if(!indicator.isConnected)document.body.appendChild(indicator);
  const buttons=element?.matches('form')?[...element.querySelectorAll('button[type="submit"],button:not([type]),input[type="submit"]')]:element?.matches('button,input[type="submit"]')?[element]:[];
  for(const button of buttons){let state=controls.get(button);if(!state){state={count:0,disabled:button.disabled};controls.set(button,state)}state.count++;button.disabled=true;button.setAttribute('aria-busy','true')}
  if(pending++===0)timer=setTimeout(()=>{indicator.hidden=false},300);
  let finished=false;
  return ()=>{
   if(finished)return;finished=true;
   for(const button of buttons){const state=controls.get(button);if(--state.count===0){button.disabled=state.disabled;button.removeAttribute('aria-busy');controls.delete(button)}}
   if(--pending===0){clearTimeout(timer);indicator.hidden=true}
  };
 }
 window.requestLoading={begin,async run(task,element){const end=begin(element);try{return await task()}finally{end()}}};
 document.addEventListener('htmx:beforeRequest',event=>{const {xhr,elt}=event.detail;if(xhr&&!requests.has(xhr))requests.set(xhr,begin(elt))});
 const finish=event=>{const xhr=event.detail.xhr,end=xhr&&requests.get(xhr);if(end){end();requests.delete(xhr)}};
 for(const name of ['htmx:afterRequest','htmx:sendError','htmx:timeout','htmx:abort'])document.addEventListener(name,finish);
})();
