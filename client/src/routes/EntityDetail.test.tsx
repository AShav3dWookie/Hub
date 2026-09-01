import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { primeRepo } from "../test/mockRepo.js";
import { pendingOutbox } from "../local/outbox.js";
import { EntityDetail } from "./EntityDetail.js";
import type { Category, LogDTO, LogPhotoDTO } from "@logger/shared";

vi.mock("../local/repo.js");
vi.mock("../api/afterMutation.js", () => ({
  refreshAfterMutation: (qc: { invalidateQueries: () => unknown }) => {
    void qc.invalidateQueries();
    return Promise.resolve();
  },
}));
import { repo } from "../local/repo.js";

const NOW = "2024-05-01T00:00:00.000Z";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function log(overrides: Partial<LogDTO> = {}): LogDTO {
  return {
    id: 1,
    entityId: 5,
    rating: 4,
    date: "2024-01-02",
    notes: null,
    people: [],
    photos: [],
    albums: [],
    autoDelete: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function setEntity(category: Category, logs: LogDTO[]) {
  vi.mocked(repo.getEntityDetail).mockResolvedValue({
    type: "entity",
    id: 5,
    category,
    title: `A ${category}`,
    createdAt: NOW,
    releaseYear: null,
    author: null,
    logs,
    visitCount: logs.length,
    averageRating: 4,
    latestDate: "2024-01-02",
  });
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/entity/:id" element={<EntityDetail />} />
    </Routes>,
    { route: "/entity/5" },
  );
}

describe("EntityDetail photo gallery", () => {
  beforeEach(() => {
    primeRepo(repo);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows the photo gallery for a movie log", async () => {
    setEntity("movie", [log({ photos: [] })]);
    renderDetail();
    expect(await screen.findByRole("button", { name: /add photos/i })).toBeInTheDocument();
  });

  it("shows a subtle 'part of X album' link when the log belongs to an album", async () => {
    setEntity("movie", [log({ albums: [{ id: 7, title: "Road Trip" }] })]);
    renderDetail();
    const link = await screen.findByRole("link", { name: "Road Trip" });
    expect(link).toHaveAttribute("href", "/album/7");
  });

  it("renders no album line when the log has no albums", async () => {
    setEntity("movie", [log({ albums: [] })]);
    renderDetail();
    await screen.findByRole("button", { name: /add photos/i });
    expect(screen.queryByText(/part of/i)).not.toBeInTheDocument();
  });

  it("renders existing photo thumbnails for an eating_out log", async () => {
    setEntity("eating_out", [
      log({
        photos: [
          {
            id: 8,
            logId: 1,
            url: "/api/photos/full-8.jpg",
            thumbnailUrl: "/api/photos/thumb-8.webp",
            originalName: "dinner.jpg",
            createdAt: NOW,
          },
        ],
      }),
    ]);
    renderDetail();
    expect(await screen.findByRole("img", { name: "dinner.jpg" })).toHaveAttribute(
      "src",
      "/api/photos/thumb-8.webp",
    );
  });

  it("does not show the gallery for TV / book / game logs", async () => {
    for (const category of ["tv", "book", "game"] as const) {
      setEntity(category, [log()]);
      const { unmount } = renderDetail();
      await screen.findByText(`A ${category}`);
      expect(screen.queryByRole("button", { name: /add photos/i })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("shows the read-mode rating bar for rated categories but not for hang-out / appointment", async () => {
    for (const category of ["movie", "book"] as const) {
      setEntity(category, [log({ rating: 3 })]);
      const { unmount } = renderDetail();
      await screen.findByText(`A ${category}`);
      expect(screen.getByRole("radiogroup", { name: "Rating" })).toBeInTheDocument();
      unmount();
    }
    for (const category of ["hang_out", "appointment"] as const) {
      setEntity(category, [log({ rating: null })]);
      const { unmount } = renderDetail();
      await screen.findByText(`A ${category}`);
      expect(screen.queryByRole("radiogroup", { name: "Rating" })).not.toBeInTheDocument();
      unmount();
    }
  });

  const withPhoto = () =>
    log({
      photos: [
        {
          id: 8,
          logId: 1,
          url: "/api/photos/full-8.jpg",
          thumbnailUrl: "/api/photos/thumb-8.webp",
          originalName: "dinner.jpg",
          createdAt: NOW,
        },
      ],
    });

  it("view mode shows the thumbnail + Add photos but no per-photo delete", async () => {
    setEntity("movie", [withPhoto()]);
    renderDetail();
    expect(await screen.findByRole("img", { name: "dinner.jpg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add photos/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete dinner.jpg" })).not.toBeInTheDocument();
  });

  it("the event editor exposes the per-photo delete (and keeps Add photos)", async () => {
    setEntity("movie", [withPhoto()]);
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    expect(screen.getByRole("button", { name: "Delete dinner.jpg" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add photos/i })).toBeInTheDocument();
  });
});

describe("EntityDetail log deletion with photos", () => {
  beforeEach(() => {
    primeRepo(repo);
    vi.stubGlobal("fetch", vi.fn());
  });

  const photo: LogPhotoDTO = {
    id: 8,
    logId: 1,
    url: "/api/photos/full-8.jpg",
    thumbnailUrl: "/api/photos/thumb-8.webp",
    originalName: "dinner.jpg",
    createdAt: NOW,
  };

  it("offers keep-vs-delete when the log has photos; 'keep' queues deletePhotos:false", async () => {
    setEntity("movie", [log({ photos: [photo] })]);
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: /keep photos/i }));

    await vi.waitFor(async () => expect(await pendingOutbox()).toHaveLength(1));
    expect((await pendingOutbox())[0]).toMatchObject({
      type: "log.delete",
      payload: { logId: 1, deletePhotos: false },
    });
  });

  it("'delete log & photos' queues deletePhotos:true", async () => {
    setEntity("movie", [log({ photos: [photo] })]);
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: /Delete log & 1 photo/ }));

    await vi.waitFor(async () => expect(await pendingOutbox()).toHaveLength(1));
    expect((await pendingOutbox())[0]).toMatchObject({
      type: "log.delete",
      payload: { logId: 1, deletePhotos: true },
    });
  });
});

