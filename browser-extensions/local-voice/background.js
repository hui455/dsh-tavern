
async function injectTab(tab, config) {
  if (!Number.isInteger(tab.id) || !siteAllowed(tab.url, config)) return;
  try { await chrome.scripting.executeScript({target:{tabId:tab.id,allFrames:true},files:['content.js']}); } catch { /* Unavailable or ungranted pages stay untouched. */ }
}
async function injectExistingTabs(){const config=(await chrome.storage.local.get('settings')).settings;for(const tab of await chrome.tabs.query({}))await injectTab(tab,config);}
function senderAllowed(sender,config){
  if(sender.url?.startsWith(chrome.runtime.getURL('')))return true;
  return siteAllowed(sender.tab?.url,config) && siteAllowed(sender.origin && sender.origin !== 'null' ? sender.origin : sender.url,config);
}
async function updateMenu(){
  const config=(await chrome.storage.local.get('settings')).settings;
  const origins=config?.allowedOrigins ?? defaults.allowedOrigins;
  await chrome.contextMenus.removeAll();
  if(origins.length)chrome.contextMenus.create({id:'read-local',title:'用本地角色朗读选中文字',contexts:['selection'],documentUrlPatterns:origins.map(x=>{const u=new URL(x);return u.protocol+'//'+u.hostname+'/*';})});
}
chrome.tabs.onUpdated.addListener((id,change,tab)=>{if(change.status==='complete')void chrome.storage.local.get('settings').then(r=>injectTab(tab,r.settings));});
import {fetchVoices} from './voices.js';
let refreshingVoices;
async function refreshVoices(){if(refreshingVoices)return refreshingVoices;return refreshingVoices=(async()=>{const saved=settings((await chrome.storage.local.get('settings')).settings);const next=await fetchVoices(saved);const latest=settings((await chrome.storage.local.get('settings')).settings);if(latest.baseUrl!==saved.baseUrl||latest.apiKey!==saved.apiKey)throw Error('配置已变化，请重新刷新音色。');await chrome.storage.local.set({settings:{...latest,voices:next.voices,voice:next.voices.some(v=>v.id===latest.voice)?latest.voice:next.voice}});return {ok:true,count:next.voices.length};})().finally(()=>refreshingVoices=null);}
import {defaults,settings,siteAllowed} from './core.js';
function publicSettings(s={}){const c={...defaults,...s};return {voice:c.voice,voices:c.voices,maxChars:c.maxChars,toolbar:c.toolbar};}
chrome.storage.local.setAccessLevel({accessLevel:'TRUSTED_CONTEXTS'});
chrome.storage.onChanged.addListener(async(c,area)=>{if(area==='local'&&c.settings){for(const tab of await chrome.tabs.query({}))chrome.tabs.sendMessage(tab.id,{type:'settings-changed'}).catch(()=>{});await updateMenu();await injectExistingTabs();}});
let creating;
async function offscreen(){
  if(await chrome.offscreen.hasDocument())return;
  if(!creating)creating=chrome.offscreen.createDocument({url:'offscreen.html',reasons:['BLOBS'],justification:'生成音频 Blob、持久缓存，并从 Blob URL 播放本地合成语音。'}).finally(()=>creating=null);
  await creating;
}
async function setup(){await injectExistingTabs();await updateMenu();await chrome.alarms.create('voice-expire',{periodInMinutes:60});await offscreen();await chrome.runtime.sendMessage({target:'audio',type:'prune'});void refreshVoices().catch(()=>{});}
chrome.runtime.onInstalled.addListener(()=>void setup());
chrome.runtime.onStartup.addListener(()=>void setup());
chrome.alarms.onAlarm.addListener(async a=>{if(a.name==='voice-expire'){await offscreen();await chrome.runtime.sendMessage({target:'audio',type:'prune'});}});
chrome.contextMenus.onClicked.addListener(async(info,tab)=>{if(info.menuItemId==='read-local'){const config=(await chrome.storage.local.get('settings')).settings;if(!siteAllowed(tab?.url,config)||!siteAllowed(info.frameUrl||info.pageUrl||tab?.url,config))return;const requestId=crypto.randomUUID();if(tab?.id)await chrome.tabs.sendMessage(tab.id,{type:'voice-start',requestId},{frameId:info.frameId??0}).catch(()=>{});await offscreen();await chrome.runtime.sendMessage({target:'audio',type:'speak',settings:(await chrome.storage.local.get('settings')).settings,text:info.selectionText,tabId:tab?.id,frameId:info.frameId??0,requestId});}});
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || m.target==='audio')return;
  if(m.type==='refresh-voices'){refreshVoices().then(reply,e=>reply({ok:false,error:e.message}));return true;}
  if(m.type==='public-settings'){chrome.storage.local.get('settings').then(r=>reply({...publicSettings(r.settings),allowed:senderAllowed(sender,r.settings)}));return true;}
  if(m.type==='audio-status'){
    if(Number.isInteger(m.tabId))chrome.tabs.sendMessage(m.tabId,m,{frameId:m.frameId??0}).catch(()=>{});
    chrome.storage.session.set({lastStatus:m});return;
  }
  if(!['speak','stop','stats','clear','prune'].includes(m.type))return;
  (async()=>{const config=(await chrome.storage.local.get('settings')).settings;if(!senderAllowed(sender,config))return {ok:false,error:'当前网站不在朗读白名单中。'};await offscreen();return chrome.runtime.sendMessage({...m,target:'audio',...(m.type==='speak'?{settings:(await chrome.storage.local.get('settings')).settings}:{}),tabId:sender.tab?.id??m.tabId,frameId:sender.frameId??0});})().then(reply,e=>reply({ok:false,error:e.message}));return true;
});
