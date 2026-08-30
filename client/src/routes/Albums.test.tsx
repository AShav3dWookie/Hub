import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { Albums } from "./Albums.js";

const NOW = "2024-05-01T00:00:00.000Z";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

function render() {
  return renderWithProviders(
    <Routes>
      <Route path="/albums" element={<Albums />} />
    </Routes>,
    { route: "/albums" },
  );
}

describe("Albums index", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("lists albums with their counts and links to each", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse([
        {
          id: 5,
          title: "Italy 2024",
          notes: null,
          dateStart: "2024-06-01",
          dateEnd: "2024-06-07",
          createdAt: NOW,
          updatedAt: NOW,
          eventCount: 3,
          photoCount: 12,
        },
      ]),
    );

    render();

    const link = await screen.findByRole("link", { name: /Italy 2024/ });
    expect(link).toHaveAttribute("href", "/album/5");
    expect(screen.getByText("2024-06-01 – 2024-06-07")).toBeInTheDocument();
    expect(screen.getByText("3 events · 12 photos")).toBeInTheDocument();
  });

  it("shows an empty state when there are no albums", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse([]));
    render();
    expect(await screen.findByText(/no albums yet/i)).toBeInTheDocument();
  });
});
