'use strict';
(()=>{
 const root=document.getElementById('my-agent-app');if(!root)return;
 window.myAgentController?.abort();const controller=new AbortController();window.myAgentController=controller;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let data,busy=false;
 root.innerHTML='<div class="my-agent-message" role="status"></div><section id="my-agent-overview"></section>';
 const message=text=>{root.querySelector('.my-agent-message').textContent=text};
 async function api(path='',body){const response=await fetch('/api/my-agent/loop'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name="csrf-token"]')?.content||''},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal});const result=await response.json();if(!response.ok)throw Error(result.error||'Request failed');return result}
 function render(){
  const overview=root.querySelector('#my-agent-overview'),open=overview.querySelector('.my-agent-history')?.open;
  overview.innerHTML='<section class="page-context my-agent-heading"><div><h2>My Agent</h2><p class="sub">'+escape(data.source)+' · Round '+data.round+' / '+data.totalRounds+'</p></div><div class="my-agent-actions"><button class="alt" data-action="back"'+(busy||data.round===1?' disabled':'')+'>← Back Round</button><button data-action="next"'+(busy?' disabled':'')+'>'+(data.round===data.totalRounds?'Next Round → R1':'Next Round →')+'</button></div></section>'+
  '<div class="my-agent-card-grid">'+data.items.map(item=>{const person=item.participant,feature=item.feature;return '<section class="card my-agent-workload-card"><h2>'+escape(person?person.code+' · '+person.name:'Tester '+item.tester)+'</h2><div class="my-agent-loop-feature"><b>'+escape(feature.id)+' · '+escape(feature.name)+'</b><p>Required material: '+escape(feature.material)+'</p><p>Customer required live: '+escape(feature.customerLive)+'</p></div></section>'}).join('')+'</div>'+
  '<details class="card my-agent-history"><summary>Workbook Schedule</summary><div class="my-agent-feature-key"><h3>Feature details</h3><dl>'+data.schedule.features.map(f=>'<div><dt>'+escape(f.id)+'</dt><dd><b>'+escape(f.name)+'</b><span>'+escape(f.material)+' · Customer live: '+escape(f.customerLive)+'</span></dd></div>').join('')+'</dl></div><p class="my-agent-schedule-help">Feature IDs show each agent’s assignment. Feature details above. Highlighted row = displayed round.</p><div class="table-scroll" tabindex="0" role="region" aria-label="Eleven-round workbook schedule"><table class="my-agent-schedule-table"><thead><tr><th>Round</th>'+data.items.map(i=>'<th>'+escape(i.participant?.code||'Tester '+i.tester)+'</th>').join('')+'</tr></thead><tbody>'+data.schedule.rounds.map((round,index)=>'<tr'+(data.round===index+1?' class="my-agent-selected"':'')+'><th scope="row">'+escape(round.name)+'</th>'+round.items.map(item=>{const feature=data.schedule.features.find(f=>f.id===item.featureId);return '<td><span class="my-agent-feature-code" title="'+escape(feature.name+' · '+feature.material)+'">'+escape(feature.id)+'</span></td>'}).join('')+'</tr>').join('')+'</tbody></table></div></details>';
  overview.querySelector('.my-agent-history').open=!!open;
 }
 async function load(){data=await api();if(root.isConnected)render()}
 root.addEventListener('click',async event=>{const button=event.target.closest('[data-action]');if(!button||busy)return;busy=true;render();try{await api(button.dataset.action==='back'?'/back':'/next',{round:data.round});await load();message('')}catch(e){if(e.name!=='AbortError')message(e.message)}finally{busy=false;if(data&&root.isConnected)render()}},{signal:controller.signal});
 load().catch(e=>message(e.message));
 const timer=setInterval(()=>{if(!root.isConnected){controller.abort();return}if(!busy)load().catch(e=>{if(e.name!=='AbortError')message('Live refresh unavailable: '+e.message)})},10000);
 controller.signal.addEventListener('abort',()=>clearInterval(timer),{once:true});
})();
