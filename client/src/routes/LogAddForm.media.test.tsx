import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { LogAddForm } from "./LogAddForm.js";
import { AlbumAddForm } from "./AlbumAddForm.js";
import { clearResolvedIds } from "../sync/reconcile.js";

vi.mock("../api/afterMutation.js", () => ({
  refreshAfterMutation: (qc: { invalidateQueries: () => unknown }) => {
    void qc.invalidateQueries();
    return Promise.resolve();
  },
}));

const online = vi.hoisted(() => ({ value: true }));
vi.mock("../api/localHooks.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/localHooks.js")>()),
  useOnlineStatus: () => online.value,
}));

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const fetchMock = () => fetch as ReturnType<typeof vi.fn>;

/** Multipart uploads the app sent, as [url, FormData] pairs. */
function uploadCalls() {
  return fetchMock()
    .mock.calls.filter(([, init]) => (init as RequestInit)?.body instanceof FormData)
    .map(([url, init]) => [url as string, (init as RequestInit).body as FormData] as const);
}

const jpeg = (name = "holiday.jpg") =>
  new File([new Uint8Array([1, 2, 3])], name, { type: "image/jpeg" });
const mp4 = (name = "clip.mp4") => new File([new Uint8Array([1])], name, { type: "video/mp4" });

const fileInput = () => document.querySelector<HTMLInputElement>('input[type="file"]')!;

/**
 * Picking media on an add form must end with that media attached to the record.
 *
 * These are the outcome the two tests deleted on 1 September were protecting. They were phrased
 * against the transport ("POST /api/logs/42/photos was called"), so when the create moved to
 * the offline outbox they could not be translated and were dropped instead — and the upload was
 * removed a commit later with nothing left to fail. Phrased as an outcome, they survive the
 * next change of mechanism.
 */
describe("media picked on the log add form", () => {
  beforeEach(() => {
    online.value = true;
    clearResolvedIds();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  async function fillAndSubmit(files: File[]) {
    // The create syncs, and the server answers with the real id for the temp one.
    fetchMock().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/sync/mutations")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const results = (body.mutations ?? []).map(
          (m: { mutationId: string; tempId?: number }) => ({
            mutationId: m.mutationId,
            status: "applied",
            ...(m.tempId != null ? { idMap: { [m.tempId]: m.tempId === -1 ? 900 : 901 } } : {}),
          }),
        );
        return Promise.resolve(jsonResponse({ results }));
      }
      return Promise.resolve(jsonResponse([]));
    });

    renderWithProviders(<LogAddForm category="movie" />);
    await userEvent.type(screen.getByLabelText(/title/i) ?? screen.getAllByRole("textbox")[0], "Dune");
    if (files.length > 0) fireEvent.change(fileInput(), { target: { files } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));
  }

  it("attaches the picked photo to the entry that was just created", async () => {
    await fillAndSubmit([jpeg()]);

    await waitFor(() => expect(uploadCalls()).toHaveLength(1));
    const [url, form] = uploadCalls()[0];
    expect(url).toContain("/photos");
    expect(form.getAll("photos")).toHaveLength(1);
  });

  it("attaches a picked mp4 the same way a photo is attached", async () => {
    await fillAndSubmit([mp4()]);

    await waitFor(() => expect(uploadCalls()).toHaveLength(1));
    expect(uploadCalls()[0][1].getAll("photos")).toHaveLength(1);
  });

  it("attaches every picked file", async () => {
    await fillAndSubmit([jpeg("a.jpg"), jpeg("b.jpg"), mp4()]);

    await waitFor(() => expect(uploadCalls()).toHaveLength(1));
    expect(uploadCalls()[0][1].getAll("photos")).toHaveLength(3);
  });

  it("never uploads against the temporary id the outbox hands back", async () => {
    await fillAndSubmit([jpeg()]);

    await waitFor(() => expect(uploadCalls()).toHaveLength(1));
    const [url] = uploadCalls()[0];
    // A temp id is negative; the photo routes reject it.
    expect(url).not.toMatch(/\/-\d+\//);
    expect(url).toMatch(/\/logs\/\d+\/photos$/);
  });

  it("uploads nothing when no media was picked", async () => {
    await fillAndSubmit([]);

    await waitFor(() => expect(screen.queryByRole("button", { name: /save/i })).toBeTruthy());
    expect(uploadCalls()).toHaveLength(0);
  });

  it("offers the picker while online", () => {
    fetchMock().mockResolvedValue(jsonResponse([]));
    renderWithProviders(<LogAddForm category="movie" />);
    expect(fileInput().disabled).toBe(false);
  });

  it("disables the picker offline, and says why, rather than dropping the files", () => {
    online.value = false;
    fetchMock().mockResolvedValue(jsonResponse([]));
    renderWithProviders(<LogAddForm category="movie" />);

    expect(fileInput().disabled).toBe(true);
    expect(screen.getByText(/need a connection/i)).toBeInTheDocument();
  });

  it("accepts video in the picker, not images alone", () => {
    fetchMock().mockResolvedValue(jsonResponse([]));
    renderWithProviders(<LogAddForm category="movie" />);
    expect(fileInput().accept).toContain("video/mp4");
  });

  it("refuses an oversize photo before sending anything", async () => {
    fetchMock().mockResolvedValue(jsonResponse([]));
    renderWithProviders(<LogAddForm category="movie" />);

    const huge = new File([new Uint8Array([1])], "huge.jpg", { type: "image/jpeg" });
    Object.defineProperty(huge, "size", { value: 11 * 1024 * 1024 });

    await userEvent.type(screen.getAllByRole("textbox")[0], "Dune");
    fireEvent.change(fileInput(), { target: { files: [huge] } });
    fireEvent.click(screen.getByRole("button", { name: /save/i }));

    expect(await screen.findByText(/10MB or smaller/i)).toBeInTheDocument();
    expect(uploadCalls()).toHaveLength(0);
  });
});

describe("media picked on the album add form", () => {
  beforeEach(() => {
    online.value = true;
    clearResolvedIds();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => vi.unstubAllGlobals());

  it("accepts video, which its hand-typed accept list used to exclude", () => {
    fetchMock().mockResolvedValue(jsonResponse([]));
    renderWithProviders(<AlbumAddForm />);
    expect(fileInput().accept).toContain("video/mp4");
  });

  it("disables the picker offline, and says why", () => {
    online.value = false;
    fetchMock().mockResolvedValue(jsonResponse([]));
    renderWithProviders(<AlbumAddForm />);

    expect(fileInput().disabled).toBe(true);
    expect(screen.getByText(/need a connection/i)).toBeInTheDocument();
  });

  it("attaches the picked media to the album that was just created", async () => {
    fetchMock().mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/sync/mutations")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        const results = (body.mutations ?? []).map((m: { mutationId: string; tempId?: number }) => ({
          mutationId: m.mutationId,
          status: "applied",
          ...(m.tempId != null ? { idMap: { [m.tempId]: 700 } } : {}),
        }));
        return Promise.resolve(jsonResponse({ results }));
      }
      return Promise.resolve(jsonResponse([]));
    });

    renderWithProviders(<AlbumAddForm />);
    await userEvent.type(screen.getAllByRole("textbox")[0], "Rome trip");
    fireEvent.change(fileInput(), { target: { files: [jpeg()] } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));

    await waitFor(() => expect(uploadCalls()).toHaveLength(1));
    const [url, form] = uploadCalls()[0];
    expect(url).toMatch(/\/albums\/\d+\/photos$/);
    expect(url).not.toMatch(/\/-\d+\//);
    expect(form.getAll("photos")).toHaveLength(1);
  });
});
