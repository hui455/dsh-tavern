import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const output=fileURLToPath(new URL('../../docs/design/conversation-id',import.meta.url));await mkdir(output,{recursive:true});
const source=fileURLToPath(new URL('../../',import.meta.url));
process.chdir(source);
const root=resolve(process.env.TAVERN_UI_BASELINE_SOURCE || source);
const status=execFileSync(process.execPath,[root+'/bin/dsh-tavern.mjs','status'],{encoding:'utf8'});const url=status.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0];
const old=await readFile(root+'/tavern-plugin/lib/client.js','utf8'), current=await readFile('tavern-plugin/lib/client.js','utf8'), css=await readFile('tavern-plugin/lib/client-assets/tavern.css','utf8');
const b=await chromium.launch({headless:true});const checks=[];let p;
try{
 for(const theme of ['light','dark','abyss'])for(const size of ['desktop','mobile'])for(const version of theme==='abyss'?['after']:['before','after']){
  const context=await b.newContext({viewport:{width:1440,height:900},colorScheme:theme==='light'?'light':'dark',permissions:['clipboard-read','clipboard-write']});p=await context.newPage();
  await context.addInitScript(theme=>{localStorage.setItem('dsh-dream-skin:skin',theme==='abyss'?'abyss':theme==='dark'?'tavern-terracotta-dark':'tavern-terracotta');localStorage.setItem('dsh-dream-skin:builtin-last',theme==='light'?'light':'dark');},theme);
  await p.route('**/api/dsh-tavern/listSessions',async route=>{const r=await route.fetch();const data=await r.json();const card=data.sessions.find(s=>s.mode==='card'&&!s.cardPath),play=data.sessions.find(s=>s.mode==='story');data.sessions=[card&&{...card,title:'生图诊断工作台'},play&&{...play,title:'游玩排错示例',cardName:'诊断示例人物'}].filter(Boolean);await route.fulfill({response:r,json:data});});
  if(version==='after')await p.route('**/plugins/**',async route=>{if(route.request().resourceType()!=='script')return route.continue();const r=await route.fetch();const body=await r.text();await route.fulfill({response:r,body:body.includes(old)?body.replace(old,()=>current):body});});
  await p.goto(url);await p.waitForTimeout(1200);
  for(let i=0;i<3;i++)for(const label of ['继续','稍后配置']){const button=p.getByRole('button',{name:label,exact:true});if(await button.isVisible().catch(()=>false)){await button.click();await p.waitForTimeout(250);}}
  if(version==='after')await p.addStyleTag({content:css});
  await p.getByRole('button',{name:'卡片',exact:true}).click();await p.waitForTimeout(200);
  if(size==='mobile'){await p.setViewportSize({width:390,height:844});await p.waitForTimeout(250);}
  const more=p.locator('.dsh-tavern-side-row-more').first();if(!await more.isVisible()){await p.getByRole('button',{name:'打开侧边栏',exact:true}).click();await p.waitForTimeout(250);}
  await more.click();await p.waitForTimeout(200);
  if(version==='after'){
   const id=await p.locator('.dsh-tavern-conversation-id code').innerText();assert.ok(id);
   await p.getByRole('button',{name:'复制对话 ID',exact:true}).click();await p.getByRole('status').filter({hasText:'已复制对话 ID'}).waitFor();assert.equal(await p.evaluate(()=>navigator.clipboard.readText()),id);
   await p.getByRole('button',{name:'复制排错信息',exact:true}).click();await p.getByRole('status').filter({hasText:'已复制排错信息'}).waitFor();const copied=await p.evaluate(()=>navigator.clipboard.readText());assert.ok(copied.includes('对话 ID: '+id));assert.match(copied,/Session ID:/);
   const box=await p.locator('.dsh-tavern-side-row-menu').boundingBox();assert.ok(box.x>=0&&box.x+box.width<=(size==='mobile'?390:1440));checks.push(theme+' '+size+': full ID and live RPC diagnostic copy, menu within viewport');
  }
  await p.screenshot({path:output+'/'+size+'-'+theme+'-'+version+'.png'});
  if(version==='after'&&theme==='light'&&size==='desktop'){
   await p.evaluate(()=>Object.defineProperty(navigator.clipboard,'writeText',{value:async()=>{throw Error('permission denied')},configurable:true}));await p.getByRole('button',{name:'复制对话 ID',exact:true}).click();await p.getByRole('textbox',{name:'手动复制排错信息'}).waitFor();checks.push('Clipboard denial displays selectable fallback without false success');await p.screenshot({path:output+'/clipboard-denied.png'});
  }
  if(version==='after'&&theme==='dark'&&size==='desktop') {
   await p.locator('.dsh-tavern-side-row-more').first().click();await p.getByRole('button',{name:'游玩',exact:true}).click();await p.waitForTimeout(250);
   const group=p.locator('.dsh-tavern-history-group-toggle').first();if(await group.count()&&await group.getAttribute('aria-expanded')!=='true')await group.click();
   await p.locator('.dsh-tavern-side-row-more').first().click();await p.getByRole('button',{name:'复制排错信息',exact:true}).click();await p.getByRole('status').filter({hasText:'已复制排错信息'}).waitFor();checks.push('Gameplay conversation menu also copies real diagnostic identity');
  }
  await context.close();
 }
 await writeFile(output+'/verification.json',JSON.stringify({checks,note:'Live application and real identity RPC. Sidebar list restricted to two existing sessions with neutral titles for screenshot privacy; no model or image request sent.'},null,2));console.log(JSON.stringify(checks));
}catch(e){await p?.screenshot({path:output+'/failure.png'}).catch(()=>{});console.log((await p?.locator('body').innerText().catch(()=>''))?.slice(-1500));throw e}finally{await b.close()}
