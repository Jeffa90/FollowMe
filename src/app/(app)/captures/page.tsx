import Link from "next/link";
import { requireRole } from "@/server/auth";
import { listSessions } from "@/server/services/capture";
import { PageHead, Empty, fmtDateTime } from "@/components/ui";
import { TokenForm } from "./TokenForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Capture" };

export default async function Captures() {
  const ctx = await requireRole("AUTHOR");
  const sessions = await listSessions(ctx);
  return (
    <>
      <PageHead title="Process capture" sub="Record a browser process with the FollowMe Chromium extension and turn it into an editable guide." />
      <div className="grid cols-2">
        <section className="card" aria-labelledby="ext-h"><h2 id="ext-h">1. Install the extension (prototype)</h2>
          <ol>
            <li>Build it: <code>npm run ext:build</code></li>
            <li>In Chrome/Edge open <code>chrome://extensions</code>, enable Developer mode, choose <strong>Load unpacked</strong> and select <code>extension/dist</code>.</li>
            <li>Create a capture token below and paste it, with this site&rsquo;s URL, into the extension popup.</li>
          </ol>
          <p className="muted">Recording is always visible: a red REC badge and an on-page banner. Pause instantly with <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd>. Passwords and keystrokes are never recorded. Administrator-restricted sites cannot be recorded.</p>
        </section>
        <TokenForm />
      </div>
      <h2>Your recordings</h2>
      {sessions.length === 0 ? <Empty>No recordings yet. Try the demo application at <Link href="/demo/expenses">/demo/expenses</Link>.</Empty> : (
        <div className="table-wrap"><table className="table"><caption className="visually-hidden">Recordings</caption><thead><tr><th scope="col">Started</th><th scope="col">Start page</th><th scope="col">Status</th><th scope="col">Events</th><th scope="col"><span className="visually-hidden">Open</span></th></tr></thead><tbody>
          {sessions.map((s) => <tr key={s.id}><td>{fmtDateTime(s.startedAt)}</td><td>{s.startUrl}</td><td>{s.status.toLowerCase()}</td><td>{s.eventCount}</td><td><Link href={`/captures/${s.id}`}>Open</Link></td></tr>)}
        </tbody></table></div>
      )}
    </>
  );
}
