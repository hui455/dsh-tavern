import { chromium } from 'playwright';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../', import.meta.url));
export async function verify(url){
 const b=await chromium.launch({headless:true});
 const output=root+'/docs/design/workbench-image-generation';await mkdir(output,{recursive:true});
 let p;
 try{
  const current=await readFile(root+'/tavern-plugin/lib/client.js','utf8');
  const baseline=execFileSync('git',['show','origin/main:tavern-plugin/lib/client.js'],{cwd:root,encoding:'utf8',maxBuffer:16000000});
  const report={screenshots:[],checks:[]};
  for(const theme of ['light','dark','abyss'])for(const version of theme==='abyss'?['after']:['before','after']){
   const context=await b.newContext({viewport:{width:1440,height:900},colorScheme:theme==='abyss'?'dark':theme});
   await context.addInitScript(theme=>{localStorage.setItem('dsh-dream-skin:skin',theme==='abyss'?'abyss':theme==='dark'?'tavern-terracotta-dark':'tavern-terracotta');localStorage.setItem('dsh-dream-skin:builtin-last',theme==='abyss'?'dark':theme);},theme);
   p=await context.newPage();
   let replaced=false;
   if(version==='before')await p.route('**/plugins/**',async route=>{
    if(route.request().resourceType()!=='script')return route.continue();
    const response=await route.fetch();const body=await response.text();
    if(body.includes(current)){replaced=true;await route.fulfill({response,body:body.replace(current,()=>baseline)});}else await route.fulfill({response});
   });
   await p.goto(url);await p.waitForTimeout(1400);
   for(let i=0;i<4;i++){
    for(const label of ['继续','稍后配置']){const button=p.getByRole('button',{name:label,exact:true});if(await button.isVisible().catch(()=>false)){await button.click();await p.waitForTimeout(350);}}
   }
   await p.getByRole('button',{name:'卡片',exact:true}).click();
   await p.waitForTimeout(300);
   if(!await p.getByRole('dialog',{name:'选择卡片工作台起始任务'}).isVisible())await p.getByRole('button',{name:'＋ 新建卡片工作台对话',exact:true}).click();
   const dialog=p.getByRole('dialog',{name:'选择卡片工作台起始任务'});await dialog.waitFor();
   assert.equal(await dialog.getByText('自由生图',{exact:true}).count(),version==='after'?1:0);
   if(version==='before')assert.ok(replaced,'baseline bundle must be served unchanged');
   for(const [device,viewport]of [['desktop',{width:1440,height:900}],['mobile',{width:390,height:844}]]){
    await p.setViewportSize(viewport);await p.waitForTimeout(400);
    if(!await dialog.isVisible())await p.getByTitle('新建对话（跟随当前模式）',{exact:true}).click();
    await dialog.waitFor();
    const bounds=await dialog.boundingBox();assert.ok(bounds.x>=-1&&bounds.x+bounds.width<=viewport.width+1,'dialog fits viewport');
    const file=device+'-'+theme+'-'+version+'.png';await p.screenshot({path:output+'/'+file});report.screenshots.push(file);
   }
   console.log('captured',theme,version);
   await context.close();
  }
  const context=await b.newContext({viewport:{width:1440,height:900}});p=await context.newPage();await p.goto(url);await p.waitForTimeout(1200);
  for(let i=0;i<4;i++)for(const label of ['继续','稍后配置']){const button=p.getByRole('button',{name:label,exact:true});if(await button.isVisible().catch(()=>false)){await button.click();await p.waitForTimeout(350);}}
  await p.getByRole('button',{name:'卡片',exact:true}).click();await p.waitForTimeout(300);if(!await p.getByRole('dialog',{name:'选择卡片工作台起始任务'}).isVisible())await p.getByRole('button',{name:'＋ 新建卡片工作台对话',exact:true}).click();
  await p.getByRole('button',{name:/自由生图 直接描述/}).click();
  await p.waitForFunction(()=>[...document.querySelectorAll('[contenteditable=true]')].some(e=>e.textContent.includes('画面描述：')),{},{timeout:20000});
  const composer=p.locator('[contenteditable=true]').filter({hasText:'画面描述：'}).first();
  const draft=await composer.innerText();
  assert.ok(draft.includes('无需创建或绑定人物卡'));report.checks.push('Clicking free-image entry creates an operable blank workbench with generation draft');
  await composer.press('End');await composer.pressSequentially('海边的灯塔，没有人物');assert.ok((await composer.innerText()).includes('海边的灯塔，没有人物'));report.checks.push('Composer accepts user image description');
  await p.screenshot({path:output+'/free-image-workbench.png'});
  await writeFile(output+'/verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }catch(e){console.log('failure-body',(await p.locator('body').innerText()).slice(-2400));await p.screenshot({path:output+'/failure.png'});throw e;}finally{await b.close();}
}
