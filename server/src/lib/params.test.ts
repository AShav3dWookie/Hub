import { describe, it, expect } from "vitest";
import type { Request } from "express";
import { idParam } from "./params.js";
import { BadRequestError } from "./errors.js";

const req = (params: Record<string, string>) => ({ params }) as unknown as Request;

describe("idParam", () => {
  it("reads a positive integer", () => {
    expect(idParam(req({ id: "42" }), "id", "entity id")).toBe(42);
  });

  it("reads the named parameter, not the first one", () => {
    expect(idParam(req({ id: "1", noteId: "7" }), "noteId", "note id")).toBe(7);
  });

  it("rejects a non-numeric value", () => {
    expect(() => idParam(req({ id: "abc" }), "id", "entity id")).toThrow(BadRequestError);
  });

  it("rejects a fractional value", () => {
    expect(() => idParam(req({ id: "1.5" }), "id", "entity id")).toThrow(BadRequestError);
  });

  it("rejects a missing parameter", () => {
    expect(() => idParam(req({}), "id", "entity id")).toThrow(BadRequestError);
  });

  it("names the parameter in the message, so each route reads as it did before", () => {
    expect(() => idParam(req({ id: "x" }), "id", "entity id")).toThrow("Invalid entity id");
    expect(() => idParam(req({ photoId: "x" }), "photoId", "photo id")).toThrow("Invalid photo id");
  });

  it("reports a 400, not a 500", () => {
    try {
      idParam(req({ id: "x" }), "id", "log id");
      throw new Error("expected a throw");
    } catch (e) {
      expect((e as BadRequestError).statusCode).toBe(400);
    }
  });

  it("still accepts zero and negative integers, leaving them for the service to 404", () => {
    expect(idParam(req({ id: "0" }), "id", "log id")).toBe(0);
    expect(idParam(req({ id: "-3" }), "id", "log id")).toBe(-3);
  });
});
