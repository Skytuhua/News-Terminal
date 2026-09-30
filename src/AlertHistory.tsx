import { useEffect, useState } from "react";
import { BellOff } from "lucide-react";
import { dispatch } from "./ipc";
import type { AlertReceipt } from "./types";

// 0.5 alert delivery feedback. The host writes a receipt per delivered alert
// into the existing 90-day alert log, so this view is proof of delivery rather
// than a claim about it. A receipt whose article has since been pruned keeps
// its timestamp and says so plainly instead of rendering a blank row.
export default function AlertHistory({ profileId }: { profileId: string }) {
  const [rows, setRows] = useState<AlertReceipt[] | null>(null);

  useEffect(() => {
    let live = true;
    // profileId is always explicit: the host refuses a receipt read without
    // one rather than defaulting to a profile the reader never chose.
    void dispatch<AlertReceipt[]>({ op: "alert_receipts", profileId, limit: 50 }).then((result) => {
      if (live) setRows(Array.isArray(result) ? result : []);
    });
    return () => { live = false; };
  }, [profileId]);

  if (rows === null)
    return <div className="empty"><BellOff size={22} /><p>Loading alert history…</p></div>;

  return (
    <div className="alert-history">
      <div className="list-heading">
        <h2>Alert history</h2>
        <p>Watchlist alerts delivered in the last 90 days, newest first.</p>
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          <BellOff size={22} />
          <h3>No alerts delivered yet</h3>
          <p>Watchlist alerts work only while News Terminal is running.</p>
        </div>
      ) : (
        <ol className="receipts">
          {rows.map((r) => (
            <li key={`${r.articleId}-${r.at}`} data-testid="alert-receipt">
              <time dateTime={r.at}>{new Date(r.at).toLocaleString()}</time>
              <span>{r.title ?? "No longer available"}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
