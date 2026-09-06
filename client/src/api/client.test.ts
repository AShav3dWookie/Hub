import { describe, it, expect, vi, afterEach } from "vitest";
import { api, ApiError } from "./client.js";

afterEach(() => vi.unstubAllGlobals());

function stubFetch(response: Partial<Response> & { json?: () => Promise<unknown> }) {
  const fetchMock = vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve(response as Response),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const noContent = { ok: true, status: 204, json: async () => undefined };
const failure = (status: number, body: unknown, statusText = "Error") => ({
  ok: false,
  status,
  statusText,
  json: async () => body,
});

describe("api verbs", () => {
  it("prefixes every path with /api and sends credentials", async () => {
    const fetchMock = stubFetch(ok({ id: 1 }));
    await api.get("/logs/1");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/logs/1");
    expect(init.credentials).toBe("include");
  });

  it("sends JSON content type on a GET", async () => {
    const fetchMock = stubFetch(ok({}));
    await api.get("/logs");

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    expect(init.method).toBe("GET");
  });

  it("serialises a POST body", async () => {
    const fetchMock = stubFetch(ok({ id: 7 }));
    await api.post("/logs", { rating: 5 });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ rating: 5 }));
  });

  it("omits the body when a POST has none", async () => {
    const fetchMock = stubFetch(ok({}));
    await api.post("/logout");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBeUndefined();
  });

  it("serialises a PUT body", async () => {
    const fetchMock = stubFetch(ok({}));
    await api.put("/logs/1", { rating: 2 });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("PUT");
    expect(init.body).toBe(JSON.stringify({ rating: 2 }));
  });

  it("issues a DELETE", async () => {
    const fetchMock = stubFetch(noContent);
    await api.delete("/logs/1");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe("DELETE");
  });

  it("returns the parsed body", async () => {
    stubFetch(ok({ id: 42, title: "Dune" }));
    await expect(api.get("/entities/42")).resolves.toEqual({ id: 42, title: "Dune" });
  });

  it("resolves to undefined for a 204, which has no body to parse", async () => {
    stubFetch(noContent);
    await expect(api.delete("/logs/1")).resolves.toBeUndefined();
  });
});

describe("postForm", () => {
  it("posts the form data without a content type, so the browser sets the boundary", async () => {
    const fetchMock = stubFetch(ok([]));
    const form = new FormData();
    form.append("photos", new Blob(["x"]), "a.jpg");

    await api.postForm("/logs/1/photos", form);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/logs/1/photos");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(form);
    expect(init.headers).toBeUndefined();
    expect(init.credentials).toBe("include");
  });

  it("reports a failed upload the same way the JSON verbs do", async () => {
    stubFetch(failure(400, { error: "That file is too large (250MB max)" }));

    await expect(api.postForm("/logs/1/photos", new FormData())).rejects.toThrow(ApiError);
    await expect(api.postForm("/logs/1/photos", new FormData())).rejects.toThrow(/too large/);
  });

  it("resolves to undefined for a 204 upload response", async () => {
    stubFetch(noContent);
    await expect(api.postForm("/logs/1/photos", new FormData())).resolves.toBeUndefined();
  });
});

describe("error handling", () => {
  it("throws an ApiError carrying the status", async () => {
    stubFetch(failure(404, { error: "Log 9 not found" }));

    await expect(api.get("/logs/9")).rejects.toThrow(ApiError);
    await expect(api.get("/logs/9")).rejects.toMatchObject({ status: 404 });
  });

  it("prefers the server's own error message", async () => {
    stubFetch(failure(400, { error: "Invalid log id" }));
    await expect(api.get("/logs/x")).rejects.toThrow("Invalid log id");
  });

  it("falls back to the status text when the body carries no error field", async () => {
    stubFetch(failure(500, {}, "Internal Server Error"));
    await expect(api.get("/logs")).rejects.toThrow("Internal Server Error");
  });

  it("falls back to the status text when the body is not JSON at all", async () => {
    stubFetch({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => {
        throw new SyntaxError("Unexpected token < in JSON");
      },
    });

    await expect(api.get("/logs")).rejects.toThrow("Bad Gateway");
    await expect(api.get("/logs")).rejects.toMatchObject({ status: 502 });
  });

  it("names the error so it can be told apart from a network failure", async () => {
    stubFetch(failure(404, { error: "gone" }));
    await expect(api.get("/x")).rejects.toMatchObject({ name: "ApiError" });
  });

  it("lets a genuine network failure through untouched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))),
    );
    await expect(api.get("/logs")).rejects.toThrow(TypeError);
  });
});
