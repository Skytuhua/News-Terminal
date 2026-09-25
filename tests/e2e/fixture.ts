import type { Page } from "@playwright/test";
export async function fixture(
  page: Page,
  options: { visitEvents?: boolean; savedProfile?: boolean; v02?: boolean } = {},
) {
  await page.addInitScript((options) => {
    (window as any).__EVENT_ON_VISIT__ = options.visitEvents;
    const preferences = {
      topics: [],
      regions: [],
      languages: [],
      sources: [],
      keywords: [],
      excludeKeywords: [],
      diversityCap: 0.5,
    };
    const profile = {
      id: "default",
      name: "World desk",
      preferences,
      quietHours: { enabled: false, start: "22:00", end: "07:00" },
      alertsEnabled: false,
      lastVisit: 200,
      previousVisit: 100,
    };
    const source = {
      id: "science",
      name: "Science Wire",
      url: "https://example.org/feed",
      homepage: "https://example.org",
      kind: "reporting",
      topics: ["science"],
      region: "world",
      language: "en",
      enabled: true,
      status: "Healthy",
      lastSuccess: 200,
      termsUrl: "https://example.org/terms",
      storage: "excerpt",
      aiAllowed: true,
      accessMode: "free-keyless",
      sourceAdapter: "feed",
      publisher: "Science Wire",
      imagesAvailable: true,
    };
    const article = {
      id: "a",
      sourceId: "science",
      sourceName: "Science Wire",
      title: "Researchers map a new lunar water reserve",
      url: "https://example.org/moon",
      excerpt:
        "A research team has published its observations of water near the lunar south pole.",
      publishedAt: 200,
      firstSeen: 200,
      updatedAt: 200,
      topics: ["science"],
      region: "world",
      language: "en",
      kind: "reporting",
      read: false,
      saved: false,
      hidden: false,
      groupId: "moon",
      reasons: ["Matches science", "Recent report"],
      score: 1,
      history: [],
      aiAllowed: true,
    };
    const initial = {
      profiles: [profile],
      profile,
      sources: [source],
      articles: [
        article,
        {
          ...article,
          id: "b",
          sourceName: "Orbital Review",
          title: "What lunar water observations can tell us",
          url: "https://example.org/moon-review",
          excerpt: "An independent look at the new observations.",
          kind: "opinion",
        },
        {
          ...article,
          id: "c",
          title: "New chips improve battery efficiency",
          excerpt: "New processors use less energy under load.",
          topics: ["technology"],
          groupId: "chips",
          url: "https://example.org/chips",
        },
      ],
      watchlists: [],
      workspace: {
        tabs: [
          { id: "home", title: "Headlines", topic: "", query: "", mode: "all" },
        ],
        activeTabId: "home",
        revision: 0,
      },
      providers: [
        {
          id: "ollama",
          name: "Ollama",
          kind: "ollama",
          model: "llama3.2",
          enabled: false,
          consented: false,
          hasKey: false,
        },
      ],
      lastRefresh: 200,
    };
    if (options.v02) {
      const at = new Date("2026-09-23T09:20:00").getTime() / 1000;
      initial.articles.forEach(a => { a.publishedAt = at; a.firstSeen = at; a.updatedAt = at; });
      initial.lastRefresh = at;
      (initial.articles[0] as any).media = [
        { kind: "image", url: "https://example.org/fixture.png", caption: "Fixture lunar image", credit: "Test fixture", playback: "inline" },
        { kind: "video", url: "https://example.org/fixture.mp4", caption: "Fixture video", playback: "inline" },
        { kind: "video", url: "https://www.youtube.com/watch?v=fixture", caption: "External discovery", playback: "external" },
      ];
    }
    let replacementToken = crypto.randomUUID();
    let s: any =
      JSON.parse(localStorage.getItem("fixture-state") || "null") || initial;
    const byProfile: any = { default: s };
    if (options.savedProfile) {
      const p = { ...structuredClone(profile), id: "desk-b", name: "Desk B" };
      s.profiles = [profile, p];
      byProfile[p.id] = { ...structuredClone(initial), profile: p, profiles: s.profiles };
    }
    let mainProfile = localStorage.getItem("fixture-main-profile") || (options.savedProfile ? "desk-b" : "default");
    const calls: any[] = [];
    const detached: any[] = [];
    let liveEnabled = false;
    let currentMonitor = "screen-1";
    const liveStatus = () => ({ enabled: liveEnabled, state: liveEnabled ? "connected" : "off", lastEventAt: liveEnabled ? "2026-09-23T10:00:00Z" : null, lastItemAt: liveEnabled ? "2026-09-23T09:58:20Z" : null,
      message: "Fixture stream status", items: liveEnabled ? [{ id: "hn-fixture", title: "Fixture discussion about open science", url: "https://example.org/science", discussionUrl: "https://news.ycombinator.com/item?id=1", by: "fixture", publishedAt: "2026-09-23T09:50:00Z", receivedAt: "2026-09-23T09:58:20Z", score: 4 }, ...((window as any).__LIVE_ITEMS__ || [])] : [] });
    const imagePrefs: Record<string, any> = {};
    (window as any).__TEST_CALLS__ = calls;
    (window as any).__TEST_PATCH__ = (patch: any) => Object.assign(s, patch);
    (window as any).__TEST_SNAPSHOT__ = (profileId?:string) => structuredClone(profileId ? byProfile[profileId] : s);
    (window as any).__NEWS_TEST_DISPATCH__ = async (r: any) => {
      calls.push({ ...r, apiKey: r.apiKey ? "[redacted]" : undefined });
      await (window as any).__TEST_BEFORE_DISPATCH__?.(r);
      if ((window as any).__FAIL_OP__ === r.op)
        throw new Error("Fixture service unavailable");
      if (r.op === "window_context")
        return {
          label: "main",
          detached: false,
          profileId: byProfile[mainProfile] ? mainProfile : "default",
          detachedTabs: detached,
          ...(window as any).__TEST_CONTEXT__,
        };
      if (r.op === "window_set_profile") {
        if (!byProfile[r.profileId]) throw new Error("Unknown profile");
        mainProfile = r.profileId;
        localStorage.setItem("fixture-main-profile", mainProfile);
        await (window as any).__TEST_AFTER_PROFILE_WRITE__?.(r);
        return null;
      }
      if (r.op === "workspace_get" || r.op === "hidden_stories") {
        const target = byProfile[r.profileId];
        if (!target) throw new Error("Unknown profile");
        const result = structuredClone(r.op === "workspace_get" ? {...target.workspace, replacementToken}
          : (target.retainedArticles || target.articles).filter((a:any) => a.hidden).sort((a:any,b:any) => b.firstSeen - a.firstSeen || a.id.localeCompare(b.id)));
        await (window as any).__TEST_AFTER_DISPATCH__?.(r);
        return result;
      }
      if (r.op === "snapshot") {
        if (!byProfile[r.profileId]) throw new Error("Unknown profile");
        if ((window as any).__TEST_SNAPSHOT_DELAY__)
          await new Promise(resolve => setTimeout(resolve, (window as any).__TEST_SNAPSHOT_DELAY__));
        if (byProfile[r.profileId]) s = byProfile[r.profileId];
        const snapshot = {...structuredClone(s), replacementToken};
        await (window as any).__TEST_AFTER_DISPATCH__?.(r);
        return snapshot;
      }
      if (r.op === "visit") {
        if (
          (window as any).__EVENT_ON_VISIT__ &&
          calls.filter((x) => x.op === "visit").length < 4
        )
          window.dispatchEvent(new Event("data-changed"));
        return s.profile;
      }
      if (options.v02 && r.op === "window_monitors") return { currentLabel: "main", monitors: [
        { id: "screen-1", name: "Primary display", x: 0, y: 0, width: 1920, height: 1080, scaleFactor: 1, current: currentMonitor === "screen-1" },
        { id: "screen-2", name: "Left display", x: -2560, y: 0, width: 2560, height: 1440, scaleFactor: 1.25, current: currentMonitor === "screen-2" }] };
      if (options.v02 && r.op === "window_move") { currentMonitor = r.monitorId; return null; }
      if (options.v02 && r.op === "local_ai_connect") {
        const p = { id: "ollama", name: "Ollama", kind: "ollama", model: "qwen3:4b-instruct-2507-q4_K_M", enabled: true, consented: true, hasKey: false };
        s.providers = s.providers.filter((v: any) => v.id !== p.id); s.providers.push(p); return p;
      }
      if (options.v02 && r.op === "live_status") return liveStatus();
      if (options.v02 && r.op === "live_set") { liveEnabled = r.enabled; return liveStatus(); }
      if (options.v02 && r.op === "model_catalog") return {
        source: "OpenRouter Models API",
        sourceUrl: "https://openrouter.ai/docs/guides/overview/models",
        observedAt: 1790184000,
        complete: true,
        totalCount: 1,
        models: [{
          id: "openai/gpt-fixture",
          name: "GPT Fixture",
          provider: "openai",
          contextLength: 128000,
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportedParameters: ["tools"],
          pricing: { prompt: "0", completion: "0.000001" },
          addedToOpenRouter: 1790000000,
          observedAt: 1790184000,
          sourceUrl: "https://openrouter.ai/openai/gpt-fixture",
          releaseDateLabel: "Added to OpenRouter",
          inferenceNote: "Metadata only. Free model labels are not permission to run inference.",
        }],
      };
      if (options.v02 && r.op === "benchmark_catalog") return {
        observedAt: 1790184000,
        comparisonNote: "No universal score. Arena preference ratings and SWE-bench resolved rates use different methods, licenses and units.",
        panels: [
          {
            source: "Arena leaderboard dataset",
            license: "CC BY 4.0",
            licenseUrl: "https://huggingface.co/datasets/lmarena-ai/leaderboard-dataset",
            rows: [{
              model: "Fixture Arena Model",
              benchmark: "Arena Text",
              metric: "Arena preference rating",
              unit: "rating",
              value: 1250,
              confidenceLow: 1200,
              confidenceHigh: 1300,
              license: "CC BY 4.0",
            }],
          },
          {
            source: "SWE-bench leaderboard",
            license: "CC BY-NC 4.0",
            licenseUrl: "https://raw.githubusercontent.com/SWE-bench/swe-bench.github.io/master/LICENSE",
            rows: [{
              model: "Fixture SWE Agent",
              benchmark: "SWE-bench Verified",
              metric: "Resolved rate",
              unit: "fraction",
              value: 0.45,
              license: "CC BY-NC 4.0",
            }],
          },
        ],
      };
      if (r.op === "media_preferences") return { automatic: false, mode: "visual", ...imagePrefs[r.profileId || "default"], replacementToken: replacementToken };
      if (r.op === "media_preferences_set") {
        if (r.replacementToken !== replacementToken) throw new Error("Database replaced");
        imagePrefs[r.profileId || "default"] = { automatic:r.automatic, mode:r.mode };
        window.dispatchEvent(new Event("media-policy-changed"));
        return { ...imagePrefs[r.profileId || "default"], replacementToken:replacementToken };
      }
      if (r.op === "media_cancel") return { cancelled:true };
      if (options.v02 && r.op === "media_load") {
        await new Promise(resolve => setTimeout(resolve, (window as any).__MEDIA_DELAY__ || 0));
        const mediaArticle = s.articles.find((article:any) => article.id === r.articleId);
        if (!mediaArticle?.media?.[r.index]) throw new Error("Article media is unavailable");
        if ((window as any).__MEDIA_BAD_URL__) return { kind: "image", mimeType: "image/png", bytes: 1, dataUrl: "https://example.org/unsafe.png" };
        return r.index === 0
          ? { kind: "image", mimeType: "image/png", bytes: 68, dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=" }
          : { kind: "video", mimeType: "video/mp4", bytes: 4, dataUrl: "data:video/mp4;base64,AAAAAA==" };
      }
      if (options.v02 && r.op === "daily_brief") {
        const day = r.date || "2026-09-23";
        if ((window as any).__BRIEF_DELAY__ && day === "2026-09-22") await new Promise(resolve => setTimeout(resolve, 800));
        const start = new Date(`${day}T00:00:00`);
        const end = new Date(start); end.setDate(end.getDate() + 1);
        return { date: day, dayStart: start.getTime() / 1000, dayEnd: end.getTime() / 1000, generatedAt: start.getTime() / 1000 + 36000,
          coverageLabel: "Fixture cached coverage only", articleCount: 2, undatedCount: 1,
          sectors: [{ id: "science", title: "Science", articleCount: 2, sourceCount: 2,
            items: s.articles.slice(0, 2), outline: ["Two fixture headlines from the local cache."] },
            { id: "markets", title: "Markets", articleCount: 0, sourceCount: 0, items: [], outline: [] }] };
      }
      if (options.v02 && r.op === "sector_summary_preview") {
        const sources = s.articles.slice(0, 2).filter((a: any) => a.aiAllowed && !a.hidden).map((a: any, i: number) => ({
          id: `S${i + 1}`, articleId: a.id, title: a.title, url: a.url, sourceName: a.sourceName,
          publishedAt: a.publishedAt, inputLabel: i ? "Headline-only input" : "Feed excerpt input",
          attribution: "Fixture source attribution", outputLabel: "Fixture generated analysis; not an official agency product.",
        }));
        return { profileId: r.profileId, date: r.date, sectorId: r.sectorId, sectorTitle: "Science",
          fingerprint: `fixture:${r.profileId}:${r.date}:${JSON.stringify(sources)}`, eligibleCount: sources.length,
          selectedCount: sources.length, excludedCount: 2 - sources.length, limit: 12, sources,
          coverageLabel: "Selected cached stories only; not exhaustive sector coverage.", ...(window as any).__SECTOR_PREVIEW_PATCH__ };
      }
      if (options.v02 && r.op === "sector_summarize") {
        return { profileId: r.profileId, date: r.date, sectorId: r.sectorId, fingerprint: r.fingerprint,
          provider: "Ollama", model: "llama3.2", generatedAt: 1790184000,
          // Synthetic host response: extract from the same declared input scope.
          bullets: s.articles.slice(0, 2).map((a: any, i: number) => {
            const sourceId = `S${i + 1}`;
            const quote = i ? a.title : a.excerpt;
            return { text: quote, citations: [sourceId], evidence: [{ sourceId, quote }] };
          }),
          sources: s.articles.slice(0, 2).map((a: any, i: number) => ({
            id: `S${i + 1}`, articleId: a.id, title: a.title, url: a.url, sourceName: a.sourceName,
            publishedAt: a.publishedAt, inputLabel: i ? "Headline-only input" : "Feed excerpt input",
            attribution: "Fixture source attribution", outputLabel: "Fixture generated analysis; not an official agency product.",
          })), coverageLabel: "Selected cached stories only; not exhaustive sector coverage.",
          warning: "AI-selected quotations, unverified. Exact text and source IDs were checked mechanically, not factual entailment, context or truth. Excerpts may be incomplete. Check the original sources.", ...(window as any).__SECTOR_RESULT_PATCH__ };
      }
      if (r.op === "search")
        return s.articles.filter((a: any) =>
          (a.title + " " + a.excerpt)
            .toLowerCase()
            .includes(r.query.toLowerCase()),
        );
      if (['article_state','group_split'].includes(r.op) && r.replacementToken !== replacementToken)
        throw new Error("Database replaced: reload before making a new change");
      if (r.op === "article_state")
        Object.assign(
          (byProfile[r.profileId].retainedArticles || byProfile[r.profileId].articles).find((a: any) => a.id === r.articleId),
          Object.fromEntries(
            ["read", "saved", "hidden"]
              .filter((k) => k in r)
              .map((k) => [k, r[k]]),
          ),
        );
      if (r.op === "workspace_save") {
        if (r.replacementToken !== replacementToken) throw new Error("Database replaced: reload before making a new change");
        const s = byProfile[r.profileId];
        if (!s) throw new Error("Unknown profile");
        if ((window as any).__TEST_CONFLICT_ONCE__) {
          (window as any).__TEST_CONFLICT_ONCE__ = false;
          s.workspace.tabs.push({
            id: "other-window",
            title: "Other window",
            mode: "all",
            topic: "",
            query: "",
          });
          s.workspace.revision++;
          throw new Error("Workspace revision conflict");
        }
        if (r.expectedRevision !== s.workspace.revision)
          throw new Error("Workspace revision conflict");
        const {replacementToken: _token, ...workspace} = r.workspace;
        s.workspace = { ...workspace, revision: s.workspace.revision + 1 };
      }
      if (r.op === "refresh") {
        if ((window as any).__TEST_ADD_STORY__) {
          s.articles.unshift({
            ...article,
            id: "fresh",
            title: "Newly arrived report",
          });
          (window as any).__TEST_ADD_STORY__ = false;
        }
        return (window as any).__TEST_REFRESH_RESULT__ || { updated: 1, failed: 0 };
      }
      if (r.op === "profile_create") {
        const p = {
          ...structuredClone(profile),
          id: crypto.randomUUID(),
          name: r.name,
        };
        s.profiles.push(p);
        const next = structuredClone(initial);
        next.profile = p;
        next.profiles = s.profiles;
        byProfile[p.id] = next;
        return p;
      }
      if (r.op === "profile_update")
        Object.assign(
          s.profile,
          Object.fromEntries(
            ["preferences", "quietHours", "alertsEnabled"]
              .filter((k) => k in r)
              .map((k) => [k, r[k]]),
          ),
        );
      if (r.op === "profile_reset")
        s.profile.preferences = structuredClone(preferences);
      if (r.op === "source_update") {
        Object.assign(s.sources.find((v: any) => v.id === r.sourceId), Object.fromEntries(["enabled", "mediaAllowed"].filter(k => k in r).map(k => [k, r[k]])));
        if (r.mediaAllowed === false) for (const profile of Object.values(byProfile) as any[]) {
          for (const article of profile.articles) if (article.sourceId === r.sourceId) delete article.media;
        }
        window.dispatchEvent(new Event("media-policy-changed"));
        window.dispatchEvent(new Event("data-changed"));
      }
      if (r.op === "source_add")
        s.sources.push({
          ...source,
          ...r,
          id: crypto.randomUUID(),
          status: "Not fetched",
        });
      if (r.op === "watchlist_save") {
        const w = { ...r.watchlist, id: r.watchlist.id || crypto.randomUUID() };
        s.watchlists = s.watchlists.filter((x: any) => x.id !== w.id);
        s.watchlists.push(w);
      }
      if (r.op === "watchlist_delete")
        s.watchlists = s.watchlists.filter((x: any) => x.id !== r.id);
      if (r.op === "group_split")
        s.articles.find((a: any) => a.id === r.articleId).groupId = r.articleId;
      if (r.op === "provider_save") {
        const i = s.providers.findIndex((p: any) => p.id === r.provider.id);
        const p = {
          ...r.provider,
          hasKey: !!r.apiKey || s.providers[i]?.hasKey,
        };
        if (i < 0) s.providers.push(p);
        else s.providers[i] = p;
      }
      if (r.op === "summarize") {
        await new Promise((resolve) => setTimeout(resolve, 500));
        return {
          text: "Fixture summary of the lunar observations.",
          attribution: "Fixture source attribution",
          outputLabel: "Fixture generated analysis; not an official agency product.",
          inputLabel: "Headline-only input — the feed does not contain the full statement.",
          provider: "Ollama",
          model: "llama3.2",
          scope: "feed excerpt",
          generatedAt: 200,
          url: article.url,
        };
      }
      if (r.op === "detach_tab")
        detached.push({
          profileId: r.profileId,
          tabId: r.tabId,
          label: r.tabId,
        });
      if (r.op === "reattach_tab")
        detached.splice(
          detached.findIndex((x) => x.tabId === r.tabId),
          1,
        );
      if (r.op === "export") return JSON.stringify(s);
      if (r.op === "import") {
        s = JSON.parse(r.data);
        delete s.replacementToken;
        replacementToken = crypto.randomUUID();
        for (const id of Object.keys(byProfile)) delete byProfile[id];
        byProfile[s.profile.id] = s;
        if (!byProfile[mainProfile]) mainProfile = "default";
        Object.keys(imagePrefs).forEach(key => delete imagePrefs[key]);
        if (!(window as any).__TEST_SUPPRESS_REPLACEMENT_EVENT__) window.dispatchEvent(new Event("database-replaced"));
        if ((window as any).__TEST_FAIL_IMPORT_READBACK__) (window as any).__FAIL_OP__ = "snapshot";
      }
      localStorage.setItem("fixture-state", JSON.stringify(s));
      await (window as any).__TEST_AFTER_DISPATCH__?.(r);
      return null;
    };
  }, options);
  await page.goto("/");
  await page.getByRole("tab", { name: "Headlines", exact: true }).waitFor();
}
