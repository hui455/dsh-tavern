import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerPlayImageDebugTool } from '../tavern-plugin/lib/tools/play-image-debug.js'
import { createProfileDataStore } from '../tavern-plugin/lib/profile-data-store.js'
import { createSceneImageDiagnostics } from '../tavern-plugin/lib/domain/scene-image-diagnostics.js'
import { createSceneImageNativeRuntime } from './fixtures/scene-image-native-runtime.mjs'
import { conversationDiagnosticIdentity } from '../tavern-plugin/lib/domain/conversation-diagnostic-identity.js'
const exec = { agent: { session: { id: 'editor-session' } } }
function setup(chat, dependencies) {
 const editor = { id:'editor', mode:'card', cardPath:chat.cardPath, workspace:{mountedResources:[{kind:'play-chat',path:'play-chat:'+chat.id,chatId:chat.id}]} }
 let tool
 registerPlayImageDebugTool({tools:{register:t=>{tool=t}},chatForSession:async()=>editor,readChat:async()=>chat,...dependencies})
 return { editor, tool, call:async args=>JSON.parse(await tool.execute(args,exec)) }
}
test('关联范围、日志分页脱敏、持久次数限制和取消归属', async t=>{
 const root=await mkdtemp(join(tmpdir(),'play-image-debug-'));t.after(()=>rm(root,{recursive:true,force:true}))
 const store=createProfileDataStore({dataRoot:root}), diagnostics=createSceneImageDiagnostics(store)
 const chat={id:'play',sessionId:'session',mode:'story',cardPath:'cards/a.json',messages:[{role:'assistant',turn:1,text:'场景'}]}
 const calls=[]; const illustrations={status:async()=>({key:'key',status:'idle'}),start:async(...args)=>{calls.push(args);return {status:'running'}},cancel:async()=>({status:'cancelled'})}
 const deps={store,diagnostics,illustrations};const h=setup(chat,deps)
 await assert.rejects(h.call({action:'start',ref:'foreign',requestId:'test-0001',key:'key'}),/已关联/)
 await assert.rejects(h.call({action:'start',turn:2,requestId:'test-0001',key:'key'}),/不存在/)
 await assert.rejects(h.call({action:'start',requestId:'test-0001',key:'stale'}),/版本/)
 for(let i=0;i<5;i++)await h.call({action:'start',key:'key',requestId:'test-000'+i})
 const restarted=setup(chat,deps)
 await assert.rejects(restarted.call({action:'start',key:'key',requestId:'test-0005'}),/上限/)
 await assert.rejects(h.call({action:'start',key:'key',requestId:'test-0000',kind:'replan'}),/其他参数/)
 await assert.rejects(h.call({action:'cancel',requestId:'not-mine'}),/本工作台/)
 assert.equal((await h.call({action:'cancel',requestId:'test-0000'})).illustration.status,'cancelled')
 assert.equal(calls.length,5)
 await diagnostics.record(chat.id,{requestId:'test-0000',targetKey:'key',turn:1,status:'succeeded',details:{apiKey:'secret',prompt:'画面'.repeat(15000),attachment:{attachmentId:'img',mediaType:'image/png'},versionId:'v1'}})
 const page=await h.call({action:'logs',requestId:'test-0000',limit:100});assert.equal(page.text.length,100);assert.equal(page.done,false)
 const full=await diagnostics.read(chat.id);assert.doesNotMatch(JSON.stringify(full),/secret/);assert.equal(full.records.find(r=>r.requestId==='test-0000').origin,'card-agent-test')
 const image=await h.call({action:'image',requestId:'test-0000'});assert.equal(image.images[0].attachmentId,'img')
 assert.equal(h.tool.output.render({},JSON.stringify(image))[1].type,'image')
 h.editor.cardPath='cards/other.json';await assert.rejects(h.call({action:'logs'}),/不一致/)
})
test('对话身份不依赖标题，排错文本不包含剧情和凭据',()=>{
 const chat={id:'chat-stable',sessionId:'session-new',mode:'card',title:'secret',apiKey:'key',messages:[{role:'assistant',turn:4,text:'private'}]}
 const result=conversationDiagnosticIdentity(chat);assert.equal(result.chatId,'chat-stable');assert.equal(result.turn,4);assert.doesNotMatch(JSON.stringify(result),/secret|private|apiKey/)
 assert.equal(conversationDiagnosticIdentity({...chat,title:'renamed'}).text,result.text)
 const withImage=conversationDiagnosticIdentity(chat,null,[{turn:3,requestId:'old',updatedAt:30},{turn:4,targetKey:'interaction',requestId:'click',updatedAt:40},{turn:4,targetKey:'target',requestId:'image-request',traceSessionId:'image-agent',updatedAt:20}]);assert.equal(withImage.imageRequestId,'image-request');assert.match(withImage.text,/生图 Agent Session ID: image-agent/)
})
test('卡片工具经正式规划、HTTP 生图和附件保存后能读取日志与图片，重复提交不重复计费', {skip:!process.env.DSH_BOOT_MODULE}, async t=>{
 const runtime=await createSceneImageNativeRuntime(process.env.DSH_BOOT_MODULE);t.after(()=>runtime.dispose())
 const h=setup(runtime.chat,{store:runtime.store,diagnostics:runtime.diagnostics,illustrations:runtime.service})
 const status=await h.call({action:'status'});const args={action:'start',key:status.illustration.key,requestId:'debug-native-001'}
 await h.call(args)
 let result
 for(let i=0;i<300;i++){result=await h.call({action:'status'});if(result.illustration.status!=='running'&&!runtime.agentRunning)break;await new Promise(r=>setTimeout(r,20))}
 assert.equal(result.illustration.status,'succeeded',result.illustration.error)
 await h.call(args);assert.equal(runtime.imageRequests.length,1)
 assert.ok(runtime.requests.length>0)
 const logs=await h.call({action:'logs',requestId:args.requestId,limit:12000});assert.match(logs.text,/debug-native-001/);assert.match(logs.text,/card-agent-test/)
 const image=await h.call({action:'image',requestId:args.requestId});assert.ok(image.images[0].attachmentId)
})
