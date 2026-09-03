import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { PhotoStream } from "./PhotoStream.js";
import type { GalleryPhotoDTO } from "@logger/shared";

const NOW = "2024-05-01T00:00:00.000Z";

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
    // Take the Lightbox's instant (reduced-motion) nav path; the slide animation
    // itself is covered in Lightbox.test.
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
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
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/api/photos/full-3.jpg");
    expect(screen.getByRole("link", { name: "Heat" })).toHaveAttribute("href", "/entity/9");
  });

  it("badges video tiles and plays them in a <video> in the lightbox", async () => {
    const video = photo(7, { kind: "video", url: "/api/photos/full-7.mp4" });
    const { container } = renderStream(
      <PhotoStream {...base} photos={[video, photo(1)]} emptyText="" />,
    );
    expect(container.querySelectorAll('[data-testid="video-badge"]')).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "photo-7.jpg" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.querySelector("video")).toHaveAttribute("src", "/api/photos/full-7.mp4");
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

  it("navigates loaded photos and moves the caption with them", async () => {
    renderStream(
      <PhotoStream
        {...base}
        photos={[
          photo(1),
          photo(2, {
            log: { id: 2, entityId: 5, entityTitle: "Ronin", category: "movie", date: "2024-02-02" },
          }),
        ]}
        emptyText=""
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "photo-1.jpg" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/api/photos/full-1.jpg");
    expect(screen.getByRole("link", { name: "Heat" })).toHaveAttribute("href", "/entity/9");
    expect(screen.queryByRole("button", { name: "Previous photo" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(within(dialog).getByRole("img")).toHaveAttribute("src", "/api/photos/full-2.jpg");
    expect(screen.getByRole("link", { name: "Ronin" })).toHaveAttribute("href", "/entity/5");
    expect(screen.queryByRole("button", { name: "Next photo" })).not.toBeInTheDocument();
  });

  it("shows no arrows for a lone photo with no further pages", async () => {
    renderStream(<PhotoStream {...base} photos={[photo(1)]} emptyText="" />);
    await userEvent.click(screen.getByRole("button", { name: "photo-1.jpg" }));
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Previous photo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next photo" })).not.toBeInTheDocument();
  });

  it("fetches the next page from the end and then advances onto the new photo", async () => {
    const fetchNextPage = vi.fn();
    const { rerender } = renderStream(
      <PhotoStream
        {...base}
        photos={[photo(1)]}
        hasNextPage
        fetchNextPage={fetchNextPage}
        emptyText=""
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "photo-1.jpg" }));
    await userEvent.click(await screen.findByRole("button", { name: "Next photo" }));
    expect(fetchNextPage).toHaveBeenCalled();

    // the query starts fetching...
    rerender(
      <MemoryRouter>
        <PhotoStream
          {...base}
          photos={[photo(1)]}
          hasNextPage
          isFetchingNextPage
          fetchNextPage={fetchNextPage}
          emptyText=""
        />
      </MemoryRouter>,
    );

    // ...then the next page lands
    rerender(
      <MemoryRouter>
        <PhotoStream
          {...base}
          photos={[photo(1), photo(2)]}
          hasNextPage={false}
          fetchNextPage={fetchNextPage}
          emptyText=""
        />
      </MemoryRouter>,
    );

    expect(within(screen.getByRole("dialog")).getByRole("img")).toHaveAttribute(
      "src",
      "/api/photos/full-2.jpg",
    );
  });

  it("resets the delete confirmation when navigating to another photo", async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);
    renderStream(
      <PhotoStream
        {...base}
        photos={[photo(1), photo(2)]}
        emptyText=""
        onDelete={onDelete}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: "photo-1.jpg" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete photo" }));
    expect(screen.getByText("Delete this photo?")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Next photo" }));
    expect(screen.queryByText("Delete this photo?")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete photo" })).toBeInTheDocument();
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
