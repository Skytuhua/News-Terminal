// Windows/WebView2 + real Rust host. SYNTHETIC fixtures via validated native import only.
// node scripts/v04-native-smoke.mjs [--exe src-tauri/target/release/news-terminal.exe] [--prefix v04-native-release]
// Does NOT build, modify production data, mock IPC, start servers/models, or stop unowned processes.
import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const { values } = parseArgs({ options: { exe: {type:'string', default:'src-tauri/target/debug/news-terminal.exe'}, prefix: {type:'string', default:`v04-native-${new Date().toISOString().replace(/[^0-9]/g,'')}`} } });
assert.match(values.prefix, /^v04-native-[\w-]+$/);
const base = resolve(root, 'docs/evidence', values.prefix);
mkdirSync(resolve(root,'docs/evidence'), {recursive:true});
const sha = b => createHash('sha256').update(b).digest('hex');
const evidence = { startedAt:new Date().toISOString(), executable:resolve(root,values.exe), fixtureLabel:'SYNTHETIC V04 NATIVE FIXTURE — not real news', fixtureCount:5201, checks:[], launches:[], screenshots:[], pageErrors:[], consoleErrors:[], limitations:[
  'Only the recorded executable hash is accepted. Embedded JS/CSS hashes are checked against current dist.',
  '5201 explicitly synthetic stories imported through the real validated native backup API into newly-created temporary appdata. IPC and DOM are not mocked.',
  'Screenshots are actual native WebView2 content, not OS window chrome. Native window identities are independently recorded with Win32.',
  'Default startup refresh may begin before sources can be disabled; it is drained before replacing isolated contents with fixtures. One synthetic source has future retry eligibility; providers stay disabled.',
  'No network/AI/feed quality, hot-unplug, installer, or physical DPI acceptance is implied. No unrelated process or existing model service is touched.'
] };
let app, browser, main, detached, dataDirectory;
const save = () => writeFileSync(`${base}.json`, JSON.stringify(evidence,null,2));
const delay = ms => new Promise(r=>setTimeout(r,ms));
async function until(fn, message='Condition did not settle', timeout=30000) {
  const end=Date.now()+timeout; while(Date.now()<end) { const v=await fn(); if(v)return v; await delay(150); } throw Error(message);
}
async function invoke(page, request) {return page.evaluate(request=>window.__TAURI_INTERNALS__.invoke('dispatch',{request}),request);}
const snapshot = (page=main,profileId='default')=>invoke(page,{op:'snapshot',profileId});
async function article(id, page=main) { return (await snapshot(page)).articles.find(a=>a.id===id); }
const state = a=>({read:a.read,saved:a.saved,hidden:a.hidden});
const rows = page=>page.getByTestId('story-row');
const divider = (page,name='Reading')=>page.getByRole('separator',{name:`${name} pane width`,exact:true});
async function shot(name,page=main) {
  const path=`${base}-${name}.png`; await page.screenshot({path,timeout:15000});evidence.screenshots.push(path);save();return path;
}
async function check(name,fn,{required=false}={}) {
  const c={name,startedAt:new Date().toISOString()};evidence.checks.push(c);save();
  try {c.details=await fn();c.passed=true;}
  catch(e) {c.passed=false;c.error=String(e.stack||e); if(main&&!main.isClosed()){c.body=await main.locator('body').innerText().catch(String);await shot(`failure-${evidence.checks.length}`).catch(()=>{});}if(required){save();throw e;}}
  save();return c.details;
}
const osPython=String.raw`
import ctypes as c, ctypes.wintypes as w, json, sys
u=c.windll.user32
u.GetWindowThreadProcessId.argtypes=[w.HWND,c.POINTER(w.DWORD)]
u.IsWindowVisible.argtypes=[w.HWND]
u.GetWindowTextW.argtypes=[w.HWND,w.LPWSTR,c.c_int]
u.PostMessageW.argtypes=[w.HWND,w.UINT,w.WPARAM,w.LPARAM]
a=json.loads(sys.argv[1]); windows=[]
@c.WINFUNCTYPE(w.BOOL,w.HWND,w.LPARAM)
def cb(h,p):
    pid=w.DWORD();u.GetWindowThreadProcessId(h,c.byref(pid))
    if pid.value==a['pid'] and u.IsWindowVisible(h):
        t=c.create_unicode_buffer(512);u.GetWindowTextW(h,t,512)
        if t.value:
            windows.append(dict(hwnd=int(h),pid=pid.value,title=t.value))
            if a.get('close') and t.value=='News Terminal':u.PostMessageW(h,16,0,0)
    return True
u.EnumWindows(cb,0)
print(json.dumps(windows))
`;
function nativeWindows(close=false) {return JSON.parse(execFileSync(process.env.DAILY_NATIVE_PYTHON||'python',['-c',osPython,JSON.stringify({pid:app.pid,close})],{encoding:'utf8',timeout:15000}));}
async function findPage(predicate) {
  return until(async()=>{for(const c of browser.contexts())for(const p of c.pages())try {if(predicate(await invoke(p,{op:'window_context'})))return p;}catch{}return false;},'Native window target not ready');
}
async function ready(page) {
  page.setDefaultTimeout(20000);page.on('pageerror',e=>evidence.pageErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')evidence.consoleErrors.push(m.text());});
  await page.getByRole('tablist',{name:'Workspace tabs'}).waitFor();
  assert.match(page.url(),/^https?:\/\/tauri\.localhost/,'Requires embedded executable, not Vite/browser fixture');
}
async function launch() {
  const port=await new Promise((done,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>done(n));});});
  const run={port,startedAt:new Date().toISOString(),stderr:''};evidence.launches.push(run);
  app=spawn(evidence.launchedExecutable,[],{env:{...process.env,NEWS_TERMINAL_DATA_DIR:dataDirectory,NEWS_TERMINAL_CDP_PORT:String(port),NEWS_TERMINAL_WEBVIEW_DATA_DIR:join(dataDirectory,'webview')},stdio:'pipe'});
  run.pid=app.pid;let spawnError;app.on('error',e=>spawnError=e);app.stderr.on('data',b=>run.stderr=(run.stderr+b).slice(-12000));app.stdout.on('data',()=>{});
  await until(async()=>{if(spawnError)throw spawnError;if(app.exitCode!==null)throw Error(`Owned process exited ${app.exitCode}`);try {browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});return true;}catch{return false;}},'CDP did not open',45000);
  main=await findPage(c=>c.label==='main');await ready(main);await trace();run.url=main.url();run.windows=nativeWindows();save();return main;
}
async function stop(graceful=true) {
  if(!app)return;const run=evidence.launches.at(-1);run.termination={pid:app.pid,requestedGraceful:graceful,forceKilled:false};
  // Never destroy a target underneath an async trace listener. Keep failures fatal to acceptance.
  try{await stopTrace();run.termination.traceDrainedAt=new Date().toISOString();}catch(e){traceFailure(e,'stop');}
  if(app.exitCode===null&&graceful) {run.termination.closeRequestedAt=new Date().toISOString();run.termination.windows=nativeWindows(true);await until(()=>app.exitCode!==null,'Native WM_CLOSE timeout',10000).catch(()=>{});}
  if(app.exitCode===null) {run.termination.forceKilled=true;const r=spawnSync('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{encoding:'utf8'});run.termination.taskkill={status:r.status,stdout:r.stdout,stderr:r.stderr};await until(()=>app.exitCode!==null,'Owned cleanup did not exit',10000);}
  run.termination.exitCode=app.exitCode;run.termination.finishedAt=new Date().toISOString();
  if(browser)await browser.close().catch(()=>{});browser=null;app=null;save();
}

const hidden=()=>main.getByRole('main',{name:'Hidden stories'}), hiddenRows=()=>hidden().locator('.hidden-row');
const hiddenRead=(profileId='default')=>invoke(main,{op:'hidden_stories',profileId});
const id=i=>`v04-synthetic-${String(i).padStart(4,'0')}`, target=id(0), oldest=id(5200);
let initialTarget;
let observed=[], traceCollector;
function traceFailure(error,phase){
 evidence.traceError??=String(error);
 (evidence.traceErrors??=[]).push({phase,error:String(error),at:new Date().toISOString()});
}
async function stopTrace(){
 const collector=traceCollector;if(!collector)return;
 const {session,pending,onPaused,lifecycle}=collector;
 lifecycle.stopRequestedAt=new Date().toISOString();lifecycle.pendingAtStop=pending.size;
 // Quiesce future pauses while the target is alive, then finish BOTH evaluation and resume.
 // An EventEmitter does not await async listeners; detaching alone cannot drain them.
 await session.send('Debugger.setSkipAllPauses',{skip:true});
 while(pending.size)await Promise.all([...pending]);
 await session.send('Debugger.disable');
 while(pending.size)await Promise.all([...pending]);
 lifecycle.pendingAfterDrain=pending.size;
 session.off('Debugger.paused',onPaused);
 await session.detach();
 lifecycle.detachedAt=new Date().toISOString();traceCollector=null;
}
async function trace(){
 await stopTrace();
 const entries=observed=[],session=await main.context().newCDPSession(main),pending=new Set();
 const lifecycle={pid:app.pid,startedAt:new Date().toISOString(),pauses:0,completed:0};
 (evidence.traceLifecycle??=[]).push(lifecycle);
 const onPaused=event=>{
  lifecycle.pauses++;
  const work=(async()=>{
   try{const r=await session.send('Debugger.evaluateOnCallFrame',{callFrameId:event.callFrames[0].callFrameId,expression:"arguments[0]==='dispatch'?JSON.stringify(arguments[1].request):null",returnByValue:true});if(r.result.value)entries.push(JSON.parse(r.result.value));}
   catch(e){traceFailure(e,'evaluate');}
   finally{try{await session.send('Debugger.resume');}catch(e){traceFailure(e,'resume');}}
  })();
  pending.add(work);void work.then(()=>{pending.delete(work);lifecycle.completed++;});
 };
 traceCollector={session,pending,onPaused,lifecycle};
 session.on('Debugger.paused',onPaused);
 await session.send('Debugger.enable');
 const {result}=await session.send('Runtime.evaluate',{expression:'window.__TAURI_INTERNALS__.invoke'});
 await session.send('Debugger.setBreakpointOnFunctionCall',{objectId:result.objectId});
 await invoke(main,{op:'workspace_get',profileId:'default'});
 assert.ok(observed.some(r=>r.op==='workspace_get'),'Native IPC observation must be functional');
}
async function calls(reset=false){const a=[...observed];if(reset)observed.length=0;return a;}
async function restart(){const previous=app.pid;await stop();assert.equal(evidence.launches.at(-1).termination.forceKilled,false);assert.equal(evidence.launches.at(-1).termination.exitCode,0);assert.equal(sha(readFileSync(evidence.launchedExecutable)),evidence.executableSha256);await launch();assert.notEqual(app.pid,previous);}
async function metrics(){return main.evaluate(()=>({title:document.title,lang:document.documentElement.lang,width:innerWidth,height:innerHeight,bodyWidth:document.body.scrollWidth,dpr:devicePixelRatio,smallTargets:[...document.querySelectorAll('button,input,select,a')].map(e=>{const r=e.getBoundingClientRect();return {label:e.getAttribute('aria-label')||e.textContent?.trim().slice(0,70),width:r.width,height:r.height};}).filter(r=>r.width>0&&r.height>0&&r.width<44&&r.height<44)}));}
let layoutSession;
async function layout(width,height){if(!layoutSession)layoutSession=await main.context().newCDPSession(main);await layoutSession.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:0,mobile:false});await until(async()=>{const m=await metrics();return m.width===width&&m.height===height;});}
try{
 assert.equal(process.platform,'win32');assert.ok(existsSync(evidence.executable));
 evidence.executableSha256=sha(readFileSync(evidence.executable));evidence.scriptSha256=sha(readFileSync(fileURLToPath(import.meta.url)));evidence.executableModifiedAt=statSync(evidence.executable).mtime.toISOString();
 dataDirectory=mkdtempSync(join(tmpdir(),'news-terminal-v04-native-'));evidence.dataDirectory=dataDirectory;evidence.launchedExecutable=join(dataDirectory,'v04-native-app.exe');copyFileSync(evidence.executable,evidence.launchedExecutable);assert.equal(sha(readFileSync(evidence.launchedExecutable)),evidence.executableSha256);await launch();
 await check('actual Windows WebView2 and embedded asset freshness',async()=>{
 const c=await main.context().newCDPSession(main);await c.send('Page.enable');const {frameTree}=await c.send('Page.getResourceTree');const urls=await main.evaluate(()=>[...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(e=>e.src||e.href));const assets=[];
 for(const url of urls){const r=await c.send('Page.getResourceContent',{frameId:frameTree.frame.id,url});const actual=sha(Buffer.from(r.content,r.base64Encoded?'base64':'utf8'));const distPath=resolve(root,'dist',new URL(url).pathname.slice(1));assert.ok(existsSync(distPath));assert.equal(actual,sha(readFileSync(distPath)));assets.push({url,sha256:actual,distPath});}await c.detach();assert.ok(assets.length>=2);const windows=nativeWindows();assert.equal(windows.length,1);return {assets,windows,userAgent:await main.evaluate(()=>navigator.userAgent)};
 },{required:true});
 await check('isolated validated 5201-story fixture and profile-specific retained state',async()=>{
 const start=await snapshot();for(const s of start.sources.filter(s=>s.enabled))await invoke(main,{op:'source_update',sourceId:s.id,enabled:false});await until(async()=>{try{await invoke(main,{op:'refresh'});return true;}catch(e){if(String(e).includes('refresh is already running'))return false;throw e;}},'Startup refresh drain',180000);
 const b=JSON.parse(await invoke(main,{op:'export'}));for(const d of b.documents){if(d.kind==='source')d.data.enabled=false;if(d.kind==='provider'){d.data.enabled=false;d.data.consented=false;}if(d.kind==='workspace')d.data={revision:0,tabs:[{id:'home',title:'Synthetic recovery acceptance',topic:'',query:'',mode:'all'}],activeTabId:'home'};}
 const p=b.documents.find(d=>d.kind==='profile'&&d.id==='default');b.documents.push({...structuredClone(p),id:'v04-other',data:{...structuredClone(p.data),id:'v04-other',name:'SYNTHETIC Other profile'}});b.documents.push({kind:'workspace',id:'v04-other',scope:'',data:structuredClone(b.documents.find(d=>d.kind==='workspace'&&d.id==='default').data)});
 const now=Math.floor(Date.now()/1000),source={id:'v04-synthetic-source',name:'SYNTHETIC fixture publisher — not news',url:'https://example.invalid/synthetic/feed',homepage:'https://example.invalid/',termsUrl:'https://example.invalid/terms',topics:['science'],region:'global',language:'en',enabled:false,status:'SYNTHETIC disabled failure fixture',failures:8,lastAttempt:now,lastSuccess:null,retryAt:now+86400,refreshMinutes:30,storage:'metadata',kind:'reporting',aiAllowed:false,mediaAllowed:false};
 b.documents.push({kind:'source',id:source.id,scope:'',data:source});const failure={...source,id:'v04-future-source',name:'SYNTHETIC future-eligible failure — not news',enabled:true,status:'SYNTHETIC HTTP 429 fixture; not a live request',failures:2};b.documents.push({kind:'source',id:failure.id,scope:'',data:failure});
 b.articles=Array.from({length:5201},(_,i)=>({id:id(i),sourceId:source.id,sourceName:source.name,title:`SYNTHETIC recovery report ${String(i).padStart(4,'0')} — not real news`,url:`https://example.invalid/synthetic/${i}`,excerpt:'',publishedAt:now-i,firstSeen:now-i,updatedAt:now-i,topics:['science'],region:'global',language:i===5200?'fr':'en',kind:'reporting',aiAllowed:false,read:false,saved:false,hidden:false,groupId:`v04-group-${i}`,reasons:[],score:0,history:[]}));b.states=[];b.alerts=[];
 for(let i=5000;i<5201;i++){b.states.push({profileId:'default',articleId:id(i),data:{read:false,saved:false,hidden:true,groupId:`v04-group-${i}`}});b.states.push({profileId:'v04-other',articleId:id(i),data:{read:false,saved:true,hidden:false,groupId:`v04-group-${i}`}});}
 await invoke(main,{op:'import',data:JSON.stringify(b)});const s=await snapshot();assert.equal(s.articles.length,5000);assert.equal((await hiddenRead()).length,201);assert.equal((await hiddenRead('v04-other')).length,0);evidence.fixture={articleCount:b.articles.length,states:b.states.length,sha256:sha(JSON.stringify(b)),oldestHidden:oldest,oldestLanguage:'fr',defaultLanguages:s.profile.preferences.languages,source:failure};await stopTrace();await main.reload();await ready(main);await trace();await expect(rows(main)).toHaveCount(100);return evidence.fixture;
 },{required:true});
 await check('workspace_get parity and both new reads leave export unchanged with no data-changed events',async()=>{
 const before=await invoke(main,{op:'export'});await main.evaluate(async()=>{window.__V04_EVENTS__=0;const i=window.__TAURI_INTERNALS__,handler=i.transformCallback(()=>window.__V04_EVENTS__++);await i.invoke('plugin:event|listen',{event:'data-changed',target:{kind:'Any'},handler});});const workspace=await invoke(main,{op:'workspace_get',profileId:'default'});const snap=await snapshot();const {replacementToken,...durable}=workspace;assert.equal(replacementToken,snap.replacementToken);assert.deepEqual(durable,snap.workspace);await hiddenRead();await invoke(main,{op:'workspace_get',profileId:'v04-other'});await hiddenRead('v04-other');await delay(250);const events=await main.evaluate(()=>window.__V04_EVENTS__);assert.equal(events,0);assert.equal(await invoke(main,{op:'export'}),before);return {workspace,events,exportUnchanged:true};
 },{required:true});
 await check('UI saves and hides story then dismisses Undo with host confirmation',async()=>{
 await main.locator(`[data-article-id="${target}"] .headline`).click();await main.getByLabel('Save story',{exact:true}).click();await main.getByLabel('Unsave story',{exact:true}).waitFor();await until(async()=>{const a=await article(target);return a.saved&&a.read;});initialTarget=await article(target);await main.getByRole('button',{name:'Hide story',exact:true}).click();await main.getByLabel('Dismiss hidden story notice',{exact:true}).click();await expect(main.getByRole('button',{name:'Undo hide',exact:true})).toHaveCount(0);await until(async()=>(await hiddenRead()).length===202);const actual=await article(target);assert.deepEqual(state(actual),{read:true,saved:true,hidden:true});await shot('hidden-undo-dismissed');return {articleId:target,state:state(actual),groupId:actual.groupId};
 },{required:true});
 await check('exact-executable restart retains hide and persistent Hidden navigation',async()=>{
 await restart();await calls(true);await main.getByRole('button',{name:'Hidden stories',exact:true}).click();await expect(hiddenRows()).toHaveCount(100);await expect(hidden().getByRole('status')).toHaveText('202 hidden stories');assert.deepEqual(state((await hiddenRead()).find(a=>a.id===target)),{read:true,saved:true,hidden:true});await until(async()=>(await invoke(main,{op:'workspace_get',profileId:'default'})).tabs.some(t=>t.mode==='hidden'));await shot('hidden-desktop');const ops=(await calls()).map(r=>r.op);assert.ok(ops.indexOf('workspace_get')>=0&&ops.indexOf('workspace_get')<ops.indexOf('workspace_save'),'UI must pre-read workspace_get before saving Hidden mode');return {hiddenCount:202,pid:app.pid,operations:ops};
 },{required:true});
 await check('202 hidden rows reached beyond snapshot cap and preferences with no read/media/AI writes',async()=>{
 const before=JSON.parse(await invoke(main,{op:'export'})).states;await calls(true);const titles=[];
 do{const batch=await hiddenRows().locator('h3').allTextContents();assert.ok(batch.length<=100);titles.push(...batch);const next=hidden().getByRole('button',{name:'Next page',exact:true});if(!await next.isEnabled())break;await next.click();await until(async()=>await hiddenRows().first().locator('h3').innerText()!==batch[0]);}while(titles.length<300);
 assert.equal(titles.length,202);assert.equal(new Set(titles).size,202);assert.ok(titles.some(t=>t.includes('5200')));await hidden().getByLabel('Find hidden title or publisher').fill('5200 PUBLISHER');await expect(hiddenRows()).toHaveCount(1);await expect(hiddenRows()).toContainText('Unread');assert.ok(!(await snapshot()).articles.some(a=>a.id===oldest));const old=(await hiddenRead()).find(a=>a.id===oldest);assert.equal(old.language,'fr');assert.equal(old.read,false);await shot('old-hidden-outside-snapshot');await hidden().getByLabel('Find hidden title or publisher').fill('');await main.keyboard.press('Control+k');await expect(hidden().getByLabel('Find hidden title or publisher')).toBeFocused();const trace=await calls();assert.deepEqual(trace.filter(r=>['article_state','media_load','summarize','sector_summary','search','refresh'].includes(r.op)),[]);assert.deepEqual(JSON.parse(await invoke(main,{op:'export'})).states,before);return {enumerated:titles.length,unique:new Set(titles).size,oldest:old,operations:trace.map(r=>r.op),statesUnchanged:true};
 },{required:true});
 await check('profile switch isolates hidden collection',async()=>{
 await main.getByLabel('Reading profile',{exact:true}).selectOption('v04-other');await until(async()=>(await invoke(main,{op:'window_context'})).profileId==='v04-other');await main.getByRole('button',{name:'Hidden stories',exact:true}).click();await expect(hidden().getByText('No hidden stories',{exact:true})).toBeVisible();assert.equal((await hiddenRead()).length,202);await shot('other-profile-empty');await main.getByLabel('Reading profile',{exact:true}).selectOption('default');await expect(hiddenRows()).toHaveCount(100);return {otherHidden:0,defaultHidden:202};
 },{required:true});
 await check('actual WebView2 narrow and 200-percent-equivalent hidden layouts',async()=>{
 const captures=[];for(const [name,w,h,s] of [['narrow',800,650,1],['200pct',720,450,2]]){await layout(w,h,s);await hiddenRows().first().evaluate(e=>e.scrollIntoView({block:'center'}));await expect(hiddenRows().first()).toBeInViewport({ratio:0.99});await expect(hiddenRows().first().getByRole('button',{name:'Restore',exact:true})).toBeInViewport();const m=await metrics();assert.ok(m.bodyWidth<=m.width);assert.equal(m.lang,'en');await shot(`hidden-${name}`);captures.push({name,...m});}await layout(1440,900);return {method:'Native WebView2 renderer at 720x450 CSS = 200% layout-equivalent to 1440x900; observed native DPR recorded, not overridden OS DPI or browser zoom setting',captures};
 });
 await check('source health host facts and read-only inspection',async()=>{
 const before=(await snapshot()).sources;await calls(true);await main.getByRole('button',{name:'Sources & health 1 failing',exact:true}).click();const failure=main.locator('.source-row').filter({has:main.getByText('SYNTHETIC future-eligible failure — not news',{exact:true})});await expect(failure).toContainText('Failed · no successful retrieval');await expect(failure).toContainText('Eligible after');await expect(failure).toContainText('SYNTHETIC HTTP 429');await expect(main.locator('.source-row').filter({has:main.getByText('SYNTHETIC fixture publisher — not news',{exact:true})})).toContainText('Disabled · not scheduled');const captures=[];
 for(const [name,w,h,s] of [['desktop',1440,900,1],['narrow',800,650,1],['200pct',720,450,2]]){await layout(w,h,s);await failure.scrollIntoViewIfNeeded();await expect(main.getByRole('button',{name:'Close settings',exact:true})).toBeInViewport();const m=await metrics();assert.ok(m.bodyWidth<=m.width);await shot(`sources-${name}`);captures.push({name,...m});}await main.getByRole('button',{name:'Close settings',exact:true}).click();assert.deepEqual((await snapshot()).sources,before);const trace=await calls();assert.deepEqual(trace.filter(r=>['refresh','source_update','media_load','summarize','article_state'].includes(r.op)),[]);await layout(1440,900);return {captures,operations:trace.map(r=>r.op),sourcesUnchanged:true};
 });
 await check('Restore writes only hidden:false and preserves saved/read/group',async()=>{
 await hidden().getByLabel('Find hidden title or publisher').fill('0000');await expect(hiddenRows()).toHaveCount(1);await calls(true);await hiddenRows().getByRole('button',{name:'Restore',exact:true}).click();await expect(hidden().getByRole('status')).toHaveText('Story restored');assert.ok(!(await hiddenRead()).some(a=>a.id===target));const after=await article(target);assert.deepEqual(state(after),{read:true,saved:true,hidden:false});assert.equal(after.groupId,initialTarget.groupId);const trace=await calls();assert.deepEqual(trace.filter(r=>r.op==='article_state'),[{op:'article_state',profileId:'default',articleId:target,hidden:false,replacementToken:(await snapshot()).replacementToken}]);assert.deepEqual(trace.filter(r=>['media_load','summarize'].includes(r.op)),[]);assert.equal((await hiddenRead('v04-other')).length,0);await shot('restore-confirmed');return {articleId:target,state:state(after),groupId:after.groupId,mutations:trace.filter(r=>r.op==='article_state')};
 },{required:true});
 await check('second exact-executable restart retains Hidden mode and restored Saved membership',async()=>{
 await restart();await expect(hiddenRows()).toHaveCount(100);assert.equal((await hiddenRead()).length,201);assert.ok(!(await hiddenRead()).some(a=>a.id===target));assert.deepEqual(state(await article(target)),{read:true,saved:true,hidden:false});assert.equal((await article(target)).groupId,initialTarget.groupId);await main.getByRole('button',{name:'Saved stories',exact:true}).click();await expect(rows(main)).toHaveCount(1);await expect(main.locator(`[data-article-id="${target}"]`)).toBeVisible();await shot('restarted-saved-restored');return {state:state(await article(target)),hiddenCount:201,workspace:await invoke(main,{op:'workspace_get',profileId:'default'})};
 },{required:true});
 await check('final fixture isolation and frontend errors',async()=>{
 const s=await snapshot();assert.ok(s.providers.every(p=>!p.enabled));assert.equal(s.sources.filter(s=>s.enabled).length,1);assert.deepEqual(evidence.pageErrors,[]);assert.deepEqual(evidence.consoleErrors,[]);assert.equal(evidence.traceError,undefined);const b=JSON.parse(await invoke(main,{op:'export'}));assert.equal(b.articles.length,5201);assert.ok(b.articles.every(a=>a.title.startsWith('SYNTHETIC')));const other=b.states.filter(s=>s.profileId==='v04-other');assert.equal(other.length,201);assert.ok(other.every(s=>s.data.saved&&!s.data.hidden&&!s.data.read));return {articles:b.articles.length,otherStates:other.length,pageErrors:evidence.pageErrors,consoleErrors:evidence.consoleErrors};
 });
}catch(e){evidence.fatalError=String(e.stack||e);}
finally{try{await stop(true);}catch(e){evidence.cleanupError=String(e.stack||e);}evidence.finishedAt=new Date().toISOString();evidence.summary={checks:evidence.checks.length,passed:evidence.checks.filter(c=>c.passed).length,failed:evidence.checks.filter(c=>!c.passed).length};evidence.passed=!evidence.fatalError&&!evidence.cleanupError&&!evidence.traceError&&evidence.summary.failed===0;save();}
console.log(JSON.stringify({evidence:`${base}.json`,passed:evidence.passed,summary:evidence.summary,failures:evidence.checks.filter(c=>!c.passed).map(c=>({name:c.name,error:c.error})),fatalError:evidence.fatalError,cleanupError:evidence.cleanupError},null,2));process.exitCode=evidence.passed?0:1;
