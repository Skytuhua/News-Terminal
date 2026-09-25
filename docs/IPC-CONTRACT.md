# News Terminal IPC contract v1

Implementation contract for parallel work. Rust host is authoritative. Frontend calls `invoke('dispatch', {request: {op, ...fields}})`. Responses are JSON values, errors are safe user-facing strings. All timestamps Unix seconds; IDs strings. Optional fields default explicitly.

## Snapshot
`{op:'snapshot',profileId:'default'}` -> `{replacementToken:string,profiles:Profile[],profile:Profile,sources:Source[],articles:Article[],watchlists:Watchlist[],workspace:Workspace,providers:Provider[],lastRefresh:number|null}`
Profile `{id,name,preferences:{topics:string[],regions:string[],languages:string[],sources:string[],keywords:string[],excludeKeywords:string[],diversityCap:number},quietHours:{enabled:boolean,start:string,end:string},alertsEnabled:boolean,lastVisit:number,previousVisit:number}`.
Source `{id,name,url,homepage,kind:'reporting'|'discussion'|'official notice'|'opinion',topics:string[],region,language,enabled:boolean,status:string,lastSuccess:number|null,termsUrl:string,storage:'excerpt'|'metadata',etag?:string,lastModified?:string,accessMode?:'free-keyless'|'approval-free'|'external-only',sourceAdapter?:string,publisher?:string,imagesAvailable?:boolean,mediaAllowed?:boolean,aiAllowed?:boolean}`.
Article `{id,sourceId,sourceName,title,url,excerpt,publishedAt:number|null,firstSeen:number,updatedAt:number,topics:string[],sections?:('ai'|'technology'|'stocks'|'others')[],topicLabels?:string[],classificationVersion?:number,classificationReasons?:string[],region,language,kind,read:boolean,saved:boolean,hidden:boolean,groupId:string,reasons:string[],score:number,history:{at:number,title:string,excerpt:string}[]}`.
Watchlist `{id,name,keywords:string[],topics:string[],sources:string[],alerts:boolean}`.
Workspace `{tabs:{id,title,topic:string,query:string,mode:'all'|'saved'|'brief'|'watchlist',watchlistId?:string,selectedId?:string}[],activeTabId:string}`.
Provider `{id,name,kind:'ollama'|'gemini'|'groq',model:string,enabled:boolean,consented:boolean,hasKey:boolean}`. Keys never returned.

## 0.4 read-only additions

- `hidden_stories {profileId}` -> `Article[]`: required valid profile; all retained hidden items ordered `firstSeen DESC, id ASC`, with that profile's stored state. Independent of ordinary preference ranking and snapshot limits. Does not protect hidden items from existing retention cleanup.
- `workspace_get {profileId}` -> `Workspace & {replacementToken:string}`: required valid profile; identical durable workspace/revision to `snapshot.workspace`, plus the same replacement token as `snapshot.replacementToken`, without loading articles. Writes require both replacement identity and revision CAS.
- Both operations are read-only and do not emit `data-changed`.
- Workspace tabs additionally support mode `hidden` (alongside modes introduced in subsequent contracts). Backups containing this mode require a compatible host; older binaries may reject them.
- Source scheduling metadata may include `lastAttempt`, `retryAt`, `failures` and `refreshMinutes`. Missing legacy values are unknown, not fabricated successful retrieval. Eligibility respects both interval and backoff and is not an exact scheduled execution time.

## Focused free-news additions

