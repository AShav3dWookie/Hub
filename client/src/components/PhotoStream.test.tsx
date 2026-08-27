import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PhotoStream } from "./PhotoStream.js";
import type { GalleryPhotoDTO } from "@logger/shared";

const NOW = "2024-05-01T00:00:00.000Z";

function photo(id: number, over: Partial<GalleryPhotoDTO> = {}): GalleryPhotoDTO {
  return {
    id,
    logId: 1,
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
        this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver),
    };
  }
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

const base = {
  isLoading: false,
  hasNextPage: false,
  isFetchingNextPage: false,
  fetchNextPage: () => {},
};

function renderStream(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("PhotoStream", () => {
  beforeEach(() => {
    lastObserver = null;
    vi.stubGlobal("IntersectionObserver", FakeIO);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders a thumbnail per photo and the empty text when there are none", () => {
    const { rerender } = renderStream(
      <PhotoStream {...base} photos={[]} emptyText="nothing here" />,
    );
    expect(screen.getByText("nothing here")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <PhotoStream {...base} photos={[photo(2), photo(1)]} emptyText="nothing here" />
      </MemoryRouter>,
    );
    const imgs = screen.getAllByRole("img");
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toHaveAttribute("src", "/api/photos/thumb-2.webp");
  });

  it("opens a lightbox with the full image and an event link", async () => {
    renderStream(<PhotoStream {...base} photos={[photo(3)]} emptyText="" />);
    await userEvent.click(screen.getByRole("button", { name: "photo-3.jpg" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("img")).toHaveAttribute("src", "/api/photos/full-3.jpg");
    expect(screen.getByRole("link", { name: "Heat" })).toHaveAttribute("href", "/entity/9");
  });

  it("labels an orphaned photo as not linked to an event", async () => {
    renderStream(
      <PhotoStream {...base} photos={[photo(4, { log: null, logId: null })]} emptyText="" />,
    );
    await userEvent.click(screen.getByRole("button", { name: "photo-4.jpg" }));
    expect(await screen.findByText("Not linked to an event")).toBeInTheDocument();
  });

  it("shows no delete control without onDelete", async () => {
    renderStream(<PhotoStream {...base} photos={[photo(5)]} emptyText="" />);
    await userEvent.click(screen.getByRole("button", { name: "photo-5.jpg" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Delete photo" })).not.toBeInTheDocument();
  });

  it("confirms then calls onDelete when provided", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderStream(<PhotoStream {...base} photos={[photo(6)]} emptyText="" onDelete={onDelete} />);

    await userEvent.click(screen.getByRole("button", { name: "photo-6.jpg" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete photo" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(onDelete).toHaveBeenCalledWith(6);
  });

  it("loads the next page when the sentinel scrolls into view", async () => {
    const fetchNextPage = vi.fn();
    renderStream(
      <PhotoStream
        {...base}
        photos={[photo(9)]}
        hasNextPage
        fetchNextPage={fetchNextPage}
        emptyText=""
      />,
    );
    lastObserver?.trigger();
    expect(fetchNextPage).toHaveBeenCalled();
  });
});