describe("EntityDetail log date display", () => {
  beforeEach(() => {
    primeRepo(repo);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows only the year for a year-granularity category (book)", async () => {
    setEntity("book", [log({ date: "2024-01-01" })]);
    renderDetail();
    expect(await screen.findByText("2024")).toBeInTheDocument();
    expect(screen.queryByText("2024-01-01")).not.toBeInTheDocument();
  });

  it("shows the full date for a day-granularity category (movie)", async () => {
    setEntity("movie", [log({ date: "2024-03-05" })]);
    renderDetail();
    expect(await screen.findByText("2024-03-05")).toBeInTheDocument();
  });
});

describe("EntityDetail log edit mode", () => {
  beforeEach(() => {
    primeRepo(repo);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("edits a log's notes and queues a log.update", async () => {
    setEntity("movie", [log({ notes: "first viewing" })]);
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    const notes = screen
      .getAllByRole("textbox")
      .find((el) => el.tagName === "TEXTAREA") as HTMLTextAreaElement;
    await userEvent.clear(notes);
    await userEvent.type(notes, "second viewing");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(async () => expect(await pendingOutbox()).toHaveLength(1));
    expect((await pendingOutbox())[0]).toMatchObject({
      type: "log.update",
      payload: { logId: 1, notes: "second viewing", people: [] },
    });
  });

  it("cancels an edit without calling the API", async () => {
    setEntity("movie", [log({ notes: "keep me" })]);
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") throw new Error("should not PUT on cancel");
      return Promise.resolve(jsonResponse({}));
    });

    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Edit" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(await screen.findByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByText("keep me")).toBeInTheDocument();
  });
});
