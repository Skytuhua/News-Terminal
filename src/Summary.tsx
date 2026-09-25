import { useEffect, useRef, useState } from "react";
import type { Article, Provider, Summary as SummaryResult } from "./types";
import { dispatch } from "./ipc";
import { date } from "./model";
import SourceUrl from "./SourceUrl";
export default function Summary({
  article,
  providers,
  profileId,
  configure,
}: {
  article: Pick<Article, "id" | "aiAllowed">;
  providers: Provider[];
  profileId: string;
  configure: () => void;
}) {
  const [result, setResult] = useState<SummaryResult>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const request = useRef<string | undefined>(undefined);
  const ready = providers.some(
    (p) => p.enabled && p.consented && (p.kind === "ollama" || p.hasKey),
  );
  useEffect(
    () => () => {
      const id = request.current;
      request.current = undefined;
      if (id)
        void dispatch({ op: "summary_cancel", requestId: id }).catch(() => {});
    },
    [],
  );
  async function summarize() {
    const id = crypto.randomUUID();
    request.current = id;
    setBusy(true);
    setError("");
    setStatus("");
    setResult(undefined);
    try {
      const value = await dispatch<SummaryResult>({
        op: "summarize",
        profileId,
        articleId: article.id,
        requestId: id,
      });
      if (request.current === id) setResult(value);
    } catch (e) {
      if (request.current === id) setError(String(e));
    } finally {
      if (request.current === id) {
        request.current = undefined;
        setBusy(false);
      }
    }
  }
  async function cancel() {
    const id = request.current;
    request.current = undefined;
    setBusy(false);
    setStatus("Summary cancelled.");
    if (id)
      try {
        await dispatch({ op: "summary_cancel", requestId: id });
      } catch {
        setError(
          "The cancellation could not reach the provider. Any late result will be discarded.",
        );
      }
  }
  return (
    <section className="summary">
      <div className="section-heading">
        <h3>Optional AI summary</h3>
        <button className="quiet" onClick={configure}>
          Configure AI
        </button>
      </div>
      <p className="fine">
        On demand only. Enabled, consented providers may be tried in fallback
        order; your original excerpt remains available if every provider fails.
      </p>
      {!article.aiAllowed && (
        <p className="fine">
          This item is not eligible for AI processing under the current source and item permissions.
        </p>
      )}
      {article.aiAllowed && !ready && (
        <p className="fine">
          Enable a provider and give consent before requesting a summary.
        </p>
      )}
      <div className="form-actions">
        {busy ? (
          <>
            <span role="status">Generating from the feed excerpt…</span>
            <button onClick={() => void cancel()}>Cancel summary</button>
          </>
        ) : (
          <button
            disabled={!article.aiAllowed || !ready}
            onClick={() => void summarize()}
          >
            Summarize excerpt
          </button>
        )}
      </div>
      {error && (
        <p className="form-error" role="alert">
          Summary unavailable: {error}. You can retry; the publisher excerpt is
          unchanged.
        </p>
      )}
      {status && (
        <p className="fine" role="status">
          {status}
        </p>
      )}
      {result && (
        <div className="summary-output">
          <h3>AI-generated · verify with the original</h3>
          {result.outputLabel && <p className="fine">{result.outputLabel}</p>}
          {result.inputLabel && <p className="fine">{result.inputLabel}</p>}
          <p>{result.text}</p>
          {result.attribution && <p className="fine">{result.attribution}</p>}
          <p className="fine">
            {result.provider} · {result.model} · {result.scope}
          </p>
          <p className="fine">Generated {date(result.generatedAt)}</p>
          <button
            className="quiet"
            onClick={() =>
              void dispatch({ op: "open_original", url: result.url }).catch(
                (e) => setError(String(e)),
              )
            }
          >
            Source cited by this summary ↗
          </button>
          <SourceUrl url={result.url} open={() => void dispatch({ op: "open_original", url: result.url }).catch(e => setError(String(e)))} />
        </div>
      )}
    </section>
  );
}
