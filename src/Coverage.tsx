import { useEffect, useRef, useState } from "react";
import { X, ExternalLink } from "lucide-react";
import type { Article } from "./types";
import { date } from "./model";
import type { Request } from "./ipc";
export default function Coverage({
  article,
  articles,
  profileId,
  action,
}: {
  article: Article;
  articles: Article[];
  profileId: string;
  action: (r: Request) => Promise<boolean>;
}) {
  const [compare, setCompare] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  const related = articles.filter(
    (a) => a.groupId === article.groupId && !a.hidden,
  );
  useEffect(() => {
    if (compare) ref.current?.showModal();
  }, [compare]);
  async function run(r: Request) {
    if (!(await action(r)))
      setError(
        "The action could not be completed. Close comparison to see the error and retry.",
      );
  }
  return (
    <>
      <section>
        <div className="section-heading">
          <h3>Likely related coverage</h3>
          <span className="muted">
            {related.length} {related.length === 1 ? "report" : "reports"}
          </span>
        </div>
        <p className="fine">
          Grouped by headline similarity and timing, not a verified shared event
          or a measure of independent reporting.
        </p>
        {related
          .filter((a) => a.id !== article.id)
          .map((a) => (
            <div className="related-row" key={a.id}>
              <span className="fine">
                {a.sourceName} · {a.kind}
              </span>
              <p>{a.title}</p>
              <button
                className="quiet"
                onClick={() => void action({ op: "open_original", url: a.url })}
              >
                Read source <ExternalLink size={12} />
              </button>
            </div>
          ))}
        <button onClick={() => setCompare(true)}>Compare coverage</button>
      </section>
      <section>
        <h3>Story timeline</h3>
        <ol className="timeline">
          {article.publishedAt !== null && (
            <li>
              <span>Publisher timestamp</span>
              <time>{date(article.publishedAt)}</time>
            </li>
          )}
          <li>
            <span>First seen in this workspace</span>
            <time>{date(article.firstSeen)}</time>
          </li>
          {article.history.map((h, i) => (
            <li key={i}>
              <span>Earlier feed version · {date(h.at)}</span>
              <p>{h.title}</p>
              <p className="fine">{h.excerpt}</p>
            </li>
          ))}
          {article.updatedAt !== article.firstSeen && (
            <li>
              <span>Feed updated</span>
              <time>{date(article.updatedAt)}</time>
            </li>
          )}
        </ol>
        <p className="fine">
          Feed and ingestion timestamps are not the chronology of the underlying
          event.
        </p>
      </section>
      {compare && (
        <dialog
          ref={ref}
          className="settings comparison"
          aria-label="Compare coverage"
          onCancel={() => setCompare(false)}
        >
          <header>
            <h2>Compare coverage</h2>
            <button
              className="icon"
              aria-label="Close comparison"
              onClick={() => setCompare(false)}
            >
              <X size={18} />
            </button>
          </header>
          <div className="comparison-body">
            <p className="intro">
              Read the excerpts side by side. Separate a report if this grouping
              is a false match.
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="comparison-grid">
              {related.map((a) => (
                <article key={a.id}>
                  <p className="fine">
                    {a.sourceName} · {a.kind}
                  </p>
                  <h3>{a.title}</h3>
                  <time className="fine">{date(a.publishedAt)}</time>
                  <p>{a.excerpt || "No excerpt is available."}</p>
                  <div className="form-actions">
                    <button
                      onClick={() =>
                        void run({ op: "open_original", url: a.url })
                      }
                    >
                      Open source <ExternalLink size={13} />
                    </button>
                    {a.id !== article.id && (
                      <button
                        aria-label={`Separate ${a.title}`}
                        onClick={() =>
                          void run({
                            op: "group_split",
                            profileId,
                            articleId: a.id,
                          })
                        }
                      >
                        Separate report
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}
