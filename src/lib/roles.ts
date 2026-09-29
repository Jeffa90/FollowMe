// Roles, statuses and classification helpers shared by server and client.
export const ROLES = ["AUTHOR", "PROCESS_OWNER", "REVIEWER", "APPROVER", "PUBLISHER", "LEARNER", "ADMIN", "AUDITOR"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  AUTHOR: "Author",
  PROCESS_OWNER: "Process owner",
  REVIEWER: "Reviewer / SME",
  APPROVER: "Approver",
  PUBLISHER: "Publisher / document controller",
  LEARNER: "Learner",
  ADMIN: "Administrator",
  AUDITOR: "Auditor",
};

export const CLASSIFICATIONS = ["PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];
export const clearanceAllows = (clearance: Classification, doc: Classification) =>
  CLASSIFICATIONS.indexOf(clearance) >= CLASSIFICATIONS.indexOf(doc);

export const STATUSES = [
  "DRAFT",
  "IN_REVIEW",
  "CHANGES_REQUESTED",
  "READY_FOR_APPROVAL",
  "APPROVED",
  "PUBLISHED",
  "UNDER_REVIEW",
  "SUPERSEDED",
  "ARCHIVED",
] as const;
export type GuideStatus = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<GuideStatus, string> = {
  DRAFT: "Draft",
  IN_REVIEW: "In review",
  CHANGES_REQUESTED: "Changes requested",
  READY_FOR_APPROVAL: "Ready for approval",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  UNDER_REVIEW: "Under review",
  SUPERSEDED: "Superseded",
  ARCHIVED: "Archived",
};

/** Versions users may rely on: the normal library shows only these. */
export const LIVE_STATUSES: GuideStatus[] = ["PUBLISHED", "UNDER_REVIEW"];
/** Content can only be edited in these states. */
export const EDITABLE_STATUSES: GuideStatus[] = ["DRAFT", "CHANGES_REQUESTED"];
/** A guide has at most one version in these "open work" states. */
export const OPEN_STATUSES: GuideStatus[] = ["DRAFT", "IN_REVIEW", "CHANGES_REQUESTED", "READY_FOR_APPROVAL", "APPROVED"];
