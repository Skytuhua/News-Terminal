// Native Windows + real Rust host + existing local Ollama; no fixtures or policy overrides.
// node scripts/sector-native-smoke.mjs --build [--exe src-tauri/target/debug/news-terminal.exe]
// Alternate already-built exe: omit --build. Evidence discloses unverifiable build freshness.
import { chromium } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, writeFileSync, copyFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join, relative } from 'node:path';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import assert from 'node:assert/strict';
const { values } = parseArgs({ options: { exe: { type: 'string', default: 'src-tauri/target/debug/news-terminal.exe' }, prefix: { type: 'string', default: 'sector-native-debug' }, build: { type: 'boolean', default: false }, 'release-evidence': { type: 'string' } } });
assert.match(values.prefix, /^sector-native-[\w-]+$/);
const evidenceDir = resolve('docs/evidence'); mkdirSync(evidenceDir, { recursive: true });
const base = join(evidenceDir, values.prefix), model = 'qwen3:4b-instruct-2507-q4_K_M';
const sha = b => createHash('sha256').update(b).digest('hex');
const manifest = dir => existsSync(dir) ? readdirSync(dir, { recursive: true }).map(p => join(dir, p)).filter(p => statSync(p).isFile()).map(p => ({ path: relative('.', p).replaceAll('\\', '/'), sha256: sha(readFileSync(p)), modifiedMs: statSync(p).mtimeMs })).sort((a,b) => a.path.localeCompare(b.path)) : [];
const evidence = { startedAt: new Date().toISOString(), executable: resolve(values.exe), checks: [], consoleErrors: [], screenshots: [], limitations: [
  'Real feeds and generated text are mutable. Missing eligible inputs are blockers, never replaced by synthetic news or permission overrides.',
  'Citation membership, trusted URLs, input preservation and notices are verified, not factual entailment, accuracy, completeness or advice quality.',
  'Screenshots show actual native WebView2 contents, not window chrome; no viewport or DOM replacement.',
  'Source count means distinct catalog feed IDs, not distinct publishers. Two stories can come from one government agency.',
  'Production data is never opened. Only this script-owned process is stopped. Existing parent Ollama is not started or stopped.'
] };
const save = () => writeFileSync(`${base}.json`, JSON.stringify(evidence, null, 2));
const delay = ms => new Promise(r => setTimeout(r,ms));
let app, browser, page;
async function until(fn, timeout=30000) { const end=Date.now()+timeout; while(Date.now()<end) { const v=await fn(); if(v) return v; await delay(300); } throw Error(`Timed out after ${timeout}ms`); }
const invoke = request => page.evaluate(request => window.__TAURI_INTERNALS__.invoke('dispatch', { request }),request);
async function check(name, fn) { const c={name,startedAt:new Date().toISOString()}; evidence.checks.push(c); save(); try { c.details=await fn(); c.passed=true; } catch(e) { c.passed=false;c.error=String(e.stack||e);save();throw e; } save();return c.details; }
async function shot(name, target=page) { const path=`${base}-${name}.png`;await target.screenshot({path,timeout:20000});evidence.screenshots.push(path);save(); }
const localDate = timestamp => { const d=timestamp===undefined?new Date():new Date(timestamp*1000);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
let before, preview, brief, selected, hostResult;
try {
  assert.equal(process.platform,'win32');
  await check('existing local Ollama exact model healthy',async()=> { const r=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(10000)});assert.ok(r.ok);const tags=await r.json();assert.ok(tags.models.some(m=>m.name===model));return tags; });
  evidence.distBefore=manifest('dist'); evidence.frontendBefore=manifest('src');
  evidence.latestFrontendAtStart = Math.max(...evidence.frontendBefore.map(f=>f.modifiedMs)) <= Math.min(...evidence.distBefore.map(f=>f.modifiedMs));
  if(values.build) await check('fresh embedded debug build with stable dist',async()=> {
    const result=spawnSync('cargo',['build','--manifest-path','src-tauri/Cargo.toml','--features','tauri/custom-protocol'],{env:{...process.env,TAURI_CONFIG:'{"build":{"devUrl":null}}'},encoding:'utf8',timeout:300000});
    writeFileSync(`${base}-build.log`,`${result.stdout||''}\n${result.stderr||''}`);
    evidence.build={status:result.status,error:result.error?String(result.error):null,finishedAt:new Date().toISOString()};
    evidence.distAfterBuild=manifest('dist'); assert.equal(result.status,0,'Native build failed; no stale executable will be launched'); assert.deepEqual(evidence.distAfterBuild,evidence.distBefore,'Concurrent dist change invalidates build provenance');return evidence.build;
  });
  assert.ok(existsSync(evidence.executable));
  evidence.executableSha256=sha(readFileSync(evidence.executable));
  if(values['release-evidence']) await check('verified release input and executable provenance',async()=>{
    const proof=JSON.parse(readFileSync(resolve(values['release-evidence']),'utf8'));
    assert.equal(proof.all_notice_bytes_match,true);assert.equal(proof.local_ai_excluded,true);
    assert.ok([proof.standalone_application_sha256,proof.packaged_application_sha256].includes(evidence.executableSha256),'Executable differs from verified release');
    const entries=Object.entries(proof.input_sha256||{});assert.ok(entries.length>0,'Missing release input fingerprints');
    for(const [path,hash] of entries)assert.equal(sha(readFileSync(resolve(path))),hash,`Release input changed: ${path}`);
    evidence.releaseVerified=true;return {version:proof.version,executableSha256:evidence.executableSha256,inputsChecked:entries.length};
  });
  evidence.dataDirectory=mkdtempSync(join(tmpdir(),'news-terminal-sector-native-'));
  evidence.launchedExecutable=join(evidence.dataDirectory,'sector-smoke-app.exe');copyFileSync(evidence.executable,evidence.launchedExecutable);
  assert.equal(sha(readFileSync(evidence.launchedExecutable)),evidence.executableSha256);
  const port=await new Promise((done,reject)=>{const s=createServer();s.on('error',reject);s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>done(port));});});
  app=spawn(evidence.launchedExecutable,[],{env:{...process.env,NEWS_TERMINAL_DATA_DIR:evidence.dataDirectory,NEWS_TERMINAL_CDP_PORT:String(port),NEWS_TERMINAL_WEBVIEW_DATA_DIR:join(evidence.dataDirectory,'webview')},stdio:'pipe'});
  evidence.pid=app.pid;evidence.stderr='';let spawnError;app.on('error',e=>spawnError=e);app.stderr.on('data',b=>evidence.stderr=(evidence.stderr+b).slice(-10000));app.stdout.on('data',()=>{});
  await until(async()=>{if(spawnError)throw spawnError;if(app.exitCode!==null)throw Error(`Owned app exited ${app.exitCode}`);try {browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`,{timeout:1000});return true;}catch{return false;}},45000);
  await until(async()=>{for(const c of browser.contexts())for(const p of c.pages())try{const ctx=await p.evaluate(()=>window.__TAURI_INTERNALS__.invoke('dispatch',{request:{op:'window_context'}}));if(ctx.label==='main'){page=p;return true;}}catch{}return false;});
  page.setDefaultTimeout(20000);page.on('pageerror',e=>evidence.consoleErrors.push(String(e)));page.on('console',m=>{if(m.type()==='error')evidence.consoleErrors.push(m.text());});
  await page.getByRole('tablist',{name:'Workspace tabs'}).waitFor();evidence.nativeUrl=page.url();assert.ok(!page.url().includes('fixture')&&!page.url().includes(':1420'));
  await check('native embedded asset bytes match captured dist',async()=> {
    // Tauri CSP intentionally blocks fetch(tauri.localhost); inspect already-loaded
    // resources through CDP instead of weakening CSP or changing page state.
    const cdp=await page.context().newCDPSession(page);await cdp.send('Page.enable');
    const { frameTree }=await cdp.send('Page.getResourceTree');
    const urls=await page.evaluate(()=>[...document.querySelectorAll('script[src],link[rel="stylesheet"]')].map(e=>e.src||e.href));
    const assets=[];for(const url of urls){const resource=await cdp.send('Page.getResourceContent',{frameId:frameTree.frame.id,url});assets.push({url,sha256:sha(Buffer.from(resource.content,resource.base64Encoded?'base64':'utf8'))});}
    await cdp.detach();assert.ok(assets.length>=2);for(const a of assets){assert.ok(evidence.distBefore.some(d=>d.sha256===a.sha256),`Embedded asset absent from captured dist: ${a.url}`);}return assets;
  });
  await check('real government feed refresh without rights changes',async()=>{
    const ids=['nhc-atlantic','fed-press_monetary','fed-press_all'];const start=await invoke({op:'snapshot',profileId:'default'});evidence.startupSources=start.sources;
    for(const s of start.sources)if(s.enabled!==ids.includes(s.id))await invoke({op:'source_update',sourceId:s.id,enabled:ids.includes(s.id)});
    const configured=await invoke({op:'snapshot',profileId:'default'});assert.deepEqual(configured.sources.filter(s=>s.enabled).map(s=>s.id).sort(),[...ids].sort());
    const refresh=await until(async()=>{try{return await invoke({op:'refresh'});}catch(e){if(String(e).includes('refresh is already running'))return false;throw e;}},180000);
    before=await invoke({op:'snapshot',profileId:'default'});evidence.feedSources=before.sources.filter(s=>ids.includes(s.id));evidence.actualRetainedArticles=before.articles;
    for(const s of evidence.feedSources){assert.ok(s.lastSuccess,`No successful retrieval: ${s.id}`);const orig=start.sources.find(o=>o.id===s.id);assert.deepEqual(s.rightsPolicy,orig.rightsPolicy);assert.equal(s.aiAllowed,orig.aiAllowed);assert.equal(s.storage,orig.storage);}
    return {refresh,articleCount:before.articles.length,feedCounts:Object.fromEntries(ids.map(id=>[id,before.articles.filter(a=>a.sourceId===id).length]))};
  });
  await check('existing local provider consent and exact model readback',async()=>{const connected=await invoke({op:'local_ai_connect'});before=await invoke({op:'snapshot',profileId:'default'});const p=before.providers.find(p=>p.id==='ollama');assert.equal(p.model,model);assert.equal(p.enabled,true);assert.equal(p.consented,true);assert.ok(before.providers.filter(p=>p.enabled).every(p=>p.kind==='ollama'));return {connected,provider:p};});
  await check('host selects real permitted day-sector inputs and counts',async()=>{
    const today=localDate();const dates=[today,...[...new Set(before.articles.filter(a=>a.publishedAt).map(a=>localDate(a.publishedAt)))].filter(d=>d!==today&&d<today).sort().reverse()];evidence.dateSearch=[];
    for(const date of dates){const b=await invoke({op:'daily_brief',profileId:'default',date});const options=[];for(const sector of b.sectors.filter(s=>s.items.length>=2)){const p=await invoke({op:'sector_summary_preview',profileId:'default',date,sectorId:sector.id});options.push(p);}evidence.dateSearch.push({date,articleCount:b.articleCount,candidates:options.map(p=>({sectorId:p.sectorId,selectedCount:p.selectedCount,excludedCount:p.excludedCount}))});const candidates=options.filter(p=>p.selectedCount>=2).sort((a,b)=>a.selectedCount-b.selectedCount);if(candidates.length){preview=candidates[0];brief=b;break;}}
    assert.ok(preview,'No actual retained feed date has two permitted stories in a sector');
    evidence.selectionReason=preview.date===today?'Current local calendar day has at least two eligible stories.':`Current local day ${today} insufficient; transparently selected newest retained feed date ${preview.date} with two or more host-eligible stories. Publication dates are unchanged.`;
    // Limit this isolated profile to exactly two already-authorized inputs using
    // normal per-profile hide state, never editing feeds, dates, bodies or rights.
    evidence.untrimmedPreview=preview;evidence.profileHiddenForTwoInputSample=preview.sources.slice(2).map(s=>s.articleId);
    for(const articleId of evidence.profileHiddenForTwoInputSample)await invoke({op:'article_state',profileId:'default',articleId,hidden:true,replacementToken:before.replacementToken});
    before=await invoke({op:'snapshot',profileId:'default'});
    for(const articleId of evidence.profileHiddenForTwoInputSample)assert.equal(before.articles.find(a=>a.id===articleId)?.hidden,true);
    brief=await invoke({op:'daily_brief',profileId:'default',date:preview.date});
    preview=await invoke({op:'sector_summary_preview',profileId:'default',date:preview.date,sectorId:preview.sectorId});assert.equal(preview.selectedCount,2);
    evidence.preview=preview;evidence.brief=brief;selected=preview.sources.map(s=>before.articles.find(a=>a.id===s.articleId));evidence.originalInputs=selected;assert.ok(selected.every(Boolean));
    const sector=brief.sectors.find(s=>s.id===preview.sectorId);const dated=before.articles.filter(a=>!a.hidden&&a.publishedAt>=brief.dayStart&&a.publishedAt<brief.dayEnd&&a.publishedAt<=brief.generatedAt&&(a.topics||[]).includes(sector.id));assert.equal(sector.articleCount,dated.length);assert.equal(sector.sourceCount,new Set(dated.map(a=>a.sourceId)).size);assert.equal(preview.selectedCount,preview.sources.length);assert.equal(preview.eligibleCount,preview.selectedCount);assert.equal(preview.excludedCount,sector.items.length-preview.selectedCount);
    for(const s of preview.sources){const a=selected.find(a=>a.id===s.articleId);assert.equal(a.aiAllowed,true);assert.equal(s.url,a.url);assert.equal(s.title,a.title);assert.equal(s.publishedAt,a.publishedAt);assert.match(new URL(s.url).hostname,/^(www\.)?(federalreserve\.gov|nhc\.noaa\.gov)$/);assert.ok(s.inputLabel&&s.attribution&&s.outputLabel);}
    return {date:preview.date,today,reason:evidence.selectionReason,sector:sector.id,selectedStories:preview.selectedCount,selectedFeedCount:new Set(selected.map(a=>a.sourceId)).size,retainedSectorFeedCount:sector.sourceCount};
  });
  await check('real Rust host combined synthesis with trusted citation map',async()=>{
    hostResult=await invoke({op:'sector_summarize',profileId:'default',date:preview.date,sectorId:preview.sectorId,fingerprint:preview.fingerprint,requestId:`sector-native-${Date.now()}`});evidence.hostResult=hostResult;save();
    assert.equal(hostResult.model,model);assert.equal(hostResult.fingerprint,preview.fingerprint);assert.deepEqual(hostResult.sources,preview.sources);assert.match(hostResult.warning,/unverified.*not factual entailment/);assert.ok(hostResult.bullets.length>0);
    for(const b of hostResult.bullets){assert.ok(b.text.trim());assert.equal(b.citations.length,1);assert.equal(b.evidence.length,1);assert.equal(b.evidence[0].sourceId,b.citations[0]);assert.equal(b.text,b.evidence[0].quote);const source=preview.sources.find(s=>s.id===b.citations[0]);assert.ok(source);const article=selected.find(a=>a.id===source.articleId);assert.ok([article.title,article.excerpt].some(text=>typeof text==='string'&&text.includes(b.text)),'Quotation must occur in the actual source input');}
    const after=await invoke({op:'snapshot',profileId:'default'});for(const a of selected)assert.deepEqual(after.articles.find(x=>x.id===a.id),a,'Source article changed during synthesis');return {bullets:hostResult.bullets.length,citationIds:[...new Set(hostResult.bullets.flatMap(b=>b.citations))],originalInputsUnchanged:true};
  });
  await check('native UI on-demand synthesis, source links and disclosures',async()=>{
    await page.reload();await page.getByRole('tablist',{name:'Workspace tabs'}).waitFor();await page.getByRole('button',{name:'Daily briefing',exact:true}).click();await page.getByLabel('Briefing date',{exact:true}).fill(preview.date);
    const panel=page.getByRole('region',{name:`${preview.sectorTitle} source quotations`,exact:true});const generate=panel.getByRole('button',{name:'Generate sector summary',exact:true});await until(()=>generate.isEnabled());
    assert.ok((await panel.innerText()).includes(`${preview.selectedCount} source stories selected · ${preview.eligibleCount} eligible · ${preview.excludedCount} excluded`));
    await panel.getByText('Review selected source inputs',{exact:true}).click();for(const s of preview.sources){await until(async()=>(await panel.innerText()).includes(s.title));assert.equal(await panel.getByRole('link',{name:s.url,exact:true}).innerText(),s.url);}
    await shot('preview',panel);await generate.click();
    await until(async()=>{if(await panel.locator('.sector-summary-output').count())return true;const error=panel.getByRole('alert');if(await error.count())throw Error(await error.innerText());return false;},240000);
    const output=panel.locator('.sector-summary-output');evidence.uiOutputText=await output.innerText();evidence.uiBullets=await panel.locator('.sector-summary-bullets > li').evaluateAll(items=>items.map(li=>({text:li.querySelector('p')?.textContent,citations:[...li.querySelectorAll('[role=link]')].map(e=>e.textContent)})));save();
    assert.match(evidence.uiOutputText,/AI-selected source quotations · unverified/);assert.match(evidence.uiOutputText,/not factual entailment/);assert.ok(evidence.uiOutputText.includes(model));
    for(const s of preview.sources){for(const text of [s.title,s.inputLabel,s.attribution,s.outputLabel,s.url])assert.ok(evidence.uiOutputText.includes(text),`Missing input notice: ${text}`);assert.equal(await output.getByRole('link',{name:s.url,exact:true}).innerText(),s.url);}
    for(const b of evidence.uiBullets){assert.ok(b.text&&b.citations.length);for(const label of b.citations){const s=preview.sources.find(s=>label===`${s.id} · ${s.sourceName} ↗`);assert.ok(s,`Unknown visible citation ${label}`);}}
    evidence.uiMetrics=await page.evaluate(()=>({title:document.title,lang:document.documentElement.lang,bodyWidth:document.body.scrollWidth,viewportWidth:innerWidth,panelOverflow:[...document.querySelectorAll('.sector-summary,.sector-summary-output')].some(e=>e.scrollWidth>e.clientWidth+1)}));
    await shot('generated',panel);await output.getByRole('heading',{name:'AI-selected source quotations · unverified',exact:true}).scrollIntoViewIfNeeded();await shot('window');
    // A panel can exceed its scrolling parent: capture each input in the actual
    // viewport so attribution below the fold is not silently clipped evidence.
    for(let i=0;i<preview.sources.length;i++){await output.locator('.sector-summary-sources > li').nth(i).scrollIntoViewIfNeeded();await shot(`source-input-${i+1}`);}
    evidence.navigationScope='Visible citation IDs and original-URL controls mapped to host-owned source URLs; external browser navigation was not exercised.';
    const after=await invoke({op:'snapshot',profileId:'default'});for(const a of selected)assert.deepEqual(after.articles.find(x=>x.id===a.id),a);assert.equal(evidence.uiMetrics.panelOverflow,false);return {originalInputsUnchanged:true,bullets:evidence.uiBullets.length,metrics:evidence.uiMetrics};
  });
  evidence.frontendAfter=manifest('src');evidence.distAfter=manifest('dist');
  evidence.frontendStable=JSON.stringify(evidence.frontendBefore)===JSON.stringify(evidence.frontendAfter);evidence.distStable=JSON.stringify(evidence.distBefore)===JSON.stringify(evidence.distAfter);
  evidence.latestFrontendVerified=(values.build||evidence.releaseVerified===true)&&evidence.latestFrontendAtStart&&evidence.frontendStable&&evidence.distStable;
  evidence.behaviorPassed=true;evidence.passed=evidence.latestFrontendVerified;
  if(!evidence.latestFrontendVerified)evidence.freshnessBlocker='Behavior verified only for recorded embedded dist; latest frontend freshness not established (source newer than dist, concurrent edits, or no witnessed build). Rerun after owner builds latest frontend.';
} catch(e) { evidence.passed=false;evidence.error=String(e.stack||e);if(page&&!page.isClosed()){evidence.failureBody=await page.locator('body').innerText().catch(String);await shot('failure').catch(()=>{});} }
finally {
  evidence.finishedAt=new Date().toISOString();save();
  if(browser)await browser.close().catch(()=>{});
  if(app?.pid&&app.exitCode===null){const stop=spawnSync('taskkill',['/PID',String(app.pid),'/T','/F'],{encoding:'utf8'});evidence.ownedAppCleanup={status:stop.status,stdout:stop.stdout,stderr:stop.stderr};}
  try {const r=await fetch('http://127.0.0.1:11434/api/tags',{signal:AbortSignal.timeout(10000)});evidence.parentOllamaStillHealthy=r.ok&&(await r.json()).models.some(m=>m.name===model);}catch(e){evidence.parentOllamaHealthError=String(e);}save();
}
console.log(JSON.stringify({evidence:`${base}.json`,passed:evidence.passed,behaviorPassed:evidence.behaviorPassed,latestFrontendVerified:evidence.latestFrontendVerified,checks:evidence.checks.map(c=>({name:c.name,passed:c.passed})),error:evidence.error,freshnessBlocker:evidence.freshnessBlocker},null,2));
process.exitCode=evidence.passed?0:1;
