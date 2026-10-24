import {settings,count} from './core.js';
const $=id=>document.getElementById(id);let s=settings((await chrome.storage.local.get('settings')).settings),id;
$('voice').replaceChildren(...s.voices.map(v=>new Option(v.name,v.id)));$('voice').value=s.voice;
function counter(){const n=count($('text').value.trim());$('counter').textContent=n+' / '+s.maxChars+' 字';$('play').disabled=!n||n>s.maxChars;}
$('text').oninput=counter;counter();
function display(m){$('status').textContent=m.message+(m.cacheHit&&m.score<1?'\n实际朗读：'+m.actualText:'')+(m.warning?'\n'+m.warning:'');}
const old=(await chrome.storage.session.get('lastStatus')).lastStatus;if(old)display(old);
chrome.runtime.onMessage.addListener(m=>{if(m.type==='audio-status'&&(!id||m.requestId===id))display(m);});
$('play').onclick=async()=>{id=crypto.randomUUID();$('status').textContent='准备朗读…';const r=await chrome.runtime.sendMessage({type:'speak',requestId:id,text:$('text').value,voice:$('voice').value});if(!r?.ok)$('status').textContent=r?.error||'无法连接扩展';};
$('stop').onclick=()=>{chrome.runtime.sendMessage({type:'stop'});$('status').textContent='已停止播放；已提交的生成会完成并缓存。';};
$('settings').onclick=()=>chrome.runtime.openOptionsPage();

chrome.storage.onChanged.addListener((c,area)=>{if(area==='local'&&c.settings){s=settings(c.settings.newValue);$('voice').replaceChildren(...s.voices.map(v=>new Option(v.name,v.id)));$('voice').value=s.voice;counter();}});
void chrome.runtime.sendMessage({type:'refresh-voices'}).catch(()=>{});

$('voice').onchange=async()=>{try{const r=await chrome.runtime.sendMessage({type:'set-voice',voice:$('voice').value});if(!r.ok)throw Error(r.error);}catch(e){$('status').textContent='音色偏好未保存：'+e.message;}};
