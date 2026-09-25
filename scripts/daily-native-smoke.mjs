// Windows/WebView2 + real Rust host. SYNTHETIC fixtures via validated native import only.
// node scripts/daily-native-smoke.mjs [--exe src-tauri/target/release/news-terminal.exe] [--prefix daily-native-release]
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
const { values } = parseArgs({ options: { exe: {type:'string', default:'src-tauri/target/debug/news-terminal.exe'}, prefix: {type:'string', default:`daily-native-${new Date().toISOString().replace(/[^0-9]/g,'')}`} } });
assert.match(values.prefix, /^daily-native-[\w-]+$/);
const base = resolve(root, 'docs/evidence', values.prefix);
mkdirSync(resolve(root,'docs/evidence'), {recursive:true});
const sha = b => createHash('sha256').update(b).digest('hex');
const evidence = { startedAt:new Date().toISOString(), executable:resolve(root,values.exe), fixtureLabel:'SYNTHETIC DAILY NATIVE FIXTURE — not real news', fixtureCount:251, checks:[], launches:[], screenshots:[], pageErrors:[], consoleErrors:[], limitations:[
  'Only the recorded executable hash is accepted. No build or claim of source-to-binary freshness is made.',
  '251 explicitly synthetic stories imported through the real validated native backup API into newly-created temporary appdata. IPC and DOM are not mocked.',
  'Screenshots are actual native WebView2 content, not OS window chrome. Native window identities are independently recorded with Win32.',
  'Default startup refresh may begin before sources can be disabled; it is drained before replacing isolated contents with fixtures. All fixture-phase sources/providers are disabled.',
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
  main=await findPage(c=>c.label==='main');await ready(main);run.url=main.url();run.windows=nativeWindows();save();return main;
}
async function stop(graceful=true) {
  if(!app)return;const run=evidence.launches.at(-1);run.termination={pid:app.pid,requestedGraceful:graceful,forceKilled:false};
  if(app.exitCode===null&&graceful) {run.termination.windows=nativeWindows(true);await until(()=>app.exitCode!==null,'Native WM_CLOSE timeout',10000).catch(()=>{});}
  if(app.exitCode===null) {run.termination.forceKilled=true;const r=spawnSync('taskkill.exe',['/PID',String(app.pid),'/T','/F'],{encoding:'utf8'});run.termination.taskkill={status:r.status,stdout:r.stdout,stderr:r.stderr};await until(()=>app.exitCode!==null,'Owned cleanup did not exit',10000);}
  run.termination.exitCode=app.exitCode;run.termination.finishedAt=new Date().toISOString();
  if(browser)await browser.close().catch(()=>{});browser=null;app=null;save();
}
async function paneState(page) {
  return {context:await invoke(page,{op:'window_context'}),ui:await page.evaluate(()=>({width:innerWidth,reading:Number(document.querySelector('[aria-label="Reading pane width"]')?.getAttribute('aria-valuenow')),navigation:Number(document.querySelector('[aria-label="Navigation pane width"]')?.getAttribute('aria-valuenow')),actualReading:document.querySelector('.detail')?.getBoundingClientRect().width,bodyWidth:document.body.scrollWidth,lang:document.documentElement.lang})),storage:await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage).filter(([k])=>k.startsWith('news-terminal:panes:'))))};
}
async function setReadingByKeyboard(page,value) {
  const d=divider(page);await d.focus();await page.keyboard.press('Home');for(let i=290;i<value;i+=10)await page.keyboard.press('ArrowLeft');await expect(d).toHaveAttribute('aria-valuenow',String(value));
}
async function getIds(page) {return rows(page).evaluateAll(rs=>rs.map(r=>r.getAttribute('data-article-id')));}
async function allHeadlines(page=main) {
  await page.getByRole('button',{name:'All headlines',exact:true}).click();await page.getByRole('searchbox').fill('');await page.getByLabel('Unread',{exact:true}).uncheck();await expect(rows(page)).toHaveCount(100);
}
let orderedIds=[],firstId,firstTitle,mainHomeWidths,mainOtherWidths,detachedWidths;
try {
  assert.equal(process.platform,'win32');assert.ok(existsSync(evidence.executable));
  evidence.executableSha256=sha(readFileSync(evidence.executable));evidence.executableModifiedAt=statSync(evidence.executable).mtime.toISOString();evidence.scriptSha256=sha(readFileSync(fileURLToPath(import.meta.url)));
  dataDirectory=mkdtempSync(join(tmpdir(),'news-terminal-daily-native-'));evidence.dataDirectory=dataDirectory;evidence.launchedExecutable=join(dataDirectory,'daily-native-app.exe');copyFileSync(evidence.executable,evidence.launchedExecutable);assert.equal(sha(readFileSync(evidence.launchedExecutable)),evidence.executableSha256);
  await launch();
  await check('actual native runtime and embedded assets',async()=>{
    const session=await main.context().newCDPSession(main);await session.send('Page.enable');const {frameTree}=await session.send('Page.getResourceTree');const urls=await main.evaluate(()=>[...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(e=>e.src||e.href));const assets=[];
    for(const url of urls){const r=await session.send('Page.getResourceContent',{frameId:frameTree.frame.id,url});assets.push({url,sha256:sha(Buffer.from(r.content,r.base64Encoded?'base64':'utf8'))});}await session.detach();assert.ok(assets.length>=2);
    const windows=nativeWindows();assert.equal(windows.length,1);return {assets,windows,context:await invoke(main,{op:'window_context'}),webviewDirectory:join(dataDirectory,'webview')};
  },{required:true});
  await check('isolated validated synthetic import with exact count and no active sources',async()=>{
    const start=await snapshot();for(const s of start.sources.filter(s=>s.enabled))await invoke(main,{op:'source_update',sourceId:s.id,enabled:false});
    await until(async()=>{try {await invoke(main,{op:'refresh'});return true;}catch(e){if(String(e).includes('refresh is already running'))return false;throw e;}},'Startup native refresh did not drain',180000);
    const backup=JSON.parse(await invoke(main,{op:'export'}));for(const d of backup.documents){if(d.kind==='source')d.data.enabled=false;if(d.kind==='provider'){d.data.enabled=false;d.data.consented=false;}if(d.kind==='workspace'&&d.id==='default')d.data={revision:d.data.revision,tabs:[{id:'home',title:'Synthetic fixture headlines',topic:'',query:'',mode:'all'},{id:'daily-other',title:'Synthetic second tab',topic:'',query:'',mode:'all'}],activeTabId:'home'};}
    const source={id:'daily-native-synthetic',name:'SYNTHETIC TEST FIXTURE — not news',url:'https://example.invalid/synthetic/feed',homepage:'https://example.invalid/',termsUrl:'https://example.invalid/synthetic',topics:['science'],region:'global',language:'en',enabled:false,status:'Synthetic offline fixture; never fetched',lastSuccess:null,storage:'metadata',kind:'reporting',aiAllowed:false,mediaAllowed:false};
    backup.documents.push({kind:'source',id:source.id,scope:'',data:source});const now=Math.floor(Date.now()/1000);
    backup.articles=Array.from({length:evidence.fixtureCount},(_,i)=>({id:`daily-native-${String(i).padStart(4,'0')}`,sourceId:source.id,sourceName:source.name,title:`SYNTHETIC fixture report ${String(i).padStart(4,'0')} — not real news`,url:`https://example.invalid/synthetic/${i}`,excerpt:'',publishedAt:now-i*60,firstSeen:now-i*60,updatedAt:now-i*60,topics:['science'],region:'global',language:'en',kind:'reporting',aiAllowed:false,read:false,saved:false,hidden:false,groupId:`daily-synthetic-group-${i}`,reasons:[],score:0,history:[]}));backup.states=[];backup.alerts=[];
    writeFileSync(`${base}-synthetic-backup.json`,JSON.stringify(backup,null,2));await invoke(main,{op:'import',data:JSON.stringify(backup)});
    const s=await snapshot();assert.equal(s.articles.length,evidence.fixtureCount);assert.ok(s.articles.every(a=>a.title.startsWith('SYNTHETIC')&&!a.aiAllowed));assert.ok(s.sources.every(s=>!s.enabled));assert.ok(s.providers.every(p=>!p.enabled));await main.reload();await ready(main);await expect(rows(main)).toHaveCount(100);
    orderedIds=await getIds(main);firstId=orderedIds[0];firstTitle=await main.locator('.headline').first().innerText();await shot('synthetic-first-page');return {count:s.articles.length,source:s.sources.find(x=>x.id===source.id),orderedFirstPage:orderedIds};
  },{required:true});
  await check('Close clears selection but preserves saved and hidden flags',async()=>{
    await main.locator('.headline').first().click();await main.getByLabel('Save story',{exact:true}).click();await main.getByLabel('Unsave story',{exact:true}).waitFor();const before=state(await article(firstId));assert.equal(before.saved,true);assert.equal(before.hidden,false);
    await main.getByLabel('Close story',{exact:true}).click();await expect(main.locator('.detail h2')).toHaveText('Select a story');await until(async()=>!(await snapshot()).workspace.tabs.find(t=>t.id==='home').selectedId,'Close selection not persisted');const after=state(await article(firstId));assert.deepEqual(after,before);await expect(rows(main)).toHaveCount(100);return {articleId:firstId,before,after};
  });
  await check('Hide saved story and Undo restore actual host flags and Saved view',async()=>{
    await main.getByRole('button',{name:'Saved stories',exact:true}).click();await expect(rows(main)).toHaveCount(1);await main.locator('.headline').click();await main.getByRole('button',{name:'Hide story',exact:true}).click();await expect(rows(main)).toHaveCount(0);await expect(main.getByRole('heading',{name:'No visible saved stories',exact:true})).toBeVisible();const hidden=state(await article(firstId));assert.equal(hidden.saved,true);assert.equal(hidden.hidden,true);await shot('saved-hidden-undo');
    await main.getByRole('button',{name:'Undo hide',exact:true}).click();await expect(rows(main)).toHaveCount(1);const restored=state(await article(firstId));assert.equal(restored.saved,true);assert.equal(restored.hidden,false);assert.equal(await main.locator('.headline').innerText(),firstTitle);await shot('saved-restored');return {articleId:firstId,hidden,restored};
  });
  await check('native pagination enumerates every fixture exactly once with bounded DOM',async()=>{
    await allHeadlines();const pages=[];const ids=[];do {const batch=await getIds(main);assert.ok(batch.length<=100);pages.push({count:batch.length,first:batch[0],last:batch.at(-1),status:await main.locator('.headline-pages [role="status"]').innerText()});ids.push(...batch);if(!await main.getByRole('button',{name:'Next page',exact:true}).isEnabled())break;await main.getByRole('button',{name:'Next page',exact:true}).click();await until(async()=>(await getIds(main))[0]!==batch[0]);}while(pages.length<10);
    const actual=(await snapshot()).articles.map(a=>a.id).sort();assert.equal(ids.length,evidence.fixtureCount);assert.equal(new Set(ids).size,evidence.fixtureCount);assert.deepEqual([...ids].sort(),actual);orderedIds=ids;await expect(rows(main)).toHaveCount(51);await shot('last-page');await main.getByRole('button',{name:'First page',exact:true}).click();await expect(rows(main)).toHaveCount(100);return {pages,unique:new Set(ids).size,ids};
  });
  await check('J/K cross real page boundary and S persists without key leakage into search',async()=>{
    await allHeadlines();if(await main.getByRole('button',{name:'First page',exact:true}).isEnabled())await main.getByRole('button',{name:'First page',exact:true}).click();await main.locator(`[data-article-id="${orderedIds[99]}"] .headline`).click();await main.keyboard.press('j');await expect(main.locator(`[data-article-id="${orderedIds[100]}"]`)).toBeInViewport();assert.equal(await main.locator('.detail h2').innerText(),(await article(orderedIds[100])).title);
    await main.keyboard.press('k');await expect(main.locator(`[data-article-id="${orderedIds[99]}"]`)).toBeInViewport();await main.keyboard.press('s');await until(async()=>(await article(orderedIds[99])).saved,'S did not persist saved');const saved=state(await article(orderedIds[99]));await shot('keyboard-page-crossing');
    await main.keyboard.press('/');await expect(main.getByRole('searchbox')).toBeFocused();await main.keyboard.type('jks');assert.equal(await main.getByRole('searchbox').inputValue(),'jks');assert.deepEqual(state(await article(orderedIds[99])),saved);await main.getByRole('searchbox').fill('');await expect(rows(main)).toHaveCount(100);return {from:orderedIds[99],next:orderedIds[100],saved,typingDoesNotSaveOrNavigate:true};
  });
  await check('Unread J J K revisits read history without consuming the third story',async()=>{
    await allHeadlines();if(await main.getByLabel('Close story',{exact:true}).count())await main.getByLabel('Close story',{exact:true}).click();await main.getByLabel('Unread',{exact:true}).check();await main.locator('.list-heading h2').click();
    const unreadIds=(await getIds(main)).slice(0,3);assert.equal(unreadIds.length,3);const titles=await Promise.all(unreadIds.map(async id=>(await article(id)).title));
    await main.keyboard.press('j');await expect(main.locator('.detail h2')).toHaveText(titles[0]);await until(async()=>(await article(unreadIds[0])).read,'First J did not mark first unread story read');
    await main.keyboard.press('j');await expect(main.locator('.detail h2')).toHaveText(titles[1]);await until(async()=>(await article(unreadIds[1])).read,'Second J did not mark second unread story read');
    await main.keyboard.press('k');await expect(main.locator('.detail h2')).toHaveText(titles[0]);assert.equal((await article(unreadIds[2])).read,false);await shot('unread-history');await main.getByLabel('Unread',{exact:true}).uncheck();return {unreadIds,returnedTo:unreadIds[0],thirdStillUnread:true};
  });
  await check('full-cache search reaches off-page final fixture and keyboard help is operable',async()=>{
    const last=await article(orderedIds.at(-1));await main.getByRole('searchbox').fill(last.title.split(' — ')[0]);await expect(rows(main)).toHaveCount(1);assert.equal((await getIds(main))[0],last.id);await main.locator('.headline').click();await expect(main.locator('.detail h2')).toHaveText(last.title);await shot('off-page-search');
    await main.getByRole('searchbox').fill('');await main.locator('.list-heading h2').click();await main.keyboard.press('?');await expect(main.getByRole('dialog')).toBeVisible();await main.keyboard.press('Escape');await expect(main.getByRole('dialog')).toHaveCount(0);await main.keyboard.press('Control+k');await expect(main.getByRole('searchbox')).toBeFocused();return {lastArticleId:last.id,helpOpenedAndClosed:true,controlKFocus:true};
  });
  await check('main pointer-resized panes are scoped independently per tab',async()=>{
    await main.locator('#workspace-tab-home').click();await allHeadlines();
    const monitors=await invoke(main,{op:'window_monitors'});const target=[...monitors.monitors].sort((a,b)=>b.width/b.scaleFactor-a.width/a.scaleFactor)[0];await invoke(main,{op:'window_move',monitorId:target.id,layout:'full'});await until(async()=>(await main.evaluate(()=>innerWidth))>=1100,'Need real native display at least 1100 CSS pixels wide');
    const d=divider(main);await expect(d).toHaveAttribute('aria-valuenow','390');const box=await d.boundingBox();await main.mouse.move(box.x+box.width/2,box.y+80);await main.mouse.down();await main.mouse.move(box.x+box.width/2-80,box.y+80,{steps:8});await main.mouse.up();await expect(d).toHaveAttribute('aria-valuenow','470');
    await divider(main,'Navigation').focus();await main.keyboard.press('ArrowRight');await main.keyboard.press('ArrowRight');await expect(divider(main,'Navigation')).toHaveAttribute('aria-valuenow','225');mainHomeWidths=await paneState(main);assert.equal(mainHomeWidths.ui.actualReading,470);
    await main.getByRole('tab',{name:'Synthetic second tab',exact:true}).click();await expect(d).toHaveAttribute('aria-valuenow','390');await setReadingByKeyboard(main,430);mainOtherWidths=await paneState(main);await main.getByRole('tab',{name:/Synthetic fixture headlines|Headlines/,exact:true}).first().click();await expect(d).toHaveAttribute('aria-valuenow','470');await shot('main-pane-width');return {mainHomeWidths,mainOtherWidths};
  },{required:true});
  await check('real detached native window has independent pane scope',async()=>{
    await main.getByRole('button',{name:'Detach tab',exact:true}).click();detached=await findPage(c=>c.detached&&c.tabId==='home');await ready(detached);const monitors=await invoke(detached,{op:'window_monitors'});const target=[...monitors.monitors].sort((a,b)=>b.width/b.scaleFactor-a.width/a.scaleFactor)[0];await invoke(detached,{op:'window_move',monitorId:target.id,layout:'full'});
    await expect(divider(detached)).toHaveAttribute('aria-valuenow','390');await setReadingByKeyboard(detached,330);await divider(detached,'Navigation').focus();await detached.keyboard.press('Home');detachedWidths=await paneState(detached);await expect(divider(main)).toHaveAttribute('aria-valuenow','430');const windows=nativeWindows();assert.equal(windows.length,2);assert.equal(detachedWidths.context.detached,true);await shot('detached-pane-width',detached);return {detachedWidths,main:await paneState(main),windows};
  },{required:true});
  await check('real app close and restart retains main/detached pane preferences',async()=>{
    evidence.beforeRestart={main:await paneState(main),detached:await paneState(detached),states:[{id:firstId,...state(await article(firstId))},{id:orderedIds[99],...state(await article(orderedIds[99]))}]};save();await stop(true);const ended=evidence.launches.at(-1);assert.equal(ended.termination.forceKilled,false);assert.equal(ended.termination.exitCode,0);await launch();assert.notEqual(evidence.launches.at(-1).pid,ended.pid);
    detached=await findPage(c=>c.detached&&c.tabId==='home');await ready(detached);await expect(divider(main)).toHaveAttribute('aria-valuenow','430');await expect(divider(detached)).toHaveAttribute('aria-valuenow','330');await expect(divider(detached,'Navigation')).toHaveAttribute('aria-valuenow','160');evidence.afterRestart={main:await paneState(main),detached:await paneState(detached),windows:nativeWindows()};
    assert.deepEqual(evidence.afterRestart.main.storage,evidence.beforeRestart.main.storage);assert.deepEqual(evidence.afterRestart.detached.storage,evidence.beforeRestart.detached.storage);for(const before of evidence.beforeRestart.states)assert.deepEqual({id:before.id,...state(await article(before.id))},before);assert.equal((await snapshot()).articles.length,evidence.fixtureCount);await expect(detached.locator('.detail h2')).toHaveText((await article(orderedIds.at(-1))).title);await expect(detached.locator(`[data-article-id="${orderedIds.at(-1)}"]`)).toBeInViewport();await shot('main-restarted');await shot('detached-restarted',detached);return evidence.afterRestart;
  },{required:true});
  await check('reattach restores same tab main widths without copying detached preferences',async()=>{
    await detached.getByRole('button',{name:/Reattach/i}).click();await until(()=>detached.isClosed(),'Detached native target did not close');await main.getByRole('tab',{name:/Synthetic fixture headlines|Headlines/,exact:true}).first().click();await expect(divider(main)).toHaveAttribute('aria-valuenow','470');await expect(divider(main,'Navigation')).toHaveAttribute('aria-valuenow','225');assert.equal(nativeWindows().length,1);const final=await paneState(main);assert.equal(final.ui.actualReading,470);assert.ok(final.ui.bodyWidth<=final.ui.width);await shot('reattached-main');return final;
  });
  await check('no frontend page errors and fixture isolation retained',async()=>{assert.deepEqual(evidence.pageErrors,[]);const s=await snapshot();assert.ok(s.sources.every(s=>!s.enabled));assert.ok(s.providers.every(p=>!p.enabled));assert.equal(s.articles.length,evidence.fixtureCount);assert.ok(s.articles.every(a=>a.title.startsWith('SYNTHETIC')));return {pageErrors:evidence.pageErrors,consoleErrors:evidence.consoleErrors,articleCount:s.articles.length};});
} catch(e) {evidence.fatalError=String(e.stack||e);}
finally {
  try {await stop(true);}catch(e){evidence.cleanupError=String(e.stack||e);}
  evidence.finishedAt=new Date().toISOString();evidence.summary={checks:evidence.checks.length,passed:evidence.checks.filter(c=>c.passed).length,failed:evidence.checks.filter(c=>!c.passed).length};evidence.passed=!evidence.fatalError&&!evidence.cleanupError&&evidence.summary.failed===0;save();
}
console.log(JSON.stringify({evidence:`${base}.json`,passed:evidence.passed,summary:evidence.summary,failures:evidence.checks.filter(c=>!c.passed).map(c=>({name:c.name,error:c.error})),fatalError:evidence.fatalError,cleanupError:evidence.cleanupError},null,2));process.exitCode=evidence.passed?0:1;
