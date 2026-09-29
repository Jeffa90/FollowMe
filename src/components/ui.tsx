import Link from "next/link";
import { STATUS_LABELS, type GuideStatus } from "@/lib/roles";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "neutral", IN_REVIEW: "info", CHANGES_REQUESTED: "warn", READY_FOR_APPROVAL: "info", APPROVED: "ok", PUBLISHED: "ok", UNDER_REVIEW: "warn", SUPERSEDED: "neutral", ARCHIVED: "neutral",
};
export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge ${STATUS_TONE[status] ?? "neutral"}`}>{STATUS_LABELS[status as GuideStatus] ?? status}</span>;
}
export function SeverityBadge({ severity }: { severity: string }) {
  const tone = severity === "BLOCKING_ERROR" ? "danger" : severity === "WARNING" ? "warn" : severity === "ACCEPTED_EXCEPTION" ? "neutral" : "info";
  const label = { BLOCKING_ERROR: "Blocking error", WARNING: "Warning", SUGGESTION: "Suggestion", ACCEPTED_EXCEPTION: "Accepted exception" }[severity] ?? severity;
  return <span className={`badge ${tone}`}>{label}</span>;
}
export function PageHead({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="muted" style={{ margin: 0 }}>{sub}</p> : null}
      </div>
      {children ? <div className="btn-row">{children}</div> : null}
    </div>
  );
}
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="muted card">{children}</p>;
}
export const fmtDate = (d?: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "—");
export const fmtDateTime = (d?: Date | string | null) => (d ? new Date(d).toISOString().replace("T", " ").slice(0, 16) + " UTC" : "—");
export function GuideLink({ documentId, title }: { documentId: string; title: string }) {
  return <Link href={`/g/${documentId}`}>{title}</Link>;
}
