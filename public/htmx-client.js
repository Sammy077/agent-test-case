'use strict';
document.addEventListener('htmx:configRequest',event=>{const token=document.querySelector('meta[name="csrf-token"]')?.content;if(token)event.detail.headers['X-CSRF-Token']=token});
document.addEventListener('htmx:sseOpen',()=>{const live=document.querySelector('.live');if(live){live.dataset.connection='live';live.textContent='LIVE UPDATES'}});
document.addEventListener('htmx:sseError',()=>{const live=document.querySelector('.live');if(live){live.dataset.connection='offline';live.textContent='RECONNECTING'}});
let countdownTimer;
function setupCountdown(){clearInterval(countdownTimer);const element=document.querySelector('[data-countdown]'),target=Date.parse(element?.dataset.countdown);if(!element||!Number.isFinite(target))return;const tick=()=>{const left=Math.max(0,target-Date.now()),values=[Math.floor(left/86400000),Math.floor(left%86400000/3600000),Math.floor(left%3600000/60000),Math.floor(left%60000/1000)];element.innerHTML=values.map((value,index)=>'<div><b>'+String(value).padStart(2,'0')+'</b><small>'+['DAYS','HOURS','MIN','SEC'][index]+'</small></div>').join('')};tick();countdownTimer=setInterval(tick,1000)}
document.addEventListener('DOMContentLoaded',setupCountdown);
function syncPageMode(url){let path;try{path=new URL(url,location.href).pathname}catch{path=location.pathname}const tvPath=path.startsWith('/tv/'),section=tvPath?path.split('/')[2]:'';document.body.className=tvPath?'tv tv-'+section:'';if(path==='/my-agent')document.body.classList.add('my-agent-page')}
document.addEventListener('htmx:beforeSwap',event=>syncPageMode(event.detail.xhr?.responseURL||location.href));
function setupNavigation(){const button=document.querySelector('.menu-toggle'),navigation=document.querySelector('#workspace-navigation');if(!button||!navigation)return;document.body.classList.add('nav-enhanced');button.onclick=()=>button.setAttribute('aria-expanded',String(button.getAttribute('aria-expanded')!=='true'));navigation.onclick=event=>{if(event.target.closest('a'))button.setAttribute('aria-expanded','false')}}
function updateSelection(){const boxes=[...document.querySelectorAll('.case-select')],checked=boxes.filter(x=>x.checked),count=document.querySelector('#selected-count');if(count)count.textContent=String(checked.length)}
document.addEventListener('click',event=>{if(event.target.closest('[data-back]')){if(history.length>1)history.back();else location.href='/tv/management'}if(event.target.id==='select-page'){document.querySelectorAll('.case-select').forEach(x=>x.checked=event.target.checked);updateSelection()}});
document.addEventListener('change',event=>{if(event.target.matches('.case-select'))updateSelection()});
document.addEventListener('DOMContentLoaded',()=>{syncPageMode(location.href);setupNavigation()});
document.addEventListener('htmx:afterSwap',event=>{syncPageMode(event.detail.xhr?.responseURL||location.href);setupCountdown();setupNavigation();updateSelection()});
// Capture before HTMX handles the form change so disabled Order By is enabled in time.
document.addEventListener('change',event=>{if(event.target.name!=='sortBy')return;const order=event.target.closest('form')?.querySelector('[name="orderBy"]');if(order)order.disabled=event.target.value==='default'},true);

// Assignment controls add users; existing assignments stay intact.
