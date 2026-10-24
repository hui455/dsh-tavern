// Run with Playwright installed; fixture services do not synthesize real speech.
const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const ext=require('node:path').resolve(__dirname,'..');
(async()=>{fs.mkdirSync(require('node:path').join(__dirname,'artifacts'),{recursive:true});let calls=0;const wav=Buffer.alloc(44+8000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(8000,40);
const server=http.createServer((req,res)=>{if(req.url==='/v1/audio/speech'){calls++;req.resume();req.on('end',()=>{res.writeHead(200,{'content-type':'audio/wav'});res.end(wav)});}else{res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<html><meta charset="utf-8"><p id="sample">今晚的月色真美，陪我走一会儿，再听听风的声音。</p></html>')}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const port=server.address().port,dir=fs.mkdtempSync(path.join(os.tmpdir(),'voice-extension-test-'));let context;
try{context=await chromium.launchPersistentContext(dir,{channel:'chromium',headless:true,args:['--disable-extensions-except='+ext,'--load-extension='+ext]});const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;
await worker.evaluate(async(port)=>{await chrome.storage.local.set({settings:{baseUrl:'http://127.0.0.1:'+port+'/v1',model:'fixture',apiKey:'fixture-key',voice:'a',voices:[{name:'角色甲',id:'a'},{name:'角色乙',id:'b'}],maxChars:500,similarity:.92,toolbar:true}})},port);
const page=await context.newPage();await page.goto('chrome-extension://'+id+'/options.html');
async function say(text,voice='a'){const rid=crypto.randomUUID();await page.evaluate(async({text,voice,rid})=>chrome.runtime.sendMessage({type:'speak',text,voice,requestId:rid}),{text,voice,rid});for(let i=0;i<150;i++){const s=await page.evaluate(async()=> (await chrome.storage.session.get('lastStatus')).lastStatus);if(s?.requestId===rid&&['playing','ended','error'].includes(s.state))return s;await page.waitForTimeout(100)}throw Error('speech timeout')}
const text='今晚的月色真美，陪我走一会儿，再听听风的声音。';
let r=await say(text);assert.notEqual(r.state,'error',r.message);assert.equal(calls,1);assert.equal(r.cacheHit,false);
r=await say(text);assert.equal(r.cacheHit,true);assert.equal(calls,1);
await worker.evaluate(()=>chrome.offscreen.closeDocument());r=await say(text);assert.equal(r.cacheHit,true);assert.equal(calls,1);
assert.ok(await worker.evaluate(()=>chrome.alarms.get('voice-expire')));
r=await say(text.replace('风','雨'));assert.equal(r.cacheHit,true);assert.equal(r.actualText,text);assert.equal(calls,1);
r=await say(text,'b');assert.equal(r.cacheHit,false);assert.equal(calls,2);
await say('今天晴天');await say('今天雨天');assert.equal(calls,4);
r=await say('字'.repeat(501));assert.equal(r.state,'error');assert.equal(calls,4);
const old=await page.evaluate(async()=>{const c=await import('./cache.js');return (await c.rows()).find(x=>x.voice==='a'&&x.text.length>15).lastUsed});await page.waitForTimeout(20);await say(text);const newer=await page.evaluate(async()=>{const c=await import('./cache.js');return (await c.rows()).find(x=>x.voice==='a'&&x.text.length>15).lastUsed});assert.ok(newer>old);
await page.evaluate(async()=>{const c=await import('./cache.js');const row=(await c.rows()).find(x=>x.voice==='a'&&x.text.length>15);await new Promise((resolve,reject)=>{const r=indexedDB.open('local-role-voice',1);r.onsuccess=()=>{const t=r.result.transaction('audio','readwrite');t.objectStore('audio').put({...row,lastUsed:Date.now()-7*86400000-1});t.oncomplete=()=>{r.result.close();resolve()};t.onerror=()=>reject(t.error)}});await c.prune();});
r=await say(text);assert.equal(r.cacheHit,false);assert.equal(calls,5);
const web=await context.newPage();await web.goto('http://127.0.0.1:'+port);await web.waitForTimeout(500);await web.evaluate(()=>{const range=document.createRange();range.selectNodeContents(document.querySelector('#sample'));const s=getSelection();s.removeAllRanges();s.addRange(range);document.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}))});await web.getByRole('button',{name:'朗读选中文字',exact:true}).waitFor();await web.getByRole('button',{name:'朗读选中文字',exact:true}).click();await web.getByRole('status').filter({hasText:/缓存|播放完成/}).waitFor();assert.equal(calls,5);await web.screenshot({path:path.join(__dirname,'artifacts','toolbar.png')});
console.log('PASS real extension: playback, exact/fuzzy reuse, role isolation, short text rules, length limit, sliding 7-day expiry, selection toolbar');
await page.evaluate(()=>chrome.runtime.sendMessage({type:'clear'}));const stats=await page.evaluate(()=>chrome.runtime.sendMessage({type:'stats'}));assert.equal(stats.count,0);console.log('PASS clear cache');
}finally{if(context)await context.close();server.closeAllConnections();await new Promise(r=>server.close(r));}process.exit(0)})().catch(e=>{console.error(e.stack);process.exit(1)});
