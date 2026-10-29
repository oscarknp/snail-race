import type { Context, MiddlewareHandler } from "hono";
import type { z, ZodTypeAny } from "zod";
import type { UserRow } from "./types.ts";

export type AppEnv = { Variables: { user: UserRow | null } };

export class HttpError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 500 | 502 | 503, message: string, public fields?: Record<string, string>) {
    super(message);
  }
}

/** Validate input with a zod schema; failures become a 400 with per-field messages. */
export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const fields: Record<string, string> = {};
  for (const issue of result.error.issues) {
    const key = issue.path.join(".") || "_";
    fields[key] ??= issue.message;
  }
  throw new HttpError(400, Object.values(fields)[0] ?? "Invalid input", fields);
}

export async function jsonBody(c: Context): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    throw new HttpError(400, "Expected a JSON body");
  }
}

export function currentUser(c: Context<AppEnv>): UserRow {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "Please log in first");
  return user;
}

export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  currentUser(c);
  await next();
};

export function idParam(c: Context, name = "id"): number {
  const id = Number(c.req.param(name));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, "Not found");
  return id;
}