- Workspace tabs may include `section:'ai'|'technology'|'stocks'|'others'`. Old topic-only tabs remain valid and retain their original behavior.
- `model_catalog {}` -> `{source,sourceUrl,observedAt,totalCount,complete,models:[{id,name,provider,contextLength,inputModalities,outputModalities,supportedParameters,pricing,addedToOpenRouter?,observedAt,sourceUrl,releaseDateLabel,inferenceNote}]}`. This is metadata only and never creates/uses provider keys.
- `benchmark_catalog {}` -> `{observedAt,comparisonNote,panels:[{source,license,licenseUrl,observedAt,rows:[{source,benchmark,model,category,metric,unit,value,confidenceLow?,confidenceHigh?,votes?,rank?,publishedAt?,observedAt,higherIsBetter,license,sourceUrl}]}]}`. Panels are not globally rankable against each other.
- `source_add` responses now include free-only directory metadata for custom feeds (`accessMode:'approval-free'`, `sourceAdapter:'feed'`, `publisher`, `imagesAvailable:false`) and `mediaAllowed:false` unless explicitly attested.
- `source_update` also accepts `mediaAllowed` for custom feeds. Catalog media rights still require reviewed catalog updates and are not user-overridable.
- The service layer rejects non-Ollama summary providers in zero-paid mode with a safe user-facing error before cloud credentials or outbound inference are used.

## Integration clarifications

- Source and Article include `aiAllowed:boolean`, default false. Feed reading/storage permission is distinct from AI processing permission. Host and service enforce it; UI explains disabled summaries. Custom sources require an explicit permission declaration to enable AI.
- Workspace includes `revision:number`. `workspace_save` requires top-level `replacementToken:string` and revision CAS (`expectedRevision:number`, or the existing fallback to `workspace.revision`). Reject stale revisions instead of overwriting other windows. Only ordinary revision conflicts within the **same replacement token** may reload and reapply the user's specific intent; replacement invalidates the intent rather than retargeting it.
- `window_context` also returns `detachedTabs:{profileId:string,tabId:string,label:string}[]`. Tabs remain in the DB; native ownership determines which window shows them. Detached UI locks to its context profile/tab. Close detached window reattaches; main close preserves layout and exits.
- See `.hermes/work-ownership.md` for authoritative concurrent file ownership.

## Mutations
- `profile_create {name}` -> Profile
- `profile_update {profileId,preferences?,quietHours?,alertsEnabled?}` -> Profile
- `profile_reset {profileId}` -> Profile (preserve saved/read states)
- `visit {profileId}` -> Profile (once per profile/session, stable previousVisit)
- `article_state {profileId,articleId,replacementToken,read?,saved?,hidden?}` -> null
- `source_update {sourceId,enabled}` -> null
- `source_add {name,url,topics:string[],region,language,kind,termsUrl,storage}` -> Source (custom feed; explicitly user permitted)
- `watchlist_save {profileId,watchlist:{id?,name,keywords,topics,sources,alerts}}` -> Watchlist
- `watchlist_delete {profileId,id}` -> null
- `workspace_save {profileId,workspace,replacementToken,expectedRevision?}` -> null
- `group_split {profileId,articleId,replacementToken}` -> null
- `search {profileId,query}` -> Article[] (SQLite FTS cached search)
- `refresh {}` -> `{updated:number,failed:number}` then snapshot; network isolated per source
- `provider_save {provider:{id,name,kind,model,enabled,consented},apiKey?:string}` -> null (OS keyring)
- `summarize {profileId,articleId,requestId}` -> `{text,provider,model,generatedAt:number,scope:'feed excerpt',url}`
- `summary_cancel {requestId}` -> null
- `export {}` -> string JSON backup, no secrets
- `import {data:string}` -> null (validate all before transaction)

## Native integration owned by parent
- `open_original {url}` -> null, http/https only, system browser
- `detach_tab {profileId,tabId}` -> null, real Tauri native window
- `reattach_tab {profileId,tabId}` -> null
- `window_context {}` -> `{label,detached:boolean,profileId?:string,tabId?:string,detachedTabs:{profileId,tabId,label}[]}`; main includes its persisted profile.
- `window_set_profile {profileId}` -> null; main window only, validates profile and durably saves it.
- Successful import reconciles native ownership and closes orphan detached windows; startup also prunes stale ownership before opening windows.
Native commands also go through dispatch. Host emits `data-changed` after mutations/refresh. A committed import additionally emits `database-replaced` to **every window**, including surviving detached windows with unchanged profile/tab IDs. This notification is emitted even if subsequent reporting of native reconciliation failure rejects the command. The normal `data-changed` event must not substitute for this replacement boundary.

