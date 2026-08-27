import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { PersonProfile } from "./PersonProfile.js";

const NOW = "2024-05-01T00:00:00.000Z";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

/** Serve /entities/:id (the person profile) and /entities/:id/notes (empty). */
function mockApi(profile: unknown) {
  (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    if (url.endsWith("/notes")) return Promise.resolve(jsonResponse([]));
    return Promise.resolve(jsonResponse(profile));
  });
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
});
