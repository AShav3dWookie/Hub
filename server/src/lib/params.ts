import type { Request } from "express";
import { BadRequestError } from "./errors.js";

/**
 * Read a route parameter as an integer id, or reject the request.
 *
 * This exact guard was written out at thirteen call sites across five route files, in three
 * different forms: inline, and as two private helpers with different names and signatures.
 *
 * `label` names the thing in the error message ("entity id", "log id"), matching what each
 * route reported before. The check is `Number.isInteger` and nothing stricter, so a zero or
 * negative id still reaches the service and comes back as a 404 rather than a 400 — the
 * behaviour every route already had.
 */
export function idParam(req: Request, name: string, label: string): number {
  const id = Number(req.params[name]);
  if (!Number.isInteger(id)) {
    throw new BadRequestError(`Invalid ${label}`);
  }
  return id;
}