## Replacement boundary (0.4 required wire change)

- The database owns an in-memory opaque UUID `replacementToken`, created at database open and rotated **only after successful import COMMIT**. It is not a workspace revision, profile ID, source receipt, permission grant, secret, or persisted schema field. Failed validation/rollback and ordinary mutations keep it unchanged. Reopening obtains a new identity.
- `workspace_save`, **all** `article_state` variants (including Read, Saved, Hide, Undo and Hidden Restore), and `group_split` reject missing, null, malformed, or mismatched tokens with `Database replaced: reload before making a new change`. Enforcement occurs in `Database::request` under the same exclusive database access as the write/import, not merely in a renderer or optional frontend wrapper. A correct workspace revision cannot bypass replacement validation.
- Capture the token from the snapshot that supplied the user's visible context; pin it for the intent's entire lifetime, including ordinary revision conflict retries. A workspace-only pre-read must match that captured token. Never fetch a new token just to resubmit an obsolete intent. New actions after replacement must originate from a new authoritative read.
- `workspace_get` adds the token without persisting it. `workspace_save` strips that transport-only member from the nested workspace before validation/storage, but still requires the **top-level** token: a nested token alone is not a guard. `snapshot.workspace` remains the durable shape. Exported backups contain neither replacement identity nor new source/AI/media authority; importing a token as a workspace backup field is rejected.
- `import` still returns `null`; `hidden_stories` still returns `Article[]`; `window_context` is unchanged. Existing callers must migrate guarded writes—legacy tokenless writes deliberately fail closed. Host-issued tokens do not bypass existing profile/article validation, source rights, or revision CAS.
- On `database-replaced`, renderers synchronously invalidate queued intents, debounce timers, acknowledgement continuations, recovery surfaces and old snapshot reads. They replace the read coordinator before reloading so held old reads cannot block new reads, and remount Hidden recovery. Local import uses the same invalidation routine. An ordinary `data-changed` retains stable-reading/coalescing behavior.

Example (a **new** workspace action; keep `replacementToken` fixed across CAS retries):

```ts
const snapshot = await dispatch({op: 'snapshot', profileId});
const replacementToken = snapshot.replacementToken;
const latest = await dispatch({op: 'workspace_get', profileId});
if (latest.replacementToken !== replacementToken) return; // cancel old intent
await dispatch({op: 'workspace_save', profileId, replacementToken,
  expectedRevision: latest.revision, workspace: applyIntent(latest)});
```

Native smoke callers were migrated to capture tokens from their originating snapshots. The v04 smoke parity assertion compares the durable workspace separately and checks token equality; its Restore assertion now includes the required top-level token. Re-run these scripts only against a rebuilt executable; old-binary evidence is not evidence for this boundary.

## Service interface
`src-tauri/src/services.rs` implemented by services agent:
- `pub async fn fetch_feed(source: &serde_json::Value) -> Result<serde_json::Value,String>` returns `{notModified:boolean,etag?:string,lastModified?:string,articles:[{id:string,title,url,excerpt,publishedAt:number|null}]}`. IDs deterministic URL/GUID hash.
- `pub async fn summarize(providers:&[serde_json::Value],article:&serde_json::Value,cancel:std::sync::Arc<std::sync::atomic::AtomicBool>) -> Result<serde_json::Value,String>`.
- `pub fn save_key(provider_id:&str,key:&str)->Result<(),String>`; `pub fn has_key(provider_id:&str)->bool`.
Dependencies backend may add: reqwest 0.12 rustls/json/stream, feed-rs 2, futures-util 0.3, url 2, sha2 0.10, keyring 3 windows-native, html-escape 0.2, chrono 0.4, tokio 1 time/sync.

Backend owns data/schema/ranking/grouping/alerts/dispatch + Cargo config. Services agent exclusively owns services.rs and fixtures/service tests. UI agent exclusively owns src/**, tests/** (frontend), package.json/config, index.html. Parent owns native.rs and project docs/release integration. Use minimal native CSS, never mock headlines in production browser mode; browser tests may inject a clearly test-only IPC adapter.
