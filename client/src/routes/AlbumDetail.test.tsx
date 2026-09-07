import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { primeRepo } from "../test/mockRepo.js";
import { pendingOutbox } from "../local/outbox.js";
import { AlbumDetail } from "./AlbumDetail.js";
import type { AlbumDTO, GalleryResponse } from "@logger/shared";

vi.mock("../local/repo.js");
vi.mock("../api/afterMutation.js", () => ({
  refreshAfterMutation: (qc: { invalidateQueries: () => unknown }) => {
    void qc.invalidateQueries();
    return Promise.resolve();
  },
}));
import { repo } from "../local/repo.js";

const NOW = "2024-05-01T00:00:00.000Z";

/** Wait until a pending outbox envelope of `type` exists, then return its payload. */
async function queuedPayload(type: string): Promise<Record<string, unknown>> {
  let payload: Record<string, unknown> | undefined;
  await vi.waitFor(async () => {
    payload = (await pendingOutbox()).find((e) => e.type === type)?.payload as
      | Record<string, unknown>
      | undefined;
    expect(payload).toBeDefined();
  });
  return payload as Record<string, unknown>;
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function albumPayload(over: Partial<AlbumDTO> = {}): AlbumDTO {
  return {
    id: 1,
    title: "Road Trip",
    notes: "great week",
    dateStart: "2024-04-01",
    dateEnd: "2024-04-07",
    createdAt: NOW,
    updatedAt: NOW,
    eventCount: 1,
    photoCount: 2,
    events: [
      {
        id: 30,
        entityId: 9,
        rating: 4,
        date: "2024-04-02",
        notes: null,
        people: [],
        photos: [],
        albums: [],
        autoDelete: false,
        createdAt: NOW,
        updatedAt: NOW,
        entity: { id: 9, category: "movie", title: "Heat", createdAt: NOW, releaseYear: null, author: null },
      },
    ],
    people: [
      { id: 2, name: "Alex" },
      { id: 3, name: "Sam" },
    ],
    directPersonIds: [2],
    ...over,
  };
}

const photosPayload: GalleryResponse = {
  photos: [
    {
      id: 100,
      logId: 30,
      kind: "photo",
      url: "/api/photos/full-100.jpg",
      thumbnailUrl: "/api/photos/thumb-100.webp",
      originalName: "event.jpg",
      createdAt: NOW,
      log: { id: 30, entityId: 9, entityTitle: "Heat", category: "movie", date: "2024-04-02" },
      albums: [],
    },
    {
      id: 101,
      logId: null,
      kind: "photo",
      url: "/api/photos/full-101.jpg",
      thumbnailUrl: "/api/photos/thumb-101.webp",
      originalName: "loose.jpg",
      createdAt: NOW,
      log: null,
      albums: [],
    },
  ],
  nextCursor: null,
};

type Call = { url: string; method: string };
let calls: Call[];

function trackFetch() {
  calls = [];
  (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET" });
    return Promise.resolve(
      init?.method && init.method !== "GET" && init.method !== "DELETE"
        ? jsonResponse([], 201)
        : jsonResponse(undefined, 204),
    );
  });
}

const lastMatching = (pred: (c: Call) => boolean) => [...calls].reverse().find(pred);

function renderDetail({ editing = false } = {}) {
  return renderWithProviders(
    <Routes>
      <Route path="/album/:id" element={<AlbumDetail />} />
    </Routes>,
    { route: "/album/1", editing },
  );
}

/** In edit mode the title is an input, so the heading is not there to wait on. */
const loadedInEditMode = () => screen.findByDisplayValue("Road Trip");

