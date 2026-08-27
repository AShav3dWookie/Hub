import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { LogAddForm } from "./LogAddForm.js";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe("LogAddForm photos", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows the photo picker for a movie but not for a book", () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse([]));

    const { unmount } = renderWithProviders(<LogAddForm category="movie" />);
    expect(screen.getByText("Photos")).toBeInTheDocument();
    unmount();

    renderWithProviders(<LogAddForm category="book" />);
    expect(screen.queryByText("Photos")).not.toBeInTheDocument();
  });

  it("creates the log first, then uploads photos against the returned id", async () => {
    const calls: Array<{ url: string; method?: string; body: unknown }> = [];
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body });
      if (url === "/api/logs" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ id: 42, entityId: 1, photos: [] }, 201));
      }
      if (url === "/api/logs/42/photos") {
        return Promise.resolve(jsonResponse([], 201));
      }
      return Promise.resolve(jsonResponse([])); // autocomplete
    });

    renderWithProviders(<LogAddForm category="movie" />);

    await userEvent.type(screen.getByLabelText("Title"), "Sicario");
    await userEvent.upload(
      screen.getByText("Photos").parentElement!.querySelector("input[type=file]")!,
      new File(["x"], "poster.png", { type: "image/png" }),
    );
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(calls.some((c) => c.url === "/api/logs/42/photos")).toBe(true);
    });

    const createIdx = calls.findIndex((c) => c.url === "/api/logs" && c.method === "POST");
    const uploadIdx = calls.findIndex((c) => c.url === "/api/logs/42/photos");
    expect(createIdx).toBeGreaterThanOrEqual(0);
    expect(uploadIdx).toBeGreaterThan(createIdx);
    expect(calls[uploadIdx].body).toBeInstanceOf(FormData);
  });
});
