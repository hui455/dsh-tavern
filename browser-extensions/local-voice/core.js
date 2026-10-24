export const DAY = 86400000;
export const TTL = 7 * DAY;
export const defaults = {
  baseUrl: 'http://127.0.0.1:9875/v1', model: 'gpt-sovits', apiKey: '', voice: '胡桃_ZH',
  allowedOrigins: ['http://127.0.0.1:3081','http://localhost:3081'],
  maxChars: 500, similarity: 0.92, toolbar: true,
  voices: ['今汐','八重神子','刻晴','卡提希娅','弗洛洛','珂莱塔','珊瑚宫心海','甘雨','神里绫华','胡桃','芙宁娜','茜特菈莉','菲比','雷电将军'].map(name => ({name,id:name+'_ZH'}))
};
export function settings(value = {}) {
  const s = {...defaults, ...value};
  if (['http://127.0.0.1:9881/v1','http://localhost:9881/v1'].includes(String(s.baseUrl).replace(/\/$/,''))) { s.baseUrl='http://127.0.0.1:9875/v1';s.apiKey=''; }
  s.allowedOrigins = normalizeOrigins(s.allowedOrigins);
  const u = new URL(s.baseUrl);
  if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error('请填写不含密钥或查询参数的 HTTP(S) API 根地址。');
  s.baseUrl = u.href.replace(/\/+$/, '');
  if (typeof s.model !== 'string' || !s.model.trim() || s.model.length>200) throw Error('请填写模型。');
  if (typeof s.apiKey !== 'string' || /[\r\n]/.test(s.apiKey)) throw Error('API Key 格式错误。');
  if (!Array.isArray(s.voices) || !s.voices.length || s.voices.length>100 || s.voices.some(v=>!v || typeof v.id!=='string' || !v.id.trim() || v.id.length>300 || typeof v.name!=='string' || !v.name.trim() || v.name.length>100)) throw Error('音色列表格式错误。');
  if (new Set(s.voices.map(v=>v.id)).size!==s.voices.length || !s.voices.some(v=>v.id===s.voice)) throw Error('默认角色必须在音色列表中，ID 不可重复。');
  if (!Number.isInteger(s.maxChars) || s.maxChars<1 || s.maxChars>5000) throw Error('字数上限须为 1–5000。');
  if (!Number.isFinite(s.similarity) || s.similarity<0.85 || s.similarity>1) throw Error('相似度须为 85%–100%。');
  return s;
}
export const count = text => [...String(text)].length;
export const normalize = text => String(text).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{Z}\s]/gu,'');
export function validateText(text, limit) {
  if (typeof text!=='string' || !text.trim()) throw Error('请先选择或输入文字。');
  const value=text.trim(), n=count(value);
  if(n>limit) throw Error(`已选 ${n} 字，超过上限 ${limit} 字。请缩短选区，不会截断或发送请求。`);
  if(!normalize(value)) throw Error('选中的内容只有空格或标点。');
  return value;
}
export function similarity(a,b,threshold=0.92) {
  if(a===b)return 1;
  const x=[...a],y=[...b],n=x.length,m=y.length,max=Math.max(n,m);
  if(Math.min(n,m)<12 || Math.min(n,m)/max<0.9)return 0;
  const allowed=Math.min(max<40?1:Infinity,Math.floor(max*(1-threshold)+1e-9));
  if(Math.abs(n-m)>allowed)return 0;
  let prev=Array.from({length:m+1},(_,i)=>i);
  for(let i=1;i<=n;i++){
    const next=[i];let low=i;
    for(let j=1;j<=m;j++){next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(x[i-1]===y[j-1]?0:1));low=Math.min(low,next[j]);}
    if(low>allowed)return 0;prev=next;
  }
  return prev[m]<=allowed?1-prev[m]/max:0;
}
export async function digest(text) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(x=>x.toString(16).padStart(2,'0')).join('');}
export async function partition(s,voice) {return digest(JSON.stringify([s.baseUrl,s.model,voice,'mp3',await digest(s.apiKey)]));}

export function normalizeOrigins(value) {
  if (!Array.isArray(value) || value.length > 100) throw Error('白名单最多 100 个网站。');
  return [...new Set(value.map(entry => {
    if (typeof entry !== 'string' || entry.includes('*')) throw Error('白名单请填写完整网站地址，不支持通配符。');
    let u; try { u = new URL(entry.trim()); } catch { throw Error('白名单地址格式错误。'); }
    if (!['http:','https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw Error('白名单请只填写协议、域名和端口，例如 http://127.0.0.1:3081');
    return u.origin;
  }))];
}
export function siteAllowed(url, config) {
  try { return normalizeOrigins(config?.allowedOrigins ?? defaults.allowedOrigins).includes(new URL(url).origin); }
  catch { return false; }
}
