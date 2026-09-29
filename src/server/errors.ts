export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}
export const badRequest = (msg: string, details?: unknown) => new AppError(400, "bad_request", msg, details);
export const unauthorized = (msg = "Authentication required") => new AppError(401, "unauthorized", msg);
export const forbidden = (msg = "You do not have permission to do that") => new AppError(403, "forbidden", msg);
// Cross-org and unknown ids both surface as 404 so object existence is not disclosed (BOLA hygiene).
export const notFound = (what = "Resource") => new AppError(404, "not_found", `${what} not found`);
export const conflict = (msg: string, details?: unknown) => new AppError(409, "conflict", msg, details);
export const unprocessable = (msg: string, details?: unknown) => new AppError(422, "unprocessable", msg, details);
export const tooMany = (msg = "Too many requests") => new AppError(429, "rate_limited", msg);
