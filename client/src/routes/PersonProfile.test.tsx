import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { primeRepo } from "../test/mockRepo.js";
import { PersonProfile } from "./PersonProfile.js";
import type { GalleryPhotoDTO } from "@logger/shared";

vi.mock("../local/repo.js");
import { repo } from "../local/repo.js";

const NOW = "2024-05-01T00:00:00.000Z";

function photo(id: number): GalleryPhotoDTO {
  return {
    id,
    logId: 3,
    kind: "photo",
    url: `/api/photos/full-${id}.jpg`,
    thumbnailUrl: `/api/photos/thumb-${id}.webp`,
    originalName: `photo-${id}.jpg`,
    createdAt: NOW,
    log: { id: 3, entityId: 3, entityTitle: "Inception", category: "movie", date: "2024-01-01" },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function setProfile(profile: any, photos: GalleryPhotoDTO[] = []) {
  vi.mocked(repo.getEntityDetail).mockResolvedValue(profile);
  vi.mocked(repo.getGallery).mockResolvedValue({ photos, nextCursor: null });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
  beforeEach(() => primeRepo(repo));

  it("renders stats and appearances", async () => {
    setProfile({
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
          albums: [],
          autoDelete: false,
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
    expect(screen.getByRole("radiogroup", { name: "Rating" })).toBeInTheDocument();
  });

  it("does not show a rating bar for a non-rated appearance (hang-out)", async () => {
    setProfile({
      type: "person",
      entity: { id: 7, category: "person", title: "Sarah", createdAt: NOW, releaseYear: null, author: null },
      appearances: [
        {
          id: 1,
          entityId: 4,
          rating: null,
          date: "2024-02-02",
          notes: null,
          people: [],
          photos: [],
          albums: [],
          autoDelete: false,
          createdAt: NOW,
          updatedAt: NOW,
          entity: { id: 4, category: "hang_out", title: "Bowling night", createdAt: NOW, releaseYear: null, author: null },
        },
      ],
      stats: { totalLogs: 1, favoriteCategory: "hang_out", mostFrequentCoPerson: null },
    });

    renderProfile();

    expect(await screen.findByRole("link", { name: "Bowling night" })).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: "Rating" })).not.toBeInTheDocument();
  });

  it("shows only the year for a year-granularity appearance (book)", async () => {
    setProfile({
      type: "person",
      entity: { id: 7, category: "person", title: "Sarah", createdAt: NOW, releaseYear: null, author: null },
      appearances: [
        {
          id: 1,
          entityId: 3,
          rating: 4,
          date: "2023-01-01",
          notes: null,
          people: [],
          photos: [],
          albums: [],
          autoDelete: false,
          createdAt: NOW,
          updatedAt: NOW,
          entity: { id: 3, category: "book", title: "Dune", createdAt: NOW, releaseYear: null, author: null },
        },
      ],
      stats: { totalLogs: 1, favoriteCategory: "book", mostFrequentCoPerson: null },
    });

    renderProfile();

    expect(await screen.findByText(/Book · 2023$/)).toBeInTheDocument();
    expect(screen.queryByText(/2023-01-01/)).not.toBeInTheDocument();
  });

  it("shows an empty state when there are no appearances", async () => {
    setProfile({
      type: "person",
      entity: { id: 7, category: "person", title: "Newbie", createdAt: NOW, releaseYear: null, author: null },
      appearances: [],
      stats: { totalLogs: 0, favoriteCategory: null, mostFrequentCoPerson: null },
    });

    renderProfile();
    expect(await screen.findByText("No appearances yet.")).toBeInTheDocument();
  });

  it("redirects to the entity page when the id is not a person", async () => {
    setProfile({
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
    type: "person" as const,
    entity: { id: 7, category: "person" as const, title: "Sarah", createdAt: NOW, releaseYear: null, author: null },
    appearances: [],
    stats: { totalLogs: 0, favoriteCategory: null, mostFrequentCoPerson: null },
  };

  it("renders the person's linked photos as a grid with no delete control", async () => {
    setProfile(personProfile, [photo(2), photo(1)]);
    renderProfile();

    const thumbs = await screen.findAllByRole("img");
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]).toHaveAttribute("src", "/api/photos/thumb-2.webp");

    await userEvent.click(thumbs[0]);
    await screen.findByRole("dialog");
    expect(screen.queryByRole("button", { name: "Delete photo" })).not.toBeInTheDocument();
  });

  it("shows a per-person empty state when there are no linked photos", async () => {
    setProfile(personProfile, []);
    renderProfile();
    expect(await screen.findByText("No photos of Sarah yet.")).toBeInTheDocument();
  });
});
