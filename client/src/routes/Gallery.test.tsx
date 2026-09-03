import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { primeRepo } from "../test/mockRepo.js";
import { Gallery } from "./Gallery.js";
import type { GalleryPhotoDTO } from "@logger/shared";

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

function photo(id: number, over: Partial<GalleryPhotoDTO> = {}): GalleryPhotoDTO {
  return {
    id,
    logId: 1,
    kind: "photo",
    url: `/api/photos/full-${id}.jpg`,
    thumbnailUrl: `/api/photos/thumb-${id}.webp`,
    originalName: `photo-${id}.jpg`,
    createdAt: NOW,
    log: { id: 1, entityId: 9, entityTitle: "Heat", category: "movie", date: "2024-01-01" },
    ...over,
  };
}

let lastObserver: { trigger: () => void } | null = null;
class FakeIO {
  private cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  observe() {
    lastObserver = {
      trigger: () =>
        this.cb(
          [{ isIntersecting: true } as IntersectionObserverEntry],
          this as unknown as IntersectionObserver,
        ),
    };
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

describe("Gallery", () => {
  beforeEach(() => {
    primeRepo(repo);
    lastObserver = null;
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("IntersectionObserver", FakeIO);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders a thumbnail per photo", async () => {
    vi.mocked(repo.getGallery).mockResolvedValue({ photos: [photo(2), photo(1)], nextCursor: null });

    renderWithProviders(<Gallery />);

    const imgs = await screen.findAllByRole("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute("src", "/api/photos/thumb-2.webp");
  });

  it("opens a lightbox with the full image and a link to the event", async () => {
    vi.mocked(repo.getGallery).mockResolvedValue({ photos: [photo(3)], nextCursor: null });

    renderWithProviders(<Gallery />);
    await userEvent.click(await screen.findByRole("button", { name: "photo-3.jpg" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("img")).toHaveAttribute("src", "/api/photos/full-3.jpg");
    expect(screen.getByRole("link", { name: "Heat" })).toHaveAttribute("href", "/entity/9");
  });

  it("labels an orphaned photo as not linked to an event", async () => {
    vi.mocked(repo.getGallery).mockResolvedValue({
      photos: [photo(4, { log: null, logId: null })],
      nextCursor: null,
    });

    renderWithProviders(<Gallery />);
    await userEvent.click(await screen.findByRole("button", { name: "photo-4.jpg" }));

    expect(await screen.findByText("Not linked to an event")).toBeInTheDocument();
  });

  it("confirms then deletes a photo via the gallery endpoint", async () => {
    vi.mocked(repo.getGallery).mockResolvedValue({ photos: [photo(5)], nextCursor: null });
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(jsonResponse(undefined, 204));

    renderWithProviders(<Gallery />);
    await userEvent.click(await screen.findByRole("button", { name: "photo-5.jpg" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete photo" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/gallery/5",
      expect.objectContaining({ method: "DELETE" }),
    );
  });

  it("loads the next page when the sentinel scrolls into view", async () => {
    vi.mocked(repo.getGallery).mockImplementation(async ({ cursor } = {}) =>
      cursor != null
        ? { photos: [photo(10)], nextCursor: null }
        : { photos: [photo(12), photo(11)], nextCursor: 11 },
    );

    renderWithProviders(<Gallery />);
    await screen.findByRole("button", { name: "photo-12.jpg" });

    lastObserver?.trigger();

    await waitFor(() =>
      expect(vi.mocked(repo.getGallery)).toHaveBeenCalledWith(expect.objectContaining({ cursor: 11 })),
    );
    expect(await screen.findByRole("button", { name: "photo-10.jpg" })).toBeInTheDocument();
  });
});
