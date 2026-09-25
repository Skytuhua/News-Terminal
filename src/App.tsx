import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpRight,
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Columns3,
  ExternalLink,
  HelpCircle,
  ListFilter,
  Menu,
  Newspaper,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { Article, Snapshot, Tab, Workspace } from "./types";
import {
  dispatch,
  runtimeAvailable,
  subscribe,
  type Request,
  type WindowContext,
} from "./ipc";
import { date, sourceFailed, filterArticles, focusSections, relatedCounts, reconcileArticles, topics } from "./model";
import { coalescedRead } from "./coalescedRead";
import SettingsPanel from "./Settings";
import Coverage from "./Coverage";
import Summary from "./Summary";
import SourceUrl from "./SourceUrl";
import Briefing from "./Briefing";
import ReaderMedia from "./ReaderMedia";
import LiveDiscussion from "./LiveDiscussion";
import ModelCatalog from "./ModelCatalog";
import BenchmarkTable from "./BenchmarkTable";
import PaneDivider from "./PaneDivider";
import HeadlineRow from "./HeadlineRow";
import { MediaSession, ImageControls } from "./MediaSession";
import EmptyHeadlines from "./EmptyHeadlines";
import HiddenStories from "./HiddenStories";
import { usePaneWidths } from "./usePaneWidths";
import "./daily-use.css";
import type { CSSProperties } from "react";

type Panel =
  | "preferences"
  | "profiles"
  | "sources"
  | "connections"
  | "screens"
  | "watchlists"
  | "alerts"
  | "providers"
  | "backup"
  | "help";
