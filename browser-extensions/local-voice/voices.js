import {defaults,settings} from './core.js';
export async function fetchVoices(config, fetcher=fetch) {
 const s=settings(config);
 const r=await fetcher(s.baseUrl+'/audio/voices',{headers:s.apiKey?{authorization:'Bearer '+s.apiKey}:{},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!r.ok){await r.body?.cancel();throw Error('音色接口返回 HTTP '+r.status+'；已保留原列表。');}
 if(Number(r.headers.get('content-length'))>131072){await r.body?.cancel();throw Error('音色列表过大。');}
 let size=0;const chunks=[];for await(const chunk of r.body){size+=chunk.length;if(size>131072)throw Error('音色列表过大。');chunks.push(chunk);}
 const bytes=new Uint8Array(size);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}
 const body=JSON.parse(new TextDecoder().decode(bytes));
 const source=Array.isArray(body)?body:body.voices||body.data;
 if(!Array.isArray(source)||!source.length||source.length>100)throw Error('接口未返回有效音色列表；已保留原列表。');
 const voices=source.map(v=>typeof v==='string'?{id:v,name:v}:{id:v.id,name:v.name||v.label||v.id});
 const voice=voices.some(v=>v.id===s.voice)?s.voice:voices.some(v=>v.id===defaults.voice)?defaults.voice:voices[0].id;
 return settings({...s,voices,voice});
}
export function resetPreferences(config){const s=settings(config);return settings({...s,maxChars:defaults.maxChars,similarity:defaults.similarity,toolbar:defaults.toolbar,voice:s.voices.some(v=>v.id===defaults.voice)?defaults.voice:s.voices[0].id});}
