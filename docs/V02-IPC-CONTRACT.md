# v0.2 integration supplement

The original IPC contract remains authoritative for existing operations. All new requests use `dispatch` and errors are user-safe strings.

## Reader/media
`media_load {articleId,index,profileId?}` resolves media from the stored article; renderer URLs are ignored. Index 0–7. The host requires current source `mediaAllowed:true` and `storage:excerpt`. Response `{kind,mimeType,bytes,dataUrl}`; `bytes` is byte count. Only explicit user actions fetch media. Original-site fallback remains available. No web iframe, remote script, autoplay or unrestricted browser networking. CSP permits data media only in addition to self.

## Daily brief
`daily_brief {profileId,date?:YYYY-MM-DD}` returns `{date,dayStart,dayEnd,generatedAt,coverageLabel,articleCount,undatedCount,sectors}`. These timestamps are UNIX seconds, consistent with Article.publishedAt. Sectors `{id,title,articleCount,sourceCount,items,outline}`; items `{id,title,url,sourceId,sourceName,publishedAt,kind,excerpt,aiAllowed}`. Dates use explicit local calendar midnights; future publications excluded. Undated count refers to first retrieval during the selected day, not publication. Outlines are deterministic headline lists, not AI summaries. Sector counts overlap for multi-topic stories and must not be summed as unique total. Existing summarize operation can generate permitted item summaries on demand.

## Local AI
`local_ai_connect {}` checks fixed `http://127.0.0.1:11434/api/tags`, requires exact installed `qwen3:4b-instruct-2507-q4_K_M`, and saves enabled/consented Ollama provider through the existing cancellation gate. Returns provider object. No cloud providers or source permissions are enabled by this operation. Explicit UI action consents to local processing only; text still requires source/item permission. The separate portable runtime is not bundled into the application.

## Live discussion (implementation in progress)
`live_status {}` returns `{enabled,state,lastEventAt?,lastItemAt?,retryAt?,message?,items}`. `live_set {enabled:boolean}` controls one shared backend SSE connection; default off. State `off|connecting|connected|backoff`; event times ISO 8601; item `{id,title,url,discussionUrl,by,publishedAt,receivedAt,score}`. The frontend may read local status every second; this does not poll publishers every second. Keep-alives and initial snapshots are not new story events. Hacker News items are discussion metadata and are never sent for AI processing.

## Native screens (implementation in progress)
`window_monitors {}` returns `{monitors:[{id,name,x,y,width,height,scaleFactor,current}],currentLabel}`. Work areas use physical signed coordinates. `window_move {monitorId,layout:full|left|right}` moves the invoking window, including detached workspaces. Unknown/disconnected monitors fail rather than moving to a different display. Existing detach/reattach ownership is unchanged.

## Workspaces
Tab mode additionally accepts `briefing` and `live`. Existing revision validation and native ownership apply. Read-only briefing/media/status operations do not broadcast data-changed, preventing multi-window status polling loops.