const freshTab = (): Tab => ({
  id: crypto.randomUUID(),
  title: "Headlines",
  mode: "all",
  topic: "",
  query: "",
});
export default function App() {
  const [aiView, setAiView] = useState<"news" | "models" | "benchmarks">("news");
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [viewportWidth, setViewportWidth] = useState(window.innerWidth);
  useEffect(() => {
    const resized = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', resized);
    return () => window.removeEventListener('resize', resized);
  }, []);
  const [data, setData] = useState<Snapshot>();
  const [briefingInput, setBriefingInput] = useState("");
  const [workspaceInvalid, setWorkspaceInvalid] = useState(false);
  const [profileId, setProfileId] = useState("default");
  const [profilePending, setProfilePending] = useState(false);
  const switchingProfile = useRef(false);
  const [context, setContext] = useState<WindowContext>({
    label: "main",
    detached: false,
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [hiddenUndo, setHiddenUndo] = useState<{ profileId: string; articleId: string; generation: number }>();
  const [hidePending, setHidePending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);
  const [refreshFailures, setRefreshFailures] = useState(0);
  const [panel, setPanel] = useState<Panel>();
  const [navOpen, setNavOpen] = useState(false);
  const [othersExpanded, setOthersExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Article[]>();
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [selectedId, setSelectedId] = useState<string>();
  const [kind, setKind] = useState("");
  const [unread, setUnread] = useState(false);
  const [page, setPage] = useState(0);
  const pageFromControl = useRef(false);
  const [pending, setPending] = useState<Article[]>([]);
  const searchInput = useRef<HTMLInputElement>(null);
  const tabButtons = useRef(new Map<string, HTMLButtonElement>());
  const closedTab = useRef<string | undefined>(undefined);
  const profileRef = useRef(profileId);
  profileRef.current = profileId;
  const dataRef = useRef(data);
  const loadedProfile = useRef("");
  const visited = useRef(new Set<string>());
  const loadGeneration = useRef(0);
  const queue = useRef(Promise.resolve());
  const contextAdopted = useRef(false);
  const workspaceGeneration = useRef(0);
  const importing = useRef(false);
  const [recoveryEpoch, setRecoveryEpoch] = useState(0);
  const readWorkspace = useCallback(async (reset = false, propagate = false) => {
    const generation = ++loadGeneration.current;
    try {
      const ctx = await dispatch<WindowContext>({ op: "window_context" });
      if (generation !== loadGeneration.current) {
        if (propagate) throw new Error("Workspace readback superseded; please retry.");
        return;
      }
      // Adopt the main host's persisted choice once, never during a UI switch.
      if (!contextAdopted.current) {
        contextAdopted.current = true;
        profileRef.current = ctx.profileId || "default";
        setProfileId(profileRef.current);
      }
      const id =
        ctx.detached && ctx.profileId ? ctx.profileId : profileRef.current;
      if (!visited.current.has(id)) {
        visited.current.add(id);
        try {
          await dispatch({ op: "visit", profileId: id });
        } catch (e) {
          visited.current.delete(id);
          throw e;
        }
      }
      const next = await dispatch<Snapshot>({ op: "snapshot", profileId: id });
      if (generation !== loadGeneration.current) {
        if (propagate) throw new Error("Workspace readback superseded; please retry.");
        return;
      }
      setContext(ctx);
      if (id !== profileRef.current) {
        profileRef.current = id;
        setProfileId(id);
      }
      // Use the authoritative cache before the stable-reading projection below.
      // Workspace saves, read markers and status polling are not input changes.
      setBriefingInput(JSON.stringify([
        next.profile.preferences,
        next.sources.map(({ id, enabled, storage, aiAllowed, mediaAllowed }) => [id, enabled, storage, aiAllowed, mediaAllowed]),
        next.articles.map(({ id, updatedAt, title, excerpt, url, sourceId, sourceName, publishedAt, topics, sections, topicLabels, region, language, kind, aiAllowed, hidden, media }) =>
          [id, updatedAt, title, excerpt, url, sourceId, sourceName, publishedAt, topics, sections, topicLabels, region, language, kind, aiAllowed, hidden, media]),
      ]));
      const old = dataRef.current;
      if (!reset && loadedProfile.current === id && old && old.articles.length > 0) {
        const map = new Map(next.articles.map((a) => [a.id, a]));
        const existing = new Set(old.articles.map((a) => a.id));
        setPending(next.articles.filter((a) => !existing.has(a.id)));
        next.articles = old.articles
          .map((a) => map.get(a.id))
          .filter((a): a is Article => !!a);
      } else {
        setPending([]);
        const active =
          next.workspace.tabs.find(
            (t) =>
              t.id === (ctx.detached ? ctx.tabId : next.workspace.activeTabId),
          ) || next.workspace.tabs[0];
        setSelectedId(active?.selectedId);
        setQuery(active?.query || "");
        setResults(undefined);
      }
      if (old && loadedProfile.current === id) next.articles = reconcileArticles(old.articles, next.articles);
      loadedProfile.current = id;
      dataRef.current = next;
      setData(next);
      setWorkspaceInvalid(false);
    } catch (e) {
      if (generation === loadGeneration.current) setError(String(e));
      if (propagate) throw e;
    }
  }, []);
  function newReader() {
    const generation = workspaceGeneration.current;
    return coalescedRead(reset => generation === workspaceGeneration.current
      ? readWorkspace(reset, true) : Promise.reject(new Error("Database replaced")));
  }
  const requestRead = useRef<ReturnType<typeof coalescedRead> | undefined>(undefined);
  if (!requestRead.current) requestRead.current = newReader();
  const load = useCallback(async (reset = false, propagate = false, immediate = true) => {
    try { await requestRead.current!(reset, immediate); }
    catch (error) { if (propagate) throw error; }
  }, []);
  useEffect(() => {
    if (!runtimeAvailable) return;
    let stop: (() => void) | undefined;
    let closed = false;
    void subscribe(kind => {
      if (kind === "replaced" && !importing.current) {
        invalidateReplacement();
        void load(true);
      } else if (!importing.current && !switchingProfile.current) void load(false, false, false);
    })
      .then((fn) => {
        if (closed) fn();
        else { stop = fn; void load(true); }
      })
      .catch((e) => setError(String(e)));
    return () => {
      closed = true;
      stop?.();
    };
  }, [load]);
  function invalidateReplacement() {
    ++workspaceGeneration.current;
    ++loadGeneration.current;
    requestRead.current = newReader();
    setRecoveryEpoch(value => value + 1);
    setHiddenUndo(undefined);
    setHidePending(false);
    for (const timer of queryTimers.current.values()) clearTimeout(timer);
    queryTimers.current.clear();
    queue.current = Promise.resolve();
    visited.current.clear();
    loadedProfile.current = "";
    dataRef.current = undefined;
    contextAdopted.current = false;
    setWorkspaceInvalid(true);
    // Keep the settings dialog mounted, but remove every old reading surface.
    setData(current => current && {...current, articles: [], workspace: {...current.workspace, tabs: []}});
    setSelectedId(undefined);
    setResults(undefined);
    setQuery("");
    setPending([]);
    setKind("");
    setUnread(false);
    setError("");
    setNotice("");
  }
  async function importBackup(text: string) {
    importing.current = true;
    const previousQueue = queue.current;
    invalidateReplacement();
    try {
      // Drain in-flight saves before replacing the database; queued old intents
      // check their generation and cannot write into the restored workspace.
      await previousQueue;
      try { await dispatch({ op: "import", data: text }); }
      catch (error) {
        // Validation can fail without replacing anything; recover authoritative UI.
        await load(true);
        throw error;
      }
      await load(true, true);
    } finally {
      importing.current = false;
      setRecoveryEpoch(value => value + 1);
    }
  }
  async function switchProfile(id: string) {
    if (context.detached || switchingProfile.current) return;
    // Serialize native writes, not merely their responses. A delayed write or
    // acknowledgement cannot race a newer selection, even within one render.
    switchingProfile.current = true;
    setProfilePending(true);
    ++loadGeneration.current;
    setError("");
    try {
      await dispatch({ op: "window_set_profile", profileId: id });
    } catch (e) {
      setError(String(e));
    } finally {
      // The host may have applied a write whose acknowledgement failed. Adopt
      // authoritative context before allowing another profile-scoped action.
      contextAdopted.current = false;
      setSelectedId(undefined);
      dataRef.current = undefined;
      setData(undefined);
      await load(true);
      switchingProfile.current = false;
      setProfilePending(false);
    }
  }
  async function action(request: Request, message?: string, acknowledged?: () => void) {
    const generation = workspaceGeneration.current;
    if (importing.current) return false;
    setError("");
    setRefreshFailed(false);
    try {
      await dispatch({ ...request, replacementToken: dataRef.current?.replacementToken });
      if (generation !== workspaceGeneration.current) return false;
      acknowledged?.();
      await load(false, true, false);
      // A shared readback can belong to a replacement database, not this action.
      if (generation !== workspaceGeneration.current) return false;
      if (message) setNotice(message);
      return true;
    } catch (e) {
      if (generation === workspaceGeneration.current) setError(String(e));
      return false;
    }
  }
  function workspaceIntent(
    intent: (w: Workspace) => Workspace,
    id = profileRef.current,
  ) {
    const generation = workspaceGeneration.current;
    const replacementToken = dataRef.current?.replacementToken;
    queue.current = queue.current
      .then(async () => {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (generation !== workspaceGeneration.current) return;
          const latest = await dispatch<Workspace & { replacementToken: string }>({
            op: "workspace_get",
            profileId: id,
          });
          if (generation !== workspaceGeneration.current || latest.replacementToken !== replacementToken) return;
          try {
            await dispatch({
              op: "workspace_save",
              replacementToken,
              profileId: id,
              workspace: intent(latest),
              expectedRevision: latest.revision ?? 0,
            });
            break;
          } catch (e) {
            if (attempt === 1 || !/revision|stale|conflict/i.test(String(e)))
              throw e;
          }
        }
        if (generation === workspaceGeneration.current && profileRef.current === id)
          await load();
      })
      .catch((e) => {
        if (generation === workspaceGeneration.current) setError(String(e));
      });
    return queue.current;
  }
  const detachedIds = new Set(
    (context.detachedTabs || [])
      .filter((t) => t.profileId === profileId)
      .map((t) => t.tabId),
  );
  const visibleTabs =
    data?.workspace.tabs.filter((t) =>
      context.detached ? t.id === context.tabId : !detachedIds.has(t.id),
    ) || [];
  const active =
    visibleTabs.find((t) => t.id === data?.workspace.activeTabId) ||
    visibleTabs[0];
  useEffect(() => { setAiView("news"); }, [active?.id, active?.section, profileId]);
  const pane = usePaneWidths(profileId, context.label, active?.id || 'home');
  const maxNavWidth = Math.max(160, Math.min(320, Math.floor(viewportWidth * .25)));
  const maxDetailWidth = Math.max(290, Math.min(600, Math.floor(viewportWidth * (viewportWidth <= 900 ? .5 : .42))));
  const navWidth = Math.min(pane.widths.nav, maxNavWidth);
  const detailWidth = Math.min(pane.widths.detail, maxDetailWidth);
  useEffect(() => {
    if (closedTab.current && !data?.workspace.tabs.some(tab => tab.id === closedTab.current)) {
      closedTab.current = undefined;
      if (active) tabButtons.current.get(active.id)?.focus();
    }
  }, [data?.workspace, active]);
  // Changing tab ownership also changes the visible active tab. Restore only
  // on identity changes so background snapshots never reset reading position.
  useEffect(() => {
    setSelectedId(active?.selectedId);
    setQuery(active?.query || "");
    setResults(undefined);
    setKind("");
    setUnread(false);
  }, [active?.id, profileId]);
  function patchTab(patch: Partial<Tab>) {
    if (active)
      void workspaceIntent((w) => ({
        ...w,
        tabs: w.tabs.map((t) => (t.id === active.id ? { ...t, ...patch } : t)),
      }));
  }
  function navigate(patch: Partial<Tab>) {
    const key = `${profileId}:${active?.id}`;
    clearTimeout(queryTimers.current.get(key));
    queryTimers.current.delete(key);
    setQuery("");
    setResults(undefined);
    setKind("");
    setUnread(false);
    setNavOpen(false);
    patchTab({ query: "", topic: "", section: undefined, ...patch });
  }
  function chooseTab(tab: Tab) {
    // Keep input associated with the current tab until the switch is read back.
    void workspaceIntent((w) => ({ ...w, activeTabId: tab.id }));
  }
  function addTab() {
    const t = freshTab();
    setSelectedId(undefined);
    setQuery("");
    void workspaceIntent((w) => ({
      ...w,
      tabs: [...w.tabs, t],
      activeTabId: t.id,
    }));
  }
  function closeTab(id: string) {
    closedTab.current = id;
    void workspaceIntent((w) => {
      const tabs = w.tabs.filter((t) => t.id !== id);
      if (!tabs.length) tabs.push(freshTab());
      return {
        ...w,
        tabs,
        activeTabId: w.activeTabId === id ? tabs[0].id : w.activeTabId,
      };
    });
    if (active?.id === id) {
      setSelectedId(undefined);
      setQuery("");
    }
  }
  function reorder(id: string, before: string) {
    void workspaceIntent((w) => {
      const tabs = w.tabs.filter((t) => t.id !== id);
      const item = w.tabs.find((t) => t.id === id);
      if (item)
        tabs.splice(
          Math.max(
            0,
            tabs.findIndex((t) => t.id === before),
          ),
          0,
          item,
        );
      return { ...w, tabs };
    });
  }
  const searchRevision = useMemo(() => JSON.stringify([
    data?.profile.preferences,
    data?.articles.map(({read: _read, saved: _saved, ...searchable}) => searchable),
  ]), [data?.profile.preferences, data?.articles]);
  useEffect(() => {
    if (!active || !data) return;
    setSearchFailed(false);
    let live = true;
    const id = profileId;
    if (!query.trim()) {
      setResults(undefined);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => {
      void dispatch<Article[]>({ op: "search", profileId: id, query })
        .then((rows) => {
          if (live) {
            setResults(rows);
            setSearching(false);
          }
        })
        .catch((e) => {
          if (live) {
            setError(String(e));
            setSearchFailed(true);
            setRefreshFailed(false);
            setResults([]);
            setSearching(false);
          }
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query, profileId, active?.id, searchRevision, searchAttempt]);
  const queryTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => () => {
    for (const timer of queryTimers.current.values()) clearTimeout(timer);
  }, []);
  function editQuery(value: string) {
    setQuery(value);
    setSearching(!!value.trim());
    if (!active) return;
    // Only user input creates edits; bind the intent before any async switch.
    const id = profileId;
    const tabId = active.id;
    const key = `${id}:${tabId}`;
    clearTimeout(queryTimers.current.get(key));
    queryTimers.current.set(key, setTimeout(() => {
      queryTimers.current.delete(key);
      void workspaceIntent((w) => ({
        ...w,
        tabs: w.tabs.map((t) => t.id === tabId ? { ...t, query: value } : t),
      }), id);
    }, 350));
  }
  // Snapshots include the recent cache AND older saved stories, not just
  // the recent list. Search may change ranking, but cannot accept new arrivals.
  const counts = useMemo(() => relatedCounts(data?.articles || []), [data?.articles]);
  const acceptedArticles = useMemo(() => new Map(data?.articles.map((a) => [a.id, a])), [data?.articles]);
  const metadataView = active?.mode === "all" && active.section === "ai" && aiView !== "news";
  const reportView = metadataView || active?.mode === "briefing" || active?.mode === "live" || active?.mode === "hidden";
  const collectionRows = useMemo(() =>
    active && data && !reportView
      ? filterArticles(
          results?.map(a => acceptedArticles.get(a.id)).filter((a): a is Article => !!a) ?? data.articles,
          active,
          data.profile.previousVisit,
          data.watchlists.find((w) => w.id === active.watchlistId),
        ).filter((a) => !kind || a.kind === kind)
      : [], [active, data?.articles, data?.profile.previousVisit, data?.watchlists, reportView, results, acceptedArticles, kind]);
  const rows = useMemo(() => collectionRows.filter(a => !unread || !a.read), [collectionRows, unread]);
  // Reading marks an item read, but must not erase its place in J/K history.
  // Only the current collection may participate: hidden/deleted/filtered items leave.
  const readingSequence = useRef({ key: '', ids: new Set<string>() });
  const sequenceKey = JSON.stringify([profileId, active?.id, active?.mode, active?.topic, active?.watchlistId, query, kind, unread]);
  if (readingSequence.current.key !== sequenceKey) readingSequence.current = {key: sequenceKey, ids: new Set()};
  const navigationRows = collectionRows.filter(a => !unread || !a.read || readingSequence.current.ids.has(a.id));
  readingSequence.current.ids = new Set(navigationRows.map(a => a.id));
  const pageSize = 100;
  const lastPage = Math.max(0, Math.ceil(rows.length / pageSize) - 1);
  const currentPage = Math.min(page, lastPage);
  const pageRows = rows.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  function choosePage(value: number) { pageFromControl.current = true; setPage(value); }
  useEffect(() => { setPage(0); }, [profileId, active?.id, active?.mode, active?.topic, active?.watchlistId, query, kind, unread]);
  useEffect(() => {
    const index = rows.findIndex(article => article.id === selectedId);
    if (index >= 0) setPage(Math.floor(index / pageSize));
  }, [selectedId]);
  useEffect(() => {
    if (pageFromControl.current) {
      document.querySelector('.story-list')?.scrollTo({top:0, behavior:'instant'});
      pageFromControl.current = false;
      return;
    }
    document.querySelector(`[data-article-id="${CSS.escape(selectedId || '')}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [selectedId, currentPage]);
  const selected = reportView ? undefined : (
    data?.articles.find((a) => a.id === selectedId) ||
    results?.find((a) => a.id === selectedId));
  const select = useCallback((a: Article) => {
    setSelectedId(a.id);
    patchTab({ selectedId: a.id });
    if (!a.read)
      void action({
        op: "article_state",
        profileId,
        articleId: a.id,
        read: true,
      });
  }, [profileId, active?.id]);
  function closeStory() {
    setSelectedId(undefined);
    patchTab({ selectedId: undefined });
  }
  async function hideStory(article: Article) {
    const target = { profileId, articleId: article.id, generation: workspaceGeneration.current };
    if (importing.current || switchingProfile.current) return;
    setHidePending(true);
    try {
      if (await action({ op: "article_state", profileId: target.profileId, articleId: target.articleId, hidden: true }, undefined, () => {
        // The write is confirmed even if its subsequent readback fails.
        if (profileRef.current === target.profileId && !switchingProfile.current) {
          setHiddenUndo(target);
          setSelectedId(undefined);
        }
      }) && target.generation === workspaceGeneration.current &&
          profileRef.current === target.profileId && !switchingProfile.current) {
        closeStory();
      }
    } finally {
      if (target.generation === workspaceGeneration.current) setHidePending(false);
    }
  }
  async function undoHide() {
    const target = hiddenUndo;
    if (!target || target.generation !== workspaceGeneration.current || importing.current ||
        target.profileId !== profileRef.current || switchingProfile.current) return;
    setHidePending(true);
    try {
      if (await action({ op: "article_state", profileId: target.profileId, articleId: target.articleId, hidden: false }) &&
          target.generation === workspaceGeneration.current && target.profileId === profileRef.current && !switchingProfile.current) {
        setHiddenUndo(current => current === target ? undefined : current);
        setNotice("Hidden story restored");
      }
    } finally {
      if (target.generation === workspaceGeneration.current) setHidePending(false);
    }
  }
  async function refresh() {
    setRefreshFailed(false);
    setRefreshing(true);
    setError("");
    try {
      const r = await dispatch<{ updated: number; failed: number }>({
        op: "refresh",
      });
      await load(false, true);
      setRefreshFailures(r.failed);
      setNotice(
        `Refresh complete · ${r.updated} updated · ${r.failed} source failures`,
      );
    } catch (e) {
      setRefreshFailed(true);
      setError(String(e));
    } finally {
      setRefreshing(false);
    }
  }
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        !data || workspaceInvalid || panel || e.defaultPrevented ||
        document.querySelector("dialog[open]")
      ) return;
      const typing = (e.target as HTMLElement)?.closest(
        "input,textarea,select,[contenteditable=true]",
      );
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        (active?.mode === "hidden" ? document.querySelector<HTMLInputElement>(".hidden-search input") : searchInput.current)?.focus();
        return;
      }
      if (typing) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if (e.ctrlKey && !e.altKey && !e.metaKey && !context.detached) {
          if (e.key === "t") {
            e.preventDefault();
            addTab();
          } else if (e.key === "w" && active) {
            e.preventDefault();
            closeTab(active.id);
          } else if (e.key === "Tab" && visibleTabs.length) {
            e.preventDefault();
            const i = visibleTabs.findIndex((t) => t.id === active?.id);
            chooseTab(
              visibleTabs[
                (i + (e.shiftKey ? -1 : 1) + visibleTabs.length) %
                  visibleTabs.length
              ],
            );
          }
        }
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setPanel("help");
      } else if (e.key === "/") {
        e.preventDefault();
        (active?.mode === "hidden" ? document.querySelector<HTMLInputElement>(".hidden-search input") : searchInput.current)?.focus();
      } else if (e.key === "j" || e.key === "k") {
        e.preventDefault();
        const i = navigationRows.findIndex((a) => a.id === selectedId);
        const a =
          navigationRows[
            Math.max(0, Math.min(navigationRows.length - 1, i + (e.key === "j" ? 1 : -1)))
          ];
        if (a) {
          const visibleIndex = rows.findIndex(row => row.id === a.id);
          if (visibleIndex >= 0) setPage(Math.floor(visibleIndex / pageSize));
          select(a);
          document
            .querySelector(`[data-article-id="${CSS.escape(a.id)}"]`)
            ?.scrollIntoView({ block: "nearest", behavior: "instant" });
        }
      } else if (e.key === "s" && selected) {
        e.preventDefault();
        void action({
          op: "article_state",
          profileId,
          articleId: selected.id,
          saved: !selected.saved,
        });
      } else if (e.key === "o" && selected) {
        e.preventDefault();
        void action({ op: "open_original", url: selected.url });
      } else if (e.key === "r" && !refreshing) {
        e.preventDefault();
        void refresh();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  if (!runtimeAvailable)
    return (
      <main className="runtime">
        <Newspaper size={32} />
        <h1>News Terminal</h1>
        <h2>Desktop runtime required</h2>
        <p>
          Open the installed News Terminal application to read your feeds. Your
          profiles, cached stories and credentials stay in the native desktop
          runtime.
        </p>
        <p className="muted">
          This browser preview does not fetch feeds or show demonstration
          headlines.
        </p>
      </main>
    );
  if (!data || (workspaceInvalid && !panel))
    return (
      <main className="runtime">
        <Newspaper size={32} />
        <h1>News Terminal</h1>
        <p role="status">
          {error
            ? "Unable to open your workspace."
            : "Opening your local workspace…"}
        </p>
        {error && (
          <>
            <p role="alert">{error}</p>
            <button onClick={() => void load(true)}>Retry</button>
          </>
        )}
      </main>
    );
  return (
    <MediaSession profileId={profileId} replacementToken={data.replacementToken} active={!profilePending && !workspaceInvalid && !importing.current}>
    <div
      className={`app ${navOpen ? "nav-open" : ""} ${selected ? "has-selection" : ""}`}
    >
      <header className="topbar">
        <button
          className="icon mobile-nav"
          aria-label="Toggle navigation"
          onClick={() => setNavOpen(!navOpen)}
        >
          <Menu />
        </button>
        <div className="brand">
          <Newspaper size={18} />
          <h1>News Terminal</h1>
        </div>
        <span className="local-label">Local workspace</span>
        <div className="spacer" />
        <button className="quiet" aria-label="Screens" onClick={() => setPanel("screens")}><Columns3 size={16} /><span>Screens</span></button>
        <button
          className="quiet"
          onClick={() => setPanel("help")}
          aria-label="Keyboard shortcuts"
        >
          <HelpCircle size={16} />
          <span>Shortcuts</span>
          <kbd>?</kbd>
        </button>
        <button
          className="quiet"
          aria-label="Settings"
          onClick={() => setPanel("preferences")}
        >
          <Settings size={16} />
        </button>
      </header>
      <div className="tabbar">
        <div className="tabs" role="tablist" aria-label="Workspace tabs">
          {visibleTabs.map((t) => (
            <div
              className={`tab ${active?.id === t.id ? "active" : ""}`}
              key={t.id}
              draggable={!context.detached}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                reorder(e.dataTransfer.getData("text/plain"), t.id);
              }}
            >
              <button
                role="tab"
                id={`workspace-tab-${t.id}`}
                aria-controls={`workspace-panel-${t.id}`}
                aria-selected={active?.id === t.id}
                tabIndex={active?.id === t.id ? 0 : -1}
                ref={node => { if (node) tabButtons.current.set(t.id, node); else tabButtons.current.delete(t.id); }}
                onKeyDown={event => {
                  if (event.altKey || event.ctrlKey || event.metaKey) return;
                  const index = visibleTabs.findIndex(tab => tab.id === t.id);
                  const next = event.key === "Home" ? 0 : event.key === "End" ? visibleTabs.length - 1
                    : event.key === "ArrowRight" ? (index + 1) % visibleTabs.length
                    : event.key === "ArrowLeft" ? (index - 1 + visibleTabs.length) % visibleTabs.length : undefined;
                  if (next === undefined) return;
                  event.preventDefault();
                  const target = visibleTabs[next];
                  tabButtons.current.get(target.id)?.focus();
                  chooseTab(target);
                }}
                onClick={() => chooseTab(t)}
              >
                {t.title}
              </button>
              {!context.detached && (
                <button
                  className="icon"
                  aria-label={`Close ${t.title} tab`}
                  onClick={() => closeTab(t.id)}
                >
                  <X size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
        {!context.detached && (
          <button className="icon" aria-label="New tab" onClick={addTab}>
            <Plus size={17} />
          </button>
        )}
        <select
          className="tab-picker"
          aria-label="Switch tab"
          value={active?.id || ""}
          onChange={(e) => {
            const t = visibleTabs.find((t) => t.id === e.target.value);
            if (t) chooseTab(t);
          }}
        >
          {visibleTabs.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
        </select>
        {active && !context.detached && (
          <>
            <button
              className="icon"
              aria-label="Move tab left"
              disabled={visibleTabs[0]?.id === active.id}
              onClick={() =>
                reorder(
                  active.id,
                  visibleTabs[
                    visibleTabs.findIndex((t) => t.id === active.id) - 1
                  ].id,
                )
              }
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="quiet"
              aria-label="Detach tab"
              onClick={() =>
                void action({ op: "detach_tab", profileId, tabId: active.id })
              }
            >
              <ArrowUpRight size={15} />
              <span>Detach</span>
            </button>
          </>
        )}
        {context.detached && (
          <button
            onClick={() =>
              void action({
                op: "reattach_tab",
                profileId,
                tabId: context.tabId,
              })
            }
          >
            <Columns3 size={15} />
            Reattach
          </button>
        )}
      </div>
      {error && (
        <div className="banner error" role="alert">
          <span>{error}</span>
          {refreshFailed && <><button disabled={refreshing} onClick={() => void refresh()}>Retry refresh</button><button onClick={() => setPanel("sources")}>Review source failures</button></>}

          <button
            className="icon"
            aria-label="Dismiss error"
            onClick={() => setError("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {hiddenUndo && hiddenUndo.profileId === profileId && !profilePending && <div className="hide-recovery" role="status">
        <span>Story hidden</span>
        <button aria-label="Undo hide" disabled={hidePending} onClick={() => void undoHide()}>Undo</button>
        <button className="icon" aria-label="Dismiss hidden story notice" onClick={() => setHiddenUndo(undefined)}><X size={16} /></button>
      </div>}
      {visibleTabs.filter(tab => tab.id !== active?.id).map(tab =>
        <div key={tab.id} hidden role="tabpanel" id={`workspace-panel-${tab.id}`} aria-labelledby={`workspace-tab-${tab.id}`} />)}
      <div
        role={active ? "tabpanel" : undefined}
        id={active ? `workspace-panel-${active.id}` : undefined}
        aria-labelledby={active ? `workspace-tab-${active.id}` : undefined}
        tabIndex={active ? 0 : undefined}
        className={`desk ${reportView ? "report-view" : ""}`}
        style={
          {
            "--nav-width": `${navWidth}px`,
            "--detail-width": `${detailWidth}px`,
          } as CSSProperties
        }
      >
        <aside className="sidebar" aria-label="Navigation">
          <label className="profile-label">
            Reading profile
            <select
              aria-label="Reading profile"
              disabled={context.detached || profilePending}
              value={profileId}
              onChange={(e) => void switchProfile(e.target.value)}
            >
              {data.profiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="profile-manage"
            onClick={() => setPanel("profiles")}
          >
            Manage profiles <SlidersHorizontal size={13} />
          </button>
          <nav>
            <div className="nav-heading">Focus</div>
            {focusSections.filter(section => section.id !== "others").map(section => (
              <button
                key={section.id}
                className={active?.mode === "all" && active?.section === section.id ? "chosen" : ""}
                onClick={() =>
                  navigate({
                    mode: "all",
                    section: section.id,
                    topic: "",
                    title: section.title,
                  })
                }
              >
                <Newspaper size={16} />
                {section.title}
              </button>
            ))}
            <button
              className={active?.mode === "all" && active?.section === "others" && !active.topic ? "chosen" : ""}
              aria-expanded={othersExpanded}
              aria-controls="other-topic-links"
              onClick={() => {
                setOthersExpanded(value => !value);
                navigate({ mode: "all", section: "others", topic: "", title: "Others" });
              }}
            >
              <ChevronRight size={16} style={{ transform: othersExpanded ? "rotate(90deg)" : undefined }} />Others
            </button>
            <div id="other-topic-links" hidden={!othersExpanded}>
              {Array.from(new Set([...topics, ...data.sources.flatMap(source => source.topics), ...data.workspace.tabs.map(tab => tab.topic).filter(Boolean)]))
                .filter(topic => !["ai", "technology", "markets", "stocks"].includes(topic))
                .map(topic => (
                  <button key={topic}
                    className={active?.section === "others" && active?.topic === topic ? "chosen" : ""}
                    onClick={() => navigate({ mode: "all", section: "others", topic, title: topic[0].toUpperCase() + topic.slice(1) })}>
                    <span className="topic-dot" />{topic[0].toUpperCase() + topic.slice(1)}
                  </button>
                ))}
            </div>
            <button className={active?.mode === "briefing" ? "chosen" : ""}
              onClick={() => navigate({ mode: "briefing", title: "Daily briefing" })}>
              <Columns3 size={16} />Daily briefing
            </button>
            <button className={active?.mode === "live" ? "chosen" : ""}
              onClick={() => navigate({ mode: "live", title: "Live discussion" })}>
              <ListFilter size={16} />Live discussion
            </button>
            <button
              className={
                active?.mode === "all" && !active.topic && !active.section ? "chosen" : ""
              }
              onClick={() => navigate({ mode: "all", section: undefined, title: "All headlines" })}
            >
              <Newspaper size={16} />
              All headlines
            </button>
            <button
              className={active?.mode === "brief" ? "chosen" : ""}
              onClick={() => navigate({ mode: "brief", title: "Your brief" })}
            >
              <Check size={16} />
              Your brief
            </button>
            <button
              className={active?.mode === "saved" ? "chosen" : ""}
              onClick={() =>
                navigate({ mode: "saved", title: "Saved stories" })
              }
            >
              <Bookmark size={16} />
              Saved stories
            </button>
            <button className={active?.mode === "hidden" ? "chosen" : ""} onClick={() => navigate({mode:"hidden", title:"Hidden stories"})}><ListFilter size={16} />Hidden stories</button>
            <div className="nav-heading">
              <span>Watchlists</span>
              <button
                className="icon"
                aria-label="Manage watchlists"
                onClick={() => setPanel("watchlists")}
              >
                <Plus size={14} />
              </button>
            </div>
            {data.watchlists.map((w) => (
              <button
                key={w.id}
                className={
                  active?.watchlistId === w.id && active.mode === "watchlist"
                    ? "chosen"
                    : ""
                }
                onClick={() =>
                  navigate({
                    mode: "watchlist",
                    watchlistId: w.id,
                    title: w.name,
                  })
                }
              >
                <ListFilter size={14} />
                {w.name}
              </button>
            ))}
            {!data.watchlists.length && (
              <button className="muted" onClick={() => setPanel("watchlists")}>
                Create a watchlist
              </button>
            )}
          </nav>
          <div className="sidebar-bottom">
            <button onClick={() => setPanel("connections")}>Connections <ExternalLink size={14} /></button>
            <button onClick={() => setPanel("sources")}>
              Sources & health{" "}
              <span>{data.sources.some(sourceFailed) ? `${data.sources.filter(sourceFailed).length} failing` : data.sources.filter((s) => s.enabled).length}</span>
            </button>
            <button onClick={() => setPanel("preferences")}>
              <Settings size={14} />
              Preferences
            </button>
          </div>
        </aside>
        <PaneDivider
          key={`nav:${pane.key}`}
          className="nav-divider"
          label="Navigation pane width"
          value={navWidth}
          min={160}
          max={maxNavWidth}
          onChange={value => pane.update('nav', value)}
          onCommit={value => pane.update('nav', value, true)}
        />
        {active?.mode === "hidden" ? (!importing.current && !profilePending && !workspaceInvalid && <HiddenStories key={`${profileId}:${active.id}:${recoveryEpoch}`} profileId={profileId} replacementToken={data.replacementToken} isCurrent={() => !importing.current && !switchingProfile.current && dataRef.current?.replacementToken === data.replacementToken} browse={() => navigate({mode:"all", title:"Headlines"})} />) : active?.mode === "briefing" ? <Briefing key={`${profileId}:${active.id}`} profileId={profileId} inputRevision={briefingInput} providers={data.providers} configure={() => setPanel("providers")} /> : active?.mode === "live" ? <LiveDiscussion key={`${profileId}:${active.id}`} /> : <>
        <main className="headlines" aria-label="Headlines">
          <div className="list-heading">
            <div>
              <h2>{active?.title || "Workspace"}</h2>
              <p>
                {active?.mode === "brief"
                  ? `Since your previous visit · ${date(data.profile.previousVisit)}`
                  : "Cached news & public discussion"}
              </p>
            </div>
            <button
              className="icon"
              aria-label={data.articles.length ? "Refresh feeds" : "Refresh cache"}
              disabled={refreshing}
              onClick={() => void refresh()}
            >
              <RefreshCw size={17} />
            </button>
          </div>
          <div className="search">
            <Search size={16} />
            <input
              ref={searchInput}
              type="search"
              aria-label="Search cached stories"
              placeholder="Search cached stories…"
              value={query}
              onChange={(e) => editQuery(e.target.value)}
            />
            <kbd>/</kbd>
          </div>
          <div className="filters">
            <select
              aria-label="Content type"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              <option value="">All types</option>
              {["reporting", "discussion", "official notice", "opinion"].map(
                (k) => (
                  <option key={k}>{k}</option>
                ),
              )}
            </select>
            <label className="check">
              <input
                type="checkbox"
                checked={unread}
                onChange={(e) => setUnread(e.target.checked)}
              />
              Unread
            </label>
            <span className="spacer" />
            <span className="muted" role="status">
              {searching ? "Searching…" : `${rows.length} stories`}
            </span>
          </div>
          {pending.length > 0 && (
            <button className="new-items" onClick={() => void load(true)}>
              {pending.length} new {pending.length === 1 ? "story" : "stories"}{" "}
              · Show latest
            </button>
          )}
          {active?.section === "ai" && active.mode === "all" && (
            <>
              <nav aria-label="AI views" style={{display:"flex",gap:8,padding:12}}>
                {(["news", "models", "benchmarks"] as const).map(view => <button key={view} aria-pressed={aiView === view} onClick={() => setAiView(view)}>{view[0].toUpperCase() + view.slice(1)}</button>)}
              </nav>
              {aiView === "models" && <ModelCatalog />}
              {aiView === "benchmarks" && <BenchmarkTable />}
            </>
          )}
          {!active && (
            <div className="empty">
              <Columns3 />
              <h3>Your tabs are on another screen</h3>
              <p>Reattach a tab below or open a new one.</p>
            </div>
          )}
          {(context.detachedTabs || [])
            .filter((t) => t.profileId === profileId && !context.detached)
            .map((t) => (
              <div className="elsewhere" key={t.tabId}>
                <span>
                  {data.workspace.tabs.find((x) => x.id === t.tabId)?.title ||
                    "Tab"}{" "}
                  · Another screen
                </span>
                <button
                  onClick={() =>
                    void action({
                      op: "reattach_tab",
                      profileId,
                      tabId: t.tabId,
                    })
                  }
                >
                  Reattach
                </button>
              </div>
            ))}
          {(active?.section !== "ai" || active.mode !== "all" || aiView === "news") && <>
          <ImageControls />
          <div className="story-list" aria-label="Cached stories">
            {pageRows.map(a => <HeadlineRow key={a.id} article={a} profileId={profileId} selected={a.id === selectedId} related={counts.get(a.groupId) || 0} onSelect={select} now={now} />)}
            {active && !rows.length && <EmptyHeadlines hidden={() => navigate({mode:"hidden", title:"Hidden stories"})} data={data} tab={active} query={query} kind={kind} unread={unread}
              retrySearch={() => { setError(''); setSearchFailed(false); setSearching(true); setSearchAttempt(value => value + 1); }}
              failed={searchFailed} busy={searching || refreshing} clear={() => { editQuery(""); setKind(""); setUnread(false); if (active.topic) patchTab({topic:"", title: active.mode === 'saved' ? 'Saved stories' : 'Headlines'}); }}
              browse={() => navigate({mode:"all", title:"Headlines"})} refresh={() => void refresh()} sources={() => setPanel("sources")} watchlists={() => setPanel("watchlists")} />}
          </div>
          {rows.length > pageSize && <nav className="headline-pages" aria-label="Headline pages">
            <button aria-label="First page" disabled={currentPage === 0} onClick={() => choosePage(0)}>First</button>
            <button aria-label="Previous page" disabled={currentPage === 0} onClick={() => choosePage(currentPage - 1)}>Previous</button>
            <span role="status">{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, rows.length)} of {rows.length}</span>
            <button aria-label="Next page" disabled={currentPage === lastPage} onClick={() => choosePage(currentPage + 1)}>Next</button>
            <button aria-label="Last page" disabled={currentPage === lastPage} onClick={() => choosePage(lastPage)}>Last</button>
          </nav>}
          </>}
        </main>
        {!metadataView && <>
        <PaneDivider
          key={`detail:${pane.key}`}
          className="detail-divider"
          label="Reading pane width"
          value={detailWidth}
          min={290}
          max={maxDetailWidth}
          onChange={value => pane.update('detail', value)}
          onCommit={value => pane.update('detail', value, true)}
          invert
        />
        <aside className="detail" aria-label="Story detail">
          {selected ? (
            <>
              <div className="detail-toolbar">
                <button
                  className="icon back-to-list"
                  aria-label="Back to headlines"
                  onClick={closeStory}
                >
                  <ChevronLeft size={17} />
                </button>
                <span>Reading pane</span>
                <div className="spacer" />
                <button
                  className="icon"
                  aria-label={selected.saved ? "Unsave story" : "Save story"}
                  onClick={() =>
                    void action({
                      op: "article_state",
                      profileId,
                      articleId: selected.id,
                      saved: !selected.saved,
                    })
                  }
                >
                  <Bookmark
                    size={17}
                    fill={selected.saved ? "currentColor" : "none"}
                  />
                </button>
                <button
                  className="quiet"
                  onClick={() =>
                    void action({
                      op: "article_state",
                      profileId,
                      articleId: selected.id,
                      read: !selected.read,
                    })
                  }
                >
                  {selected.read ? "Mark unread" : "Mark read"}
                </button>
                <button className="quiet" aria-label="Hide story" disabled={hidePending} onClick={() => void hideStory(selected)}>Hide</button>
                <button className="icon" aria-label="Close story" onClick={closeStory}><X size={16} /></button>
              </div>
              <div className="detail-body">
                <div className="byline">
                  <span>{selected.sourceName}</span>
                  <span className="tag">{selected.kind}</span>
                </div>
                <h2>{selected.title}</h2>
                <p className="muted">
                  <time>{date(selected.publishedAt)}</time>
                </p>
                <button
                  className="primary original"
                  aria-label="Open original"
                  onClick={() =>
                    void action({ op: "open_original", url: selected.url })
                  }
                >
                  Open original <ExternalLink size={14} />
                </button>
                <SourceUrl url={selected.url} open={() => void action({ op: "open_original", url: selected.url })} />
                <section>
                  <h3>Publisher excerpt</h3>
                  <p className="excerpt">
                    {selected.excerpt ||
                      "This source provides metadata only. Read the original for the full report."}
                  </p>
                  <p className="fine">
                    {selected.saved
                      ? "Saved locally: title, link and permitted feed excerpt. "
                      : "Cached feed excerpt. "}
                    The full article may require publisher access.
                  </p>
                </section>
                {data.sources.find(source => source.id === selected.sourceId)?.mediaAllowed !== false &&
                  <ReaderMedia key={`${profileId}:${selected.id}:${selected.updatedAt}:${JSON.stringify(selected.media)}`} article={selected} profileId={profileId} />}
                <section>
                  <h3>Why this story</h3>
                  <ul className="reasons">
                    {selected.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </section>
                <Summary
                  key={JSON.stringify([profileId, selected.id, selected.updatedAt, selected.aiAllowed, selected.title, selected.excerpt, selected.url, selected.sourceId, selected.sourceName])}
                  article={selected}
                  providers={data.providers}
                  profileId={profileId}
                  configure={() => setPanel("providers")}
                />
                <Coverage
                  key={selected.id}
                  article={selected}
                  articles={data.articles}
                  profileId={profileId}
                  action={action}
                />
              </div>
            </>
          ) : (
            <div className="empty detail-empty">
              <Newspaper size={29} />
              <h2>Select a story</h2>
              <p>
                Read the publisher’s excerpt, compare coverage and keep the
                original source in view.
              </p>
              <div className="key-hints">
                <kbd>J</kbd>
                <kbd>K</kbd>
                <span>Move between stories</span>
              </div>
            </div>
          )}
        </aside>
        </>}
        </>}
      </div>
      <footer className="statusbar">
        <span className={refreshing ? "accent" : ""}>
          {refreshing
            ? "Refreshing sources…"
            : data.lastRefresh
              ? `Last refresh ${date(data.lastRefresh)}`
              : "No successful refresh yet"}
        </span>
        <button onClick={() => setPanel("sources")}>
          {data.sources.filter((s) => s.enabled).length} enabled sources
        </button>
        {refreshFailures > 0 && <button onClick={() => setPanel("sources")}>Review source failures</button>}
        <div className="spacer" />
        <span role="status">
          {notice || "Local cache · No account required"}
        </span>
      </footer>
      {panel && (
        <SettingsPanel
          panel={panel}
          setPanel={setPanel}
          data={data}
          close={() => setPanel(undefined)}
          reload={() => load(true, true)}
          importBackup={importBackup}
        />
      )}
    </div>
    </MediaSession>
  );
}
