const {chromium}=require('playwright');
const http=require('http'),fs=require('fs'),path=require('path'),os=require('os'),assert=require('assert/strict');
const ext=require('node:path').resolve(__dirname,'..');
(async()=>{
const pending=new Map();const wav=Buffer.alloc(44+32000);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(32000,40);
const server=http.createServer((req,res)=>{let body='';req.on('data',b=>body+=b);req.on('end',()=>{if(req.url!='/v1/audio/speech'){res.writeHead(404);res.end();return;}pending.set(JSON.parse(body).input,res);});});await new Promise(r=>server.listen(0,'127.0.0.1',r));let context;
try{
context=await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(),'voice-queue-')),{channel:'chromium',headless:true,args:['--disable-extensions-except='+ext,'--load-extension='+ext]});
const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');const id=new URL(worker.url()).host;const page=await context.newPage();await page.goto('chrome-extension://'+id+'/options.html');
await page.evaluate(async port=>{await chrome.storage.local.set({settings:{baseUrl:'http://127.0.0.1:'+port+'/v1',model:'fixture',voice:'a',voices:[{id:'a',name:'A'}]}});window.events=[];chrome.runtime.onMessage.addListener((m,sender)=>{if(m.type==='audio-status'&&sender.url?.endsWith('/offscreen.html'))events.push(m)});},server.address().port);
async function say(text){await page.evaluate(text=>chrome.runtime.sendMessage({type:'speak',text,requestId:text}),text);}
async function until(fn){for(let i=0;i<600;i++){if(await fn())return;await new Promise(r=>setTimeout(r,25));}throw Error('timed out');}
async function finish(text){await until(()=>pending.has(text));const res=pending.get(text);res.writeHead(200,{'content-type':'audio/wav'});res.end(wav);pending.delete(text);}
async function state(text,state){await page.waitForFunction(({text,state})=>events.some(e=>e.requestId===text&&e.state===state),{text,state});}
await say('第一条');await until(()=>pending.has('第一条'));await say('第二条');await say('第一条');
await page.waitForTimeout(150);assert.deepEqual([...pending.keys()],['第一条']);
await finish('第一条');await state('第一条','playing');await page.waitForTimeout(150);assert.equal(pending.has('第二条'),false);
await state('第一条','ended');await finish('第二条');await state('第二条','ended');
await page.waitForFunction(()=>events.filter(e=>e.state==='playing').length===3);
assert.deepEqual(await page.evaluate(()=>events.filter(e=>e.state==='playing').map(e=>e.requestId)),['第一条','第二条','第一条']);
assert.equal(await page.evaluate(()=>events.filter(e=>e.state==='playing').at(-1).cacheHit),true);
await page.waitForFunction(()=>events.filter(e=>e.state==='ended').length===3);
await say('失败条');await until(()=>pending.has('失败条'));await say('失败后');const failed=pending.get('失败条');failed.writeHead(500);failed.end();pending.delete('失败条');await state('失败条','error');await finish('失败后');await state('失败后','playing');
await say('清空队列');await page.evaluate(()=>chrome.runtime.sendMessage({type:'stop'}));await state('失败后','stopped');await state('清空队列','stopped');await page.waitForTimeout(150);assert.equal(pending.has('清空队列'),false);
await say('停止等待');await until(()=>pending.has('停止等待'));await say('不应生成');await page.evaluate(()=>chrome.runtime.sendMessage({type:'stop'}));await finish('停止等待');
await page.waitForFunction(async()=>{const c=await import('./cache.js');return (await c.rows()).some(r=>r.text==='停止等待')});
assert.equal(await page.evaluate(()=>events.some(e=>e.requestId==='停止等待'&&e.state==='playing')),false);assert.equal(pending.has('不应生成'),false);
await say('恢复播放');await finish('恢复播放');await state('恢复播放','playing');
console.log('PASS real MV3: FIFO without interruption, cached audio respects order, error advances queue, stop clears queue and pending playback, restart after stop');
}finally{if(context)await context.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
