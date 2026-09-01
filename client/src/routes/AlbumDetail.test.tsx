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
      url: "/api/photos/full-100.jpg",
      thumbnailUrl: "/api/photos/thumb-100.webp",
      originalName: "event.jpg",
      createdAt: NOW,
      log: { id: 30, entityId: 9, entityTitle: "Heat", category: "movie", date: "2024-04-02" },
    },
    {
      id: 101,
      logId: null,
      url: "/api/photos/full-101.jpg",
      thumbnailUrl: "/api/photos/thumb-101.webp",
      originalName: "loose.jpg",
      createdAt: NOW,
      log: null,
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

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/album/:id" element={<AlbumDetail />} />
    </Routes>,
    { route: "/album/1" },
  );
}

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
    renderDetail();
    await screen.findByRole("heading", { name: "Road Trip" });

    expect(screen.getByRole("button", { name: "Remove Alex" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Sam" })).not.toBeInTheDocument();
    expect(screen.getByText("via event")).toBeInTheDocument();
  });

  it("only lets you delete loose photos from the album view", async () => {
    renderDetail();

    await userEvent.click(await screen.findByRole("img", { name: "loose.jpg" }));
    expect(screen.getByRole("button", { name: /delete photo/i })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByRole("img", { name: "event.jpg" }));
    expect(screen.queryByRole("button", { name: /delete photo/i })).not.toBeInTheDocument();
  });

  it("does not show the event picker results until a query is typed", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Road Trip" });
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

    renderDetail();
    await screen.findByRole("heading", { name: "Road Trip" });
    await userEvent.type(screen.getByPlaceholderText(/find an event to add/i), "sic");
    await userEvent.click(await screen.findByRole("button", { name: /Sicario/ }));

    expect(await queuedPayload("album.addEvent")).toMatchObject({ albumId: 1, logId: 55 });
  });

  it("deletes a loose photo through the album photo endpoint", async () => {
    renderDetail();
    await userEvent.click(await screen.findByRole("img", { name: "loose.jpg" }));
    await userEvent.click(screen.getByRole("button", { name: /delete photo/i }));
    const confirmRow = screen.getByText("Delete this photo?").parentElement!;
    await userEvent.click(within(confirmRow).getByRole("button", { name: "Delete" }));

    await vi.waitFor(() =>
      expect(lastMatching((c) => c.method === "DELETE" && c.url === "/api/albums/1/photos/101")).toBeTruthy(),
    );
  });

  it("uploads loose photos to the album", async () => {
    const { container } = renderDetail();
    await screen.findByRole("heading", { name: "Road Trip" });

    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(input, new File(["x"], "new.png", { type: "image/png" }));

    await vi.waitFor(() =>
      expect(lastMatching((c) => c.method === "POST" && c.url === "/api/albums/1/photos")).toBeTruthy(),
    );
  });

  it("removes an event from the album", async () => {
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: /remove heat from album/i }));
    expect(await queuedPayload("album.removeEvent")).toMatchObject({ albumId: 1, logId: 30 });
  });

  it("removes a directly-added person", async () => {
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "Remove Alex" }));
    expect(await queuedPayload("album.removePerson")).toMatchObject({ albumId: 1, personId: 2 });
  });

  it("adds a person to the album", async () => {
    renderDetail();
    await screen.findByRole("heading", { name: "Road Trip" });
    await userEvent.type(screen.getByPlaceholderText(/add a person/i), "Robin{Enter}");
    await userEvent.click(screen.getByRole("button", { name: /add to album/i }));

    expect(await queuedPayload("album.addPerson")).toMatchObject({ albumId: 1 });
  });

  it("deletes the album, offering keep-photos vs delete-photos", async () => {
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: /delete album, keep photos/i }));
    expect(await queuedPayload("album.delete")).toMatchObject({ albumId: 1, deletePhotos: false });
  });

  it("deletes the album and its loose photos when chosen", async () => {
    renderDetail();
    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: /delete album & its loose photos/i }));
    expect(await queuedPayload("album.delete")).toMatchObject({ albumId: 1, deletePhotos: true });
  });
});