describe("AlbumDetail", () => {
  beforeEach(() => {
    primeRepo(repo);
    vi.mocked(repo.getAlbum).mockResolvedValue(albumPayload());
    vi.mocked(repo.getGallery).mockResolvedValue(photosPayload);
    vi.stubGlobal("fetch", vi.fn());
    trackFetch();
  });

  it("renders header, events, people and the aggregated photo grid", async () => {
    renderDetail();

    expect(await screen.findByRole("heading", { name: "Road Trip" })).toBeInTheDocument();
    expect(screen.getByText("2024-04-01 – 2024-04-07")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Heat" })).toHaveAttribute("href", "/entity/9");

    expect(await screen.findByRole("img", { name: "event.jpg" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "loose.jpg" })).toBeInTheDocument();
  });

  it("excludes this album from a photo's 'part of' line, but shows a different one it's also in", async () => {
    vi.mocked(repo.getGallery).mockResolvedValue({
      photos: [
        {
          ...photosPayload.photos[0],
          albums: [
            { id: 1, title: "Road Trip" }, // the album this very page is showing
            { id: 77, title: "Ski Trip" },
          ],
        },
        photosPayload.photos[1],
      ],
      nextCursor: null,
    });

    renderDetail();
    await userEvent.click(await screen.findByRole("img", { name: "event.jpg" }));

    expect(await screen.findByRole("link", { name: "Ski Trip" })).toHaveAttribute("href", "/album/77");
    expect(screen.queryByRole("link", { name: "Road Trip" })).not.toBeInTheDocument();
  });

  it("shows only the year for a year-granularity album event (book)", async () => {
    vi.mocked(repo.getAlbum).mockResolvedValue(
      albumPayload({
        events: [
          {
            id: 30,
            entityId: 9,
            rating: 4,
            date: "2022-01-01",
            notes: null,
            people: [],
            photos: [],
            albums: [],
            autoDelete: false,
            createdAt: NOW,
            updatedAt: NOW,
            entity: { id: 9, category: "book", title: "Dune", createdAt: NOW, releaseYear: null, author: null },
          },
        ],
      }),
    );

    renderDetail();

    expect(await screen.findByText(/Book · 2022$/)).toBeInTheDocument();
    expect(screen.queryByText(/2022-01-01/)).not.toBeInTheDocument();
  });

  it("shows a remove button only for directly-added people", async () => {
    renderDetail({ editing: true });
    await loadedInEditMode();

    expect(screen.getByRole("button", { name: "Remove Alex" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Sam" })).not.toBeInTheDocument();
    expect(screen.getByText("via event")).toBeInTheDocument();
  });

  it("only lets you delete loose photos from the album view", async () => {
    renderDetail({ editing: true });

    await userEvent.click(await screen.findByRole("img", { name: "loose.jpg" }));
    expect(screen.getByRole("button", { name: /delete photo/i })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("img", { name: "event.jpg" }));
    expect(screen.queryByRole("button", { name: /delete photo/i })).not.toBeInTheDocument();
  });

  it("does not show the event picker results until a query is typed", async () => {
    renderDetail({ editing: true });
    await loadedInEditMode();
    expect(screen.getByPlaceholderText(/find an event to add/i)).toHaveValue("");
    expect(screen.queryByText(/no matching events/i)).not.toBeInTheDocument();
  });

  it("links a new event picked from the search box", async () => {
    vi.mocked(repo.search).mockResolvedValue({
      groupBy: "log",
      logs: [
        {
          id: 55,
          entityId: 40,
          rating: null,
          date: "2024-04-03",
          notes: null,
          people: [],
          photos: [],
          albums: [],
          autoDelete: false,
          createdAt: NOW,
          updatedAt: NOW,
          entity: { id: 40, category: "movie", title: "Sicario", createdAt: NOW, releaseYear: null, author: null },
        },
      ],
    });

    renderDetail({ editing: true });
    await loadedInEditMode();
    await userEvent.type(screen.getByPlaceholderText(/find an event to add/i), "sic");
    await userEvent.click(await screen.findByRole("button", { name: /Sicario/ }));

    expect(await queuedPayload("album.addEvent")).toMatchObject({ albumId: 1, logId: 55 });
  });

  it("deletes a loose photo through the album photo endpoint", async () => {
    renderDetail({ editing: true });
    await userEvent.click(await screen.findByRole("img", { name: "loose.jpg" }));
    await userEvent.click(screen.getByRole("button", { name: /delete photo/i }));
    const confirmRow = screen.getByText("Delete this photo?").parentElement!;
    await userEvent.click(within(confirmRow).getByRole("button", { name: "Delete" }));

    await vi.waitFor(() =>
      expect(lastMatching((c) => c.method === "DELETE" && c.url === "/api/albums/1/photos/101")).toBeTruthy(),
    );
  });

  it("uploads loose photos to the album", async () => {
    const { container } = renderDetail({ editing: true });
    await loadedInEditMode();

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "new.png", { type: "image/png" }));

    await vi.waitFor(() =>
      expect(lastMatching((c) => c.method === "POST" && c.url === "/api/albums/1/photos")).toBeTruthy(),
    );
  });

  it("removes an event from the album", async () => {
    renderDetail({ editing: true });
    await userEvent.click(await screen.findByRole("button", { name: /remove heat from album/i }));
    expect(await queuedPayload("album.removeEvent")).toMatchObject({ albumId: 1, logId: 30 });
  });

  it("removes a directly-added person", async () => {
    renderDetail({ editing: true });
    await userEvent.click(await screen.findByRole("button", { name: "Remove Alex" }));
    expect(await queuedPayload("album.removePerson")).toMatchObject({ albumId: 1, personId: 2 });
  });

  it("adds a person to the album", async () => {
    renderDetail({ editing: true });
    await loadedInEditMode();
    await userEvent.type(screen.getByPlaceholderText(/add a person/i), "Robin{Enter}");
    await userEvent.click(screen.getByRole("button", { name: /add to album/i }));

    expect(await queuedPayload("album.addPerson")).toMatchObject({ albumId: 1 });
  });

  it("deletes the album, offering keep-photos vs delete-photos", async () => {
    renderDetail({ editing: true });
    await userEvent.click(await screen.findByRole("button", { name: "Delete album" }));
    await userEvent.click(screen.getByRole("button", { name: /delete album, keep photos/i }));
    expect(await queuedPayload("album.delete")).toMatchObject({ albumId: 1, deletePhotos: false });
  });

  it("deletes the album and its loose photos when chosen", async () => {
    renderDetail({ editing: true });
    await userEvent.click(await screen.findByRole("button", { name: "Delete album" }));
    await userEvent.click(screen.getByRole("button", { name: /delete album & its loose photos/i }));
    expect(await queuedPayload("album.delete")).toMatchObject({ albumId: 1, deletePhotos: true });
  });

  it("shows what the album holds and none of the controls that change it, outside edit mode", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Road Trip" });

    // The content is all still there.
    expect(screen.getByRole("link", { name: "Heat" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Alex" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "loose.jpg" })).toBeInTheDocument();

    expect(screen.queryByRole("button", { name: "Delete album" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Alex" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove heat from album/i })).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/find an event to add/i)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/add a person/i)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("cannot delete a photo from the lightbox outside edit mode", async () => {
    renderDetail();
    await userEvent.click(await screen.findByRole("img", { name: "loose.jpg" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete photo/i })).not.toBeInTheDocument();
  });

  it("queues an album.update from the header form", async () => {
    renderDetail({ editing: true });
    const title = await loadedInEditMode();

    await userEvent.clear(title);
    await userEvent.type(title, "Coast Trip");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await queuedPayload("album.update")).toMatchObject({ albumId: 1, title: "Coast Trip" });
  });
});
