import {settings,validateText,partition} from './core.js';
import * as cache from './cache.js';
let generation=0,active=null,playing=null,blobUrl=null,finishPlayback=null,draining=false;
const queue=[];
function invalidate(message){generation++;stop();if(active)report(active,'stopped',{message});active=null;for(const m of queue.splice(0))report(m,'stopped',{message:'已取消排队。'});}
async function drain(){
  if(draining)return;draining=true;
  try{while(queue.length){const m=queue.shift();await run(m);if(active===m)active=null;}}
  finally{draining=false;}
}
function stop(){if(playing){playing.onended=null;playing.onerror=null;playing.pause();playing=null;}if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl=null;}if(finishPlayback){const done=finishPlayback;finishPlayback=null;done();}}
function report(m,state,extra={}){chrome.runtime.sendMessage({type:'audio-status',requestId:m.requestId,tabId:m.tabId,frameId:m.frameId,state,...extra}).catch(()=>{});}
async function run(m){
  const current= generation;active=m;
  const isCurrent=()=>current===generation;
  try{
    const s=settings(m.settings),voice=m.voice||s.voice;
    if(!s.voices.some(v=>v.id===voice))throw Error('角色不存在，请在设置里添加音色。');
    const text=validateText(m.text,s.maxChars),scope=await partition(s,voice);
    if(!isCurrent())return;
    report(m,'checking',{message:'检查该角色的缓存…'});
    const hit=await cache.lookup(scope,text,s.similarity);
    if(!isCurrent())return;
    let blob=hit?.blob,warning='';
    if(!blob){
      report(m,'generating',{message:'本地生成中…（停止播放不会取消服务端生成）'});
      const r=await fetch(s.baseUrl+'/audio/speech',{method:'POST',headers:{'content-type':'application/json',...(s.apiKey?{authorization:'Bearer '+s.apiKey}:{})},body:JSON.stringify({model:s.model,voice,input:text,response_format:'mp3'}),redirect:'error',signal:AbortSignal.timeout(300000)});
      if(!r.ok){await r.body?.cancel();throw Error('语音接口返回 HTTP '+r.status+'，请检查本地服务及音色配置。');}
      const type=(r.headers.get('content-type')||'').split(';')[0];
      if(!['audio/mpeg','audio/mp3','audio/wav','audio/x-wav','audio/ogg','application/octet-stream'].includes(type)){await r.body?.cancel();throw Error('接口没有返回音频。');}
      const chunks=[];let bytes=0;
      for await(const chunk of r.body){bytes+=chunk.length;if(bytes>20*1024*1024)throw Error('音频超过 20 MB。');chunks.push(chunk);}
      if(bytes<32)throw Error('接口返回的音频为空或不完整。');
      blob=new Blob(chunks,{type:type==='application/octet-stream'?'audio/mpeg':type});
      try{await cache.save(scope,text,voice,blob);}catch{warning='本次音频未能写入缓存；仍可播放。';}
    }
    if(!isCurrent())return;
    const info={message:hit?(hit.score===1?'命中缓存':'复用相似缓存 '+Math.round(hit.score*100)+'%'):'生成完成',actualText:hit?.text||text,selectedText:text,voice,cacheHit:!!hit,score:hit?.score||0,warning};
    await new Promise((resolve,reject)=>{
      finishPlayback=resolve;
      blobUrl=URL.createObjectURL(blob);playing=new Audio(blobUrl);
      playing.onended=()=>{if(!isCurrent())return;report(m,'ended',{...info,message:'播放完成'});stop();};
      playing.onerror=()=>{if(!isCurrent())return;report(m,'error',{message:'音频无法解码或播放，请检查接口输出。'});stop();};
      playing.play().then(()=>{if(isCurrent())report(m,'playing',{...info,message:'正在播放 · '+info.message});},reject);
    });
  }catch(e){if(!isCurrent())return;active=null;stop();report(m,'error',{message:e.name==='TimeoutError'?'等待语音接口超时；未自动重试。':e.message||'语音失败，请检查本地接口。'});}
}
chrome.runtime.onMessage.addListener((m,sender,reply)=>{
  if(sender.id!==chrome.runtime.id || m.target!=='audio')return;
  if(m.type==='ready'){reply({ok:true,ready:true});return;}
  if(m.type==='speak'){queue.push(m);reply({ok:true,requestId:m.requestId});if(draining)report(m,'queued',{message:'已加入朗读队列，将按点击顺序播放。'});void drain();return;}
  if(m.type==='stop'){invalidate('已停止播放；已提交的生成会完成并缓存。');reply({ok:true});return;}
  const op=m.type==='clear'?cache.clear().then(()=>cache.prune()):cache.prune();
  op.then(stats=>reply({ok:true,...stats}),e=>reply({ok:false,error:e.message}));return true;
});
