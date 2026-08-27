import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { PersonProfile } from "./PersonProfile.js";
import type { GalleryPhotoDTO } from "@logger/shared";

const NOW = "2024-05-01T00:00:00.000Z";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

/** Serve /entities/:id (profile), /entities/:id/notes (empty), /entities/:id/photos (given photos). */
function mockApi(profile: unknown, photos: GalleryPhotoDTO[] = []) {
  (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (url.includes("/photos")) return Promise.resolve(jsonResponse({ photos, nextCursor: null }));
    if (url.includes("/notes")) return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse(profile));
  });
}

function photo(id: number): GalleryPhotoDTO {
  return {
    id,
    logId: 3,
    url: `/api/photos/full-${id}.jpg`,
    thumbnailUrl: `/api/photos/thumb-${id}.webp`,
    originalName: `photo-${id}.jpg`,
    createdAt: NOW,
    log: { id: 3, entityId: 3, entityTitle: "Inception", category: "movie", date: "2024-01-01" },
  };
}

function renderProfile() {
  return renderWithProviders(
    <Routes>
      <Route path="/person/:id" element={<PersonProfile />} />
      <Route path="/entity/:id" element={<div>entity page</div>} />
    </Routes>,
    { route: "/person/7" },
  );
}

describe("PersonProfile", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("renders stats and appearances", async () => {
    mockApi({
      type: "person",
      entity: { id: 7, category: "person", title: "Sarah", createdAt: NOW, releaseYear: null, author: null },
      appearances: [
        {
          id: 1,
          entityId: 3,
          rating: 5,
          date: "2024-01-01",
          notes: "loved it",
          people: [],
          photos: [],
          createdAt: NOW,
          updatedAt: NOW,
          entity: { id: 3, category: "movie", title: "Inception", createdAt: NOW, releaseYear: null, author: null },
        },
      ],
      stats: { totalLogs: 1, favoriteCategory: "movie", mostFrequentCoPerson: null },
    });

    renderProfile();

    expect(await screen.findByRole("heading", { name: "Sarah" })).toBeInTheDocument();
    expect(screen.getByText(/favorite: Movie/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inception" })).toHaveAttribute("href", "/entity/3");
    expect(screen.getByText("loved it")).toBeInTheDocument();
  });

  it("shows an empty state when there are no appearances", async () => {
    mockApi({
      type: "person",
      entity: { id: 7, category: "person", title: "Newbie", createdAt: NOW, releaseYear: null, author: null },
      appearances: [],
      stats: { totalLogs: 0, favoriteCategory: null, mostFrequentCoPerson: null },
    });

    renderProfile();
    expect(await screen.findByText("No appearances yet.")).toBeInTheDocument();
  });

  it("redirects to the entity page when the id is not a person", async () => {
    mockApi({
      type: "entity",
      id: 7,
      category: "movie",
      title: "Not a person",
      createdAt: NOW,
      releaseYear: null,
      author: null,
      logs: [],
      visitCount: 0,
      averageRating: null,
      latestDate: null,
    });

    renderProfile();
    expect(await screen.findByText("entity page")).toBeInTheDocument();
  });

  const personProfile = {
    type: "person",
    entity: { id: 7, category: "person", title: "Sarah", createdAt: NOW, releaseYear: null, author: null },
    appearances: [],
    stats: { totalLogs: 0, favoriteCategory: null, mostFrequentCoPerson: null },
  };

  it("renders the person's linked photos as a grid with no delete control", async () => {
    mockApi(personProfile, [photo(2), photo(1)]);
    renderProfile();

    const thumbs = await screen.findAllByRole("img");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]).toHaveAttribute("src", "/api/photos/thumb-2.webp");

    await userEvent.click(thumbs[0]);
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Delete photo" })).not.toBeInTheDocument();
  });

  it("shows a per-person empty state when there are no linked photos", async () => {
    mockApi(personProfile, []);
    renderProfile();
    expect(await screen.findByText("No photos of Sarah yet.")).toBeInTheDocument();
  });
});
