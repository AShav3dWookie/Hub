import { describe, it, expect, vi } from "vitest";
import multer from "multer";
import type { Request, Response } from "express";
import { MAX_UPLOAD_BATCH_BYTES } from "@logger/shared";
import { rejectOversizeUpload, toClientError } from "./upload.js";
import { AppError, BadRequestError, NotFoundError } from "../lib/errors.js";

const reqWithLength = (contentLength?: string) =>
  ({ headers: contentLength == null ? {} : { "content-length": contentLength } }) as unknown as Request;

const res = {} as Response;

describe("rejectOversizeUpload", () => {
  it("passes a request that declares no length", () => {
    const next = vi.fn();
    rejectOversizeUpload(reqWithLength(), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("passes a modest upload", () => {
    const next = vi.fn();
    rejectOversizeUpload(reqWithLength(String(5 * 1024 * 1024)), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("passes an upload right at the batch budget", () => {
    const next = vi.fn();
    rejectOversizeUpload(reqWithLength(String(MAX_UPLOAD_BATCH_BYTES)), res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it("rejects an upload far beyond the budget before multer buffers anything", () => {
    const next = vi.fn();
    rejectOversizeUpload(reqWithLength(String(MAX_UPLOAD_BATCH_BYTES * 2)), res, next);

    const passed = next.mock.calls[0][0];
    expect(passed).toBeInstanceOf(BadRequestError);
    expect((passed as BadRequestError).message).toMatch(/too large/);
  });

  it("passes a request whose declared length is not a number", () => {
    const next = vi.fn();
    rejectOversizeUpload(reqWithLength("not-a-number"), res, next);
    expect(next).toHaveBeenCalledWith();
  });
});

describe("toClientError", () => {
  it("passes an AppError through untouched, keeping its status", () => {
    const original = new NotFoundError("no such log");
    expect(toClientError(original)).toBe(original);
  });

  it("passes a plain AppError through as well", () => {
    const original = new AppError(418, "teapot");
    expect(toClientError(original)).toBe(original);
  });

  it("explains an oversize file", () => {
    const err = toClientError(new multer.MulterError("LIMIT_FILE_SIZE"));
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.message).toMatch(/too large/);
  });

  it("explains too many files", () => {
    expect(toClientError(new multer.MulterError("LIMIT_FILE_COUNT")).message).toMatch(
      /Too many files/,
    );
  });

  it("treats an unexpected file field as too many files", () => {
    expect(toClientError(new multer.MulterError("LIMIT_UNEXPECTED_FILE")).message).toMatch(
      /Too many files/,
    );
  });

  it("falls back to multer's own message for any other multer error", () => {
    const err = toClientError(new multer.MulterError("LIMIT_FIELD_KEY"));
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.message).not.toBe("Upload failed");
  });

  it("wraps an ordinary Error as a 400 carrying its message", () => {
    const err = toClientError(new Error("disk on fire"));
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.message).toBe("disk on fire");
  });

  it("has a last resort for something that is not an Error at all", () => {
    const err = toClientError("just a string");
    expect(err).toBeInstanceOf(BadRequestError);
    expect(err.message).toBe("Upload failed");
  });
});
