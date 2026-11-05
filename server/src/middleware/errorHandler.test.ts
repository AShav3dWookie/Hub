import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";
import { z } from "zod";
import { createErrorHandler, errorHandler } from "./errorHandler.js";
import { createTestDb } from "../testUtils/testDb.js";
import { listLogs } from "../services/serverLogService.js";
import { NotFoundError, BadRequestError, AppError } from "../lib/errors.js";

function mockRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

const req = {} as Request;
const next = vi.fn();

describe("errorHandler", () => {
  it("maps a ZodError to 400 with a validation-error shape", () => {
    const res = mockRes();
    let err: unknown;
    try {
      z.object({ n: z.number() }).parse({ n: "x" });
    } catch (e) {
      err = e;
    }
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: "Validation failed", details: expect.anything() }),
    );
  });

  it("maps AppError subclasses to their status code + message", () => {
    const res404 = mockRes();
    errorHandler(new NotFoundError("Log 5 not found"), req, res404, next);
    expect(res404.status).toHaveBeenCalledWith(404);
    expect(res404.json).toHaveBeenCalledWith({ error: "Log 5 not found" });

    const res400 = mockRes();
    errorHandler(new BadRequestError("bad"), req, res400, next);
    expect(res400.status).toHaveBeenCalledWith(400);

    const resCustom = mockRes();
    errorHandler(new AppError(418, "teapot"), req, resCustom, next);
    expect(resCustom.status).toHaveBeenCalledWith(418);
  });

  it("falls back to 500 for an unknown error and does not leak the message", () => {
    const res = mockRes();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    errorHandler(new Error("kaboom internals"), req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Internal server error" });
    spy.mockRestore();
  });
});

describe("createErrorHandler with a database", () => {
  it("puts a 500 in the hub's log with its stack, and leaves a 4xx out", () => {
    const ctx = createTestDb();
    try {
      const handler = createErrorHandler(ctx.db);
      const request = { method: "POST", originalUrl: "/api/voice?x=1" } as Request;
      handler(new Error("disk full"), request, mockRes(), next);
      handler(new NotFoundError("no such log"), request, mockRes(), next);

      expect(listLogs(ctx.db)).toEqual([
        expect.objectContaining({
          level: "error",
          source: "http",
          message: "500 on POST /api/voice: disk full",
          data: { stack: expect.stringContaining("disk full") },
        }),
      ]);
    } finally {
      ctx.cleanup();
    }
  });
});
