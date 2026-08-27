import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { EntityDetail } from "./EntityDetail.js";
import type { Category, LogDTO, LogPhotoDTO } from "@logger/shared";

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
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function entityPayload(category: Category, logs: LogDTO[]) {
  return {
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
  };
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
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows the photo gallery for a movie log", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(entityPayload("movie", [log({ photos: [] })])),
    );

    renderDetail();

    expect(await screen.findByRole("button", { name: /add photos/i })).toBeInTheDocument();
  });

  it("renders existing photo thumbnails for an eating_out log", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse(
        entityPayload("eating_out", [
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
        ]),
      ),
    );

    renderDetail();

    expect(await screen.findByRole("img", { name: "dinner.jpg" })).toHaveAttribute(
      "src",
      "/api/photos/thumb-8.webp",
    );
  });

  it("does not show the gallery for TV / book / game logs", async () => {
    for (const category of ["tv", "book", "game"] as const) {
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse(entityPayload(category, [log()])),
      );

      const { unmount } = renderDetail();

      await screen.findByText(`A ${category}`);
      expect(screen.queryByRole("button", { name: /add photos/i })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe("EntityDetail log deletion with photos", () => {
  beforeEach(() => {
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

  function mockDelete() {
    const calls: string[] = [];
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        calls.push(url);
        return Promise.resolve(jsonResponse(undefined, 204));
      }
      return Promise.resolve(jsonResponse(entityPayload("movie", [log({ photos: [photo] })])));
    });
    return calls;
  }

  it("offers keep-vs-delete when the log has photos; 'keep' sends no query", async () => {
    const calls = mockDelete();
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: /keep photos/i }));

    expect(calls).toEqual(["/api/logs/1"]);
  });

  it("'delete log & photos' sends ?deletePhotos=true", async () => {
    const calls = mockDelete();
    renderDetail();

    await userEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await userEvent.click(screen.getByRole("button", { name: /Delete log & 1 photo/ }));

    expect(calls).toEqual(["/api/logs/1?deletePhotos=true"]);
  });
});
