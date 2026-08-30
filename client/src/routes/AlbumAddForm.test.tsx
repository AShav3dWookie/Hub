import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { AlbumAddForm } from "./AlbumAddForm.js";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe("AlbumAddForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("creates the album and navigates to its detail page", async () => {
    const calls: Array<{ url: string; method?: string; body: unknown }> = [];
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url === "/api/albums" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ id: 12, title: "Italy" }, 201));
      }
      return Promise.resolve(jsonResponse([]));
    });

    renderWithProviders(
      <Routes>
        <Route path="/add/album" element={<AlbumAddForm />} />
        <Route path="/album/:id" element={<div>album page 12</div>} />
      </Routes>,
      { route: "/add/album" },
    );

    await userEvent.type(screen.getByLabelText("Title"), "Italy");
    await userEvent.click(screen.getByRole("button", { name: /create album/i }));

    await screen.findByText("album page 12");
    const create = calls.find((c) => c.url === "/api/albums" && c.method === "POST")!;
    expect(JSON.parse(create.body as string)).toMatchObject({ title: "Italy", eventLogIds: [] });
  });

  it("uploads picked photos in a second step against the new album id", async () => {
    const calls: Array<{ url: string; method?: string }> = [];
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      if (url === "/api/albums" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ id: 9, title: "Trip" }, 201));
      }
      if (url === "/api/albums/9/photos") return Promise.resolve(jsonResponse([], 201));
      return Promise.resolve(jsonResponse([]));
    });

    renderWithProviders(
      <Routes>
        <Route path="/add/album" element={<AlbumAddForm />} />
        <Route path="/album/:id" element={<div>album page</div>} />
      </Routes>,
      { route: "/add/album" },
    );

    await userEvent.type(screen.getByLabelText("Title"), "Trip");
    const fileInput = screen
      .getByText("Photos")
      .parentElement!.querySelector('input[type="file"]') as HTMLInputElement;
    await userEvent.upload(fileInput, new File(["x"], "p.png", { type: "image/png" }));
    await userEvent.click(screen.getByRole("button", { name: /create album/i }));

    await screen.findByText("album page");
    const createIdx = calls.findIndex((c) => c.url === "/api/albums" && c.method === "POST");
    const uploadIdx = calls.findIndex((c) => c.url === "/api/albums/9/photos");
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(uploadIdx).toBeGreaterThan(createIdx);
  });

  it("auto-fills a blank end date from the start date (and vice versa)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse([]));
    renderWithProviders(<AlbumAddForm />);

    const start = screen.getByLabelText("Start date") as HTMLInputElement;
    const end = screen.getByLabelText("End date") as HTMLInputElement;

    fireEvent.change(start, { target: { value: "2024-09-01" } });
    expect(end.value).toBe("2024-09-01");

    // an explicit end is not clobbered by a later start edit
    fireEvent.change(end, { target: { value: "2024-09-08" } });
    fireEvent.change(start, { target: { value: "2024-09-02" } });
    expect(end.value).toBe("2024-09-08");
  });

  it("blocks submit when the end date precedes the start date", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse([]));
    renderWithProviders(<AlbumAddForm />);

    await userEvent.type(screen.getByLabelText("Title"), "X");
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2024-05-10" } });
    fireEvent.change(screen.getByLabelText("End date"), { target: { value: "2024-05-01" } });
    await userEvent.click(screen.getByRole("button", { name: /create album/i }));

    await waitFor(() =>
      expect(screen.getByText(/end date must not be before the start date/i)).toBeInTheDocument(),
    );
    expect(fetch).not.toHaveBeenCalledWith("/api/albums", expect.objectContaining({ method: "POST" }));
  });
});
