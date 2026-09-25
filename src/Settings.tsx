import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { X } from "lucide-react";
import type { Snapshot, Source, Watchlist } from "./types";
import { dispatch, type Request } from "./ipc";
import { list, date, sourceFailed, sourceEligibleAt } from "./model";
import Connections from "./Connections";
import MonitorControls from "./MonitorControls";
import { ImageControls } from "./MediaSession";
export type Panel =
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
const panels: Record<Panel, string> = {
  preferences: "Preferences",
  profiles: "Profiles",
  sources: "Sources & health",
  connections: "Connections",
  screens: "Screens",
  watchlists: "Watchlists",
  alerts: "Alerts",
  providers: "AI providers",
  backup: "Backup",
  help: "Keyboard shortcuts",
};
function sourceAccessLabel(source: Source) {
  if (source.accessMode === "free-keyless") return "Free, no key";
  if (source.accessMode === "approval-free") return "Free after publisher approval";
  if (source.accessMode === "external-only") return "External link only";
  return "Legacy import, review terms";
}
function sourceAdapterLabel(source: Source) {
  if (source.sourceAdapter === "feed") return "RSS/Atom feed";
  if (source.sourceAdapter === "external-link") return "External website";
  return source.sourceAdapter || "Feed adapter";
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export default function Settings({
  panel,
  setPanel,
  data,
  close,
  reload,
  importBackup,
}: {
  panel: Panel;
  setPanel: (p: Panel) => void;
  data: Snapshot;
  close: () => void;
  reload: () => Promise<void>;
  importBackup: (text: string) => Promise<void>;
}) {
  const [formVersion, setFormVersion] = useState(0);
  const [backup, setBackup] = useState("");
  const [confirmImport, setConfirmImport] = useState(false);
  const [editing, setEditing] = useState<Watchlist>();
  const [deleteWatchlist, setDeleteWatchlist] = useState<string>();
  const ref = useRef<HTMLDialogElement>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
      old?.focus();
    };
  }, []);
  useEffect(() => {
    setMessage("");
    setError("");
  }, [panel]);
  async function run(request: Request, success: string) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (request.op === "import") {
        await importBackup(String(request.data));
      } else {
        await dispatch(request);
        await reload();
      }
      if (request.op === "profile_reset") setFormVersion((v) => v + 1);
      setMessage(success);
      return true;
    } catch (e) {
      setError(String(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const sourceSummary = {
    total: data.sources.length,
    enabled: data.sources.filter((s) => s.enabled).length,
    keyless: data.sources.filter((s) => s.accessMode === "free-keyless").length,
    approval: data.sources.filter((s) => s.accessMode === "approval-free").length,
    images: data.sources.filter((s) => s.imagesAvailable).length,
  };
  return (
    <dialog
      className="settings"
      ref={ref}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-labelledby="settings-title"
    >
      <header>
        <h2 id="settings-title">{panels[panel]}</h2>
        <button className="icon" aria-label="Close settings" onClick={close}>
          <X size={18} />
        </button>
      </header>
      <div className="settings-layout">
        <nav aria-label="Settings sections">
          {Object.entries(panels).map(([id, name]) => (
            <button
              key={id}
              aria-current={panel === id ? "page" : undefined}
              onClick={() => setPanel(id as Panel)}
            >
              {name}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          {message && (
            <p className="form-success" role="status">
              {message}
            </p>
          )}
          {panel === "preferences" && (
            <form
              key={`${data.profile.id}:${formVersion}`}
              onSubmit={(e: FormEvent<HTMLFormElement>) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(
                  {
                    op: "profile_update",
                    profileId: data.profile.id,
                    preferences: {
                      topics: list(String(f.get("topics"))),
                      regions: list(String(f.get("regions"))),
                      languages: list(String(f.get("languages"))),
                      keywords: list(String(f.get("keywords"))),
                      excludeKeywords: list(String(f.get("excludeKeywords"))),
                      sources: f.getAll("sources"),
                      diversityCap: Number(f.get("diversityCap")),
                    },
                  },
                  "Preferences saved.",
                );
              }}
            >
              <p className="intro">
                Tune <strong>{data.profile.name}</strong>. Matching happens
                locally. Empty fields include all available coverage; use commas
                to separate values.
              </p>
              <ImageControls settings />
              <div className="form-grid">
                <Field
                  label="Topics"
                  hint="For example: science, technology, local"
                >
                  <input
                    name="topics"
                    defaultValue={data.profile.preferences.topics.join(", ")}
                  />
                </Field>
                <Field
                  label="Regions"
                  hint="Use source region codes, for example: world, us"
                >
                  <input
                    name="regions"
                    defaultValue={data.profile.preferences.regions.join(", ")}
                  />
                </Field>
                <Field label="Languages" hint="For example: en, fr, es">
                  <input
                    name="languages"
                    defaultValue={data.profile.preferences.languages.join(", ")}
                  />
                </Field>
                <Field label="Include keywords">
                  <input
                    name="keywords"
                    defaultValue={data.profile.preferences.keywords.join(", ")}
                  />
                </Field>
                <Field label="Exclude keywords">
                  <input
                    name="excludeKeywords"
                    defaultValue={data.profile.preferences.excludeKeywords.join(
                      ", ",
                    )}
                  />
                </Field>
                <Field
                  label="Maximum share per source"
                  hint="A target, not a neutrality score. Sparse coverage may exceed it."
                >
                  <select
                    name="diversityCap"
                    defaultValue={data.profile.preferences.diversityCap}
                  >
                    {[0.2, 0.25, 0.33, 0.5, 0.75, 1].map((n) => (
                      <option key={n} value={n}>
                        {Math.round(n * 100)}%
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <fieldset>
                <legend>Preferred sources</legend>
                <p className="fine">
                  No selections means every enabled source.
                </p>
                {data.sources.map((s) => (
                  <label className="check" key={s.id}>
                    <input
                      type="checkbox"
                      name="sources"
                      value={s.id}
                      defaultChecked={data.profile.preferences.sources.includes(
                        s.id,
                      )}
                    />
                    {s.name}
                  </label>
                ))}
              </fieldset>
              <div className="form-actions">
                <button className="primary" disabled={busy}>
                  Save preferences
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      { op: "profile_reset", profileId: data.profile.id },
                      "Preferences reset. Saved stories and read state were preserved.",
                    )
                  }
                >
                  Reset preferences
                </button>
              </div>
            </form>
          )}
          {panel === "profiles" && (
            <>
              <p className="intro">
                Each profile keeps separate reading preferences, saved stories,
                watchlists and workspace tabs.
              </p>
              <div className="setting-rows">
                {data.profiles.map((p) => (
                  <div className="setting-row" key={p.id}>
                    <strong>{p.name}</strong>
                    {p.id === data.profile.id && (
                      <span className="tag">Current profile</span>
                    )}
                  </div>
                ))}
              </div>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const name = String(new FormData(form).get("name")).trim();
                  if (
                    name &&
                    (await run(
                      { op: "profile_create", name },
                      "Profile created. Switch profiles from the reading sidebar.",
                    ))
                  )
                    form.reset();
                }}
              >
                <Field label="New profile name">
                  <input
                    required
                    maxLength={80}
                    name="name"
                    placeholder="For example: Technology desk"
                  />
                </Field>
                <button className="primary" disabled={busy}>
                  Create profile
                </button>
              </form>
            </>
          )}
          {panel === "watchlists" && (
            <>
              <p className="intro">
                A story must match every configured dimension. Within a
                dimension, any keyword, topic or source can match. Alerts are
                opt-in.
              </p>
              <div className="setting-rows">
                {data.watchlists.map((w) => (
                  <div className="setting-row" key={w.id}>
                    <div>
                      <strong>{w.name}</strong>
                      <p className="fine">
                        {w.keywords.join(", ") || "All keywords"} ·{" "}
                        {w.alerts ? "Alerts requested" : "Alerts off"}
                      </p>
                    </div>
                    <button onClick={() => setEditing(w)}>Edit {w.name}</button>
                    {deleteWatchlist === w.id ? (
                      <>
                        <button
                          disabled={busy}
                          onClick={async () => {
                            if (
                              await run(
                                {
                                  op: "watchlist_delete",
                                  profileId: data.profile.id,
                                  id: w.id,
                                },
                                "Watchlist deleted.",
                              )
                            ) {
                              setDeleteWatchlist(undefined);
                              setEditing(undefined);
                            }
                          }}
                        >
                          Confirm delete
                        </button>
                        <button onClick={() => setDeleteWatchlist(undefined)}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <button onClick={() => setDeleteWatchlist(w.id)}>
                        Delete {w.name}
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <form
                key={editing?.id || "new"}
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  if (
                    await run(
                      {
                        op: "watchlist_save",
                        profileId: data.profile.id,
                        watchlist: {
                          id: editing?.id,
                          name: String(f.get("name")).trim(),
                          keywords: list(String(f.get("keywords"))),
                          topics: list(String(f.get("topics"))),
                          sources: f.getAll("sources"),
                          alerts: f.has("alerts"),
                        },
                      },
                      "Watchlist saved.",
                    )
                  ) {
                    setEditing(undefined);
                    form.reset();
                  }
                }}
              >
                <Field label="Watchlist name">
                  <input
                    required
                    name="name"
                    maxLength={80}
                    defaultValue={editing?.name || ""}
                  />
                </Field>
                <div className="form-grid">
                  <Field
                    label="Matching keywords"
                    hint="Comma-separated; matches headlines and excerpts"
                  >
                    <input
                      name="keywords"
                      defaultValue={editing?.keywords.join(", ") || ""}
                    />
                  </Field>
                  <Field label="Matching topics">
                    <input
                      name="topics"
                      defaultValue={editing?.topics.join(", ") || ""}
                    />
                  </Field>
                </div>
                <fieldset>
                  <legend>Matching sources</legend>
                  <p className="fine">Leave empty for any source.</p>
                  {data.sources.map((s) => (
                    <label className="check" key={s.id}>
                      <input
                        name="sources"
                        value={s.id}
                        type="checkbox"
                        defaultChecked={editing?.sources.includes(s.id)}
                      />
                      {s.name}
                    </label>
                  ))}
                </fieldset>
                <label className="check">
                  <input
                    name="alerts"
                    type="checkbox"
                    defaultChecked={editing?.alerts || false}
                  />
                  Request alerts for matching stories
                </label>
                <div className="form-actions">
                  <button className="primary" disabled={busy}>
                    Save watchlist
                  </button>
                  {editing && (
                    <button type="button" onClick={() => setEditing(undefined)}>
                      Cancel editing
                    </button>
                  )}
                </div>
              </form>
            </>
          )}
          {panel === "alerts" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void run(
                  {
                    op: "profile_update",
                    profileId: data.profile.id,
                    alertsEnabled: f.has("enabled"),
                    quietHours: {
                      enabled: f.has("quiet"),
                      start: String(f.get("start")),
                      end: String(f.get("end")),
                    },
                  },
                  "Alert settings saved.",
                );
              }}
            >
              <p className="intro">
                Watchlist alerts work only while News Terminal is running.
                Windows notification settings can also silence alerts. Quiet
                hours use the current local time and may cross midnight.
              </p>
              <fieldset>
                <legend>Desktop notifications</legend>
                <label className="check">
                  <input
                    name="enabled"
                    type="checkbox"
                    defaultChecked={data.profile.alertsEnabled}
                  />
                  Enable desktop alerts
                </label>
                <p className="fine">
                  Only watchlists with alerts enabled can notify you. Repeated
                  stories are deduplicated by the desktop host.
                </p>
              </fieldset>
              <fieldset>
                <legend>Quiet hours</legend>
                <label className="check">
                  <input
                    name="quiet"
                    type="checkbox"
                    defaultChecked={data.profile.quietHours.enabled}
                  />
                  Enable quiet hours
                </label>
                <div className="form-grid">
                  <Field label="Quiet hours start">
                    <input
                      type="time"
                      name="start"
                      required
                      defaultValue={data.profile.quietHours.start}
                    />
                  </Field>
                  <Field label="Quiet hours end">
                    <input
                      type="time"
                      name="end"
                      required
                      defaultValue={data.profile.quietHours.end}
                    />
                  </Field>
                </div>
              </fieldset>
              <button disabled={busy} className="primary">
                Save alert settings
              </button>
            </form>
          )}
          {panel === "connections" && <Connections sources={data.sources} run={run} busy={busy} />}
          {panel === "screens" && <MonitorControls />}
          {panel === "sources" && (
            <>
              <div className="source-directory-summary" aria-label="Source directory summary">
                <span>{sourceSummary.total} configured</span>
                <span>{sourceSummary.enabled} enabled</span>
                <span>{sourceSummary.keyless} free keyless</span>
                <span>{sourceSummary.approval} approval-free custom</span>
                <span>{sourceSummary.images} with reviewed images</span>
              </div>
              <p className="intro">
                Sources are shared across profiles. A failed source does not
                remove its cached stories. Review the publisher’s terms before
                adding a feed.
              </p>
              <div className="setting-rows">
                {data.sources.map((s) => (
                  <div className="source-row" key={s.id}>
                    <div className="setting-row">
                      <div>
                        <strong>{s.name}</strong>
                        <p className="fine">
                          {s.kind} · {s.region} · {s.language}
                        </p>
                        <p className="fine">
                          Adapter: {sourceAdapterLabel(s)} - Access: {sourceAccessLabel(s)} - Publisher: {s.publisher || s.name}
                        </p>
                      </div>
                      <label className="check">
                        <input
                          type="checkbox"
                          aria-label={`Enable ${s.name}`}
                          checked={s.enabled}
                          disabled={busy}
                          onChange={(e) =>
                            void run(
                              {
                                op: "source_update",
                                sourceId: s.id,
                                enabled: e.target.checked,
                              },
                              "Source updated.",
                            )
                          }
                        />
                        Enabled
                      </label>
                    </div>
                    <div className="source-meta">
                      <span className="tag">{!s.enabled ? "Disabled · not scheduled" : sourceFailed(s) ? (s.lastSuccess == null ? "Failed · no successful retrieval" : "Failed · previous success recorded") : s.lastSuccess != null ? "Successful retrieval recorded" : "No successful retrieval recorded"}</span>
                      <span>
                        Last success:{" "}
                        {s.lastSuccess != null ? date(s.lastSuccess) : "None recorded"}
                      </span>
                    </div>
                    <p className="fine source-status">{s.status}</p>
                    <p className="fine">Last attempt: {s.lastAttempt != null ? date(s.lastAttempt) : "Not recorded"}</p>
                    {s.enabled && <p className="fine">{sourceEligibleAt(s) === undefined ? "Eligibility unavailable for this source’s stored health data." : sourceEligibleAt(s)! > Date.now() / 1000 ? `Eligible after ${date(sourceEligibleAt(s)!)}.` : "Eligible for the next refresh check."} Refresh checks respect both the minimum interval and retry backoff; this is not a scheduled retrieval time.</p>}
                    <p className="fine">
                      Storage:{" "}
                      {s.storage === "excerpt"
                        ? "Publisher excerpt"
                        : "Title and link only"}{" "}
                      · AI: {s.aiAllowed ? "Permitted" : "Not permitted"} · Images: {s.imagesAvailable ? "reviewed candidates" : "not reviewed"}
                    </p>
                    {s.storage === "excerpt" ? <label className="check media-permission"><input type="checkbox" checked={!!s.mediaAllowed} disabled={busy} onChange={e => void run({ op: "source_update", sourceId: s.id, mediaAllowed: e.target.checked }, "Media permission updated. Media still loads only when clicked.")} />I have permission to load media from {s.name}</label> : <p className="fine">Media unavailable for metadata-only sources.</p>}
                    <p className="fine">Media rights are separate from reading and AI permissions. Review credits and terms; enabling this never loads media automatically.</p>
                    <div className="form-actions">
                      <button
                        className="quiet"
                        onClick={() =>
                          void run(
                            { op: "open_original", url: s.homepage || s.url },
                            "Publisher opened.",
                          )
                        }
                      >
                        Publisher ↗
                      </button>
                      {s.termsUrl && (
                        <button
                          className="quiet"
                          onClick={() =>
                            void run(
                              { op: "open_original", url: s.termsUrl },
                              "Terms opened.",
                            )
                          }
                        >
                          Terms ↗
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <h3>Add a custom RSS or Atom feed</h3>
              <form
                className="spaced-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const form = e.currentTarget;
                  const f = new FormData(form);
                  const url = String(f.get("url"));
                  const termsUrl = String(f.get("termsUrl"));
                  if (![url, termsUrl].every((u) => /^https?:\/\//i.test(u))) {
                    setError(
                      "Feed and terms URLs must start with https:// or http://.",
                    );
                    return;
                  }
                  if (
                    await run(
                      {
                        op: "source_add",
                        name: String(f.get("name")).trim(),
                        url,
                        termsUrl,
                        topics: list(String(f.get("topics"))),
                        region: String(f.get("region")).trim(),
                        language: String(f.get("language")).trim(),
                        kind: String(f.get("kind")),
                        storage: String(f.get("storage")),
                        aiAllowed: f.has("aiAllowed"),
                      },
                      "Feed added. Use Refresh feeds to fetch its stories.",
                    )
                  )
                    form.reset();
                }}
              >
                <Field label="Feed name">
                  <input required maxLength={120} name="name" />
                </Field>
                <Field label="Feed URL">
                  <input
                    required
                    type="url"
                    name="url"
                    placeholder="https://publisher.example/feed.xml"
                  />
                </Field>
                <Field label="Publisher terms URL">
                  <input required type="url" name="termsUrl" />
                </Field>
                <div className="form-grid">
                  <Field label="Feed topics">
                    <input name="topics" placeholder="science, local" />
                  </Field>
                  <Field label="Feed region">
                    <input name="region" required defaultValue="world" />
                  </Field>
                  <Field label="Feed language">
                    <input name="language" required defaultValue="en" />
                  </Field>
                  <Field label="Content classification">
                    <select name="kind">
                      <option>reporting</option>
                      <option>discussion</option>
                      <option>official notice</option>
                      <option>opinion</option>
                    </select>
                  </Field>
                </div>
                <Field label="Permitted storage">
                  <select name="storage" defaultValue="metadata">
                    <option value="metadata">Title and link only</option>
                    <option value="excerpt">Feed excerpt</option>
                  </select>
                </Field>
                <fieldset>
                  <legend>Publisher permissions</legend>
                  <label className="check">
                    <input type="checkbox" required />I have permission to
                    access and store this feed as selected
                  </label>
                  <label className="check">
                    <input type="checkbox" name="aiAllowed" />
                    The publisher permits AI processing of this feed’s excerpts
                  </label>
                  <p className="fine">
                    Reading permission does not imply permission to send content
                    to AI providers.
                  </p>
                </fieldset>
                <button className="primary" disabled={busy}>
                  Add feed
                </button>
              </form>
            </>
          )}
          {panel === "providers" && (
            <>
              <p className="intro">
                AI is optional. No excerpt is sent when you open a story. Only
                enabled providers with your consent can receive content,
                including on fallback. Cloud free tiers have quotas and can
                change; verify your account’s billing policy.
              </p>
              <p className="fine">
                Fallback follows the desktop host’s provider order. Keys are
                stored in the Windows credential store, never in this workspace
                or its backups.
              </p>
              <section className="local-ai-setup">
                <h3>Connect the installed local model</h3>
                <p className="fine">Use local AI checks Ollama on 127.0.0.1:11434 for qwen3:4b-instruct-2507-q4_K_M. By clicking, you consent to processing permitted excerpts locally. This does not install a runtime, enable cloud providers, change source permissions or generate a summary.</p>
                <button className="primary" disabled={busy} onClick={() => void run({ op: "local_ai_connect" }, "Local AI connected. The installed model is shown below; source permissions are unchanged.")}>{busy ? "Checking local AI…" : "Use local AI"}</button>
              </section>
              {(["ollama", "gemini", "groq"] as const).map((kind) => {
                const p = data.providers.find((p) => p.kind === kind) || {
                  id: kind,
                  name:
                    kind === "ollama"
                      ? "Ollama"
                      : kind === "gemini"
                        ? "Gemini"
                        : "Groq",
                  kind,
                  model:
                    kind === "ollama"
                      ? "llama3.2"
                      : kind === "gemini"
                        ? "gemini-2.5-flash"
                        : "llama-3.3-70b-versatile",
                  enabled: false,
                  consented: false,
                  hasKey: false,
                };
                return (
                  <form
                    className="provider-form"
                    key={`${p.id}:${p.model}:${p.enabled}:${p.consented}:${p.hasKey}`}
                    onSubmit={async (e) => {
                      e.preventDefault();
                      const form = e.currentTarget;
                      const f = new FormData(form);
                      const keyInput = form.elements.namedItem(
                        "apiKey",
                      ) as HTMLInputElement | null;
                      const apiKey = keyInput?.value.trim();
                      if (keyInput) keyInput.value = "";
                      await run(
                        {
                          op: "provider_save",
                          provider: {
                            id: p.id,
                            name: p.name,
                            kind: p.kind,
                            model: String(f.get("model")).trim(),
                            enabled: f.has("enabled"),
                            consented: f.has("consented"),
                          },
                          ...(apiKey ? { apiKey } : {}),
                        },
                        "Provider settings saved.",
                      );
                    }}
                  >
                    <div className="setting-row">
                      <h3>{p.name}</h3>
                      <label className="check">
                        <input
                          name="enabled"
                          type="checkbox"
                          aria-label={`Enable ${p.name}`}
                          defaultChecked={p.enabled}
                        />
                        Enabled
                      </label>
                    </div>
                    <p className="fine">
                      {kind === "ollama"
                        ? "Runs on your local Ollama service. Install and pull the selected model separately."
                        : `Cloud provider · ${p.hasKey ? "A key is saved" : "No key saved"}`}
                    </p>
                    <div className="form-grid">
                      <Field label={`${p.name} model`}>
                        <input name="model" required defaultValue={p.model} />
                      </Field>
                      {kind !== "ollama" && (
                        <Field
                          label={`${p.name} API key`}
                          hint="Leave blank to keep the current key."
                        >
                          <input
                            type="password"
                            name="apiKey"
                            autoComplete="off"
                            spellCheck={false}
                            placeholder={
                              p.hasKey
                                ? "Key stored securely"
                                : "Enter your own key"
                            }
                          />
                        </Field>
                      )}
                    </div>
                    <label className="check">
                      <input
                        type="checkbox"
                        name="consented"
                        defaultChecked={p.consented}
                      />
                      {`I consent to sending excerpts to ${p.name}`}
                    </label>
                    <div className="form-actions">
                      <button disabled={busy} className="primary">
                        Save {p.name}
                      </button>
                    </div>
                  </form>
                );
              })}
            </>
          )}
          {panel === "backup" && (
            <>
              <p className="intro">
                Export your local profiles, source configuration, workspace and
                cached reading data. API keys are not included. Keep backups
                private: they contain your reading history.
              </p>
              <button
                disabled={busy}
                className="primary"
                onClick={async () => {
                  setBusy(true);
                  setError("");
                  try {
                    const text = await dispatch<string>({ op: "export" });
                    setBackup(text);
                    const blob = new Blob([text], { type: "application/json" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `news-terminal-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 10000);
                    setMessage(
                      "Backup prepared. Save the downloaded JSON file; you can also copy it from the field below.",
                    );
                  } catch (e) {
                    setError(String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Export backup
              </button>
              <hr />
              <h3>Restore from a backup</h3>
              <p className="intro">
                Import replaces current local data after the desktop host
                validates the entire backup. Export your current workspace
                first. Provider keys remain in the credential store.
              </p>
              <Field label="Choose backup file">
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    setError("");
                    setConfirmImport(false);
                    if (!f) return;
                    if (f.size > 100 * 1024 * 1024) {
                      setError("This backup exceeds the 100 MB import limit.");
                      return;
                    }
                    try {
                      setBackup(await f.text());
                    } catch {
                      setError("The selected file could not be read.");
                    }
                  }}
                />
              </Field>
              <Field label="Backup JSON">
                <textarea
                  rows={7}
                  value={backup}
                  spellCheck={false}
                  onChange={(e) => {
                    setBackup(e.target.value);
                    setConfirmImport(false);
                  }}
                />
              </Field>
              <label className="check">
                <input
                  type="checkbox"
                  checked={confirmImport}
                  onChange={(e) => setConfirmImport(e.target.checked)}
                />
                I understand this replaces the current local data
              </label>
              <div className="form-actions">
                <button
                  disabled={busy || !confirmImport || !backup.trim()}
                  onClick={async () => {
                    try {
                      JSON.parse(backup);
                    } catch {
                      setError("The backup is not valid JSON.");
                      return;
                    }
                    if (
                      await run(
                        { op: "import", data: backup },
                        "Backup imported.",
                      )
                    )
                      setConfirmImport(false);
                  }}
                >
                  Import backup
                </button>
              </div>
            </>
          )}
          {panel === "help" && (
            <>
              <p className="intro">
                Shortcuts act immediately. Single-key shortcuts are disabled
                while you type in a field.
              </p>
              <dl className="shortcuts">
                {[
                  ["/ or Ctrl K", "Search cached stories"],
                  ["J / K", "Next / previous story"],
                  ["O", "Open original in your browser"],
                  ["S", "Save / unsave selected story"],
                  ["R", "Refresh feeds"],
                  ["Ctrl T", "New tab"],
                  ["Ctrl W", "Close current tab"],
                  ["Ctrl Tab", "Next tab"],
                  ["Ctrl Shift Tab", "Previous tab"],
                  ["?", "Show keyboard shortcuts"],
                  ["Escape", "Close the current dialog"],
                ].map(([key, label]) => (
                  <div key={key}>
                    <dt>
                      <kbd>{key}</kbd>
                    </dt>
                    <dd>{label}</dd>
                  </div>
                ))}
              </dl>
              <p className="fine">
                Drag tabs to reorder, or use Move tab left. Detach opens a
                native window; closing that window reattaches its tab.
              </p>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
