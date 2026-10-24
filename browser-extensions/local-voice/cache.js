import {TTL,normalize,similarity,digest} from './core.js';
const MAX_BYTES=256*1024*1024,MAX_ROWS=1000;
let dbPromise;
function db(){return dbPromise ||= new Promise((resolve,reject)=>{const r=indexedDB.open('local-role-voice',1);r.onupgradeneeded=()=>{const s=r.result.createObjectStore('audio',{keyPath:'id'});s.createIndex('partition','partition');};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function transact(mode,fn){const d=await db();return new Promise((resolve,reject)=>{const t=d.transaction('audio',mode),s=t.objectStore('audio');let result;try{result=fn(s)}catch(e){t.abort();reject(e);return;}t.oncomplete=()=>resolve(typeof result==='function'?result():result);t.onerror=()=>reject(t.error);t.onabort=()=>reject(t.error||Error('缓存操作中止'));});}
export async function rows(){let value;await transact('readonly',s=>{const r=s.getAll();r.onsuccess=()=>value=r.result;});return value;}
export async function prune(now=Date.now()){
  const list=(await rows()).sort((a,b)=>b.lastUsed-a.lastUsed);let bytes=0,n=0;const removed=[];
  for(const row of list){if(now-row.lastUsed>=TTL || n>=MAX_ROWS || bytes+row.blob.size>MAX_BYTES)removed.push(row.id);else{bytes+=row.blob.size;n++;}}
  await transact('readwrite',s=>removed.forEach(id=>s.delete(id)));return {count:n,bytes,removed:removed.length};
}
export async function lookup(scope,text,threshold,now=Date.now()) {
  await prune(now);let list;
  await transact('readonly',s=>{const r=s.index('partition').getAll(scope);r.onsuccess=()=>list=r.result;});
  const norm=normalize(text);
  const ranked=list.map(r=>({r,score:similarity(norm,r.normalized,threshold)})).filter(x=>x.score>=threshold).sort((a,b)=>b.score-a.score||b.r.lastUsed-a.r.lastUsed);
  if(!ranked.length)return null;
  const {r,score}=ranked[0];
  await transact('readwrite',s=>{const q=s.get(r.id);q.onsuccess=()=>{if(q.result)s.put({...q.result,lastUsed:now});};});
  return {...r,score,lastUsed:now};
}
export async function save(scope,text,voice,blob,now=Date.now()) {
  const normalized=normalize(text),id=await digest(scope+'\n'+normalized);
  await transact('readwrite',s=>s.put({id,partition:scope,text,normalized,voice,blob,createdAt:now,lastUsed:now}));await prune(now);
}
export const clear = ()=>transact('readwrite',s=>{s.clear();});
