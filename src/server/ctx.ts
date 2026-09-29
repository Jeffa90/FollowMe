import type { Role, Classification } from "../lib/roles";

/** Authenticated request context. Every service call takes one; permissions are checked from it, never from client input. */
export interface Ctx {
  userId: string;
  orgId: string;
  name: string;
  email: string;
  roles: Role[];
  clearance: Classification;
  siteId: string | null;
  teamId: string | null;
  allSites: boolean;
  siteIds: string[];
  /** How the request authenticated: cookie session, or a scoped API token. */
  via: "session" | "token" | "system";
  scopes?: string[];
  ip?: string;
  requestId?: string;
}

export const hasRole = (ctx: Ctx, ...roles: Role[]) => roles.some((r) => ctx.roles.includes(r));
