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

describe("LogAddForm event categories", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse([]));
  });

  it("appointment: Title/Date/Notes + auto-delete, no rating/people/photos", () => {
    renderWithProviders(<LogAddForm category="appointment" />);

    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Auto-delete once it's passed")).toBeInTheDocument();

    expect(screen.queryByText("Rating")).not.toBeInTheDocument();
    expect(screen.queryByText("People")).not.toBeInTheDocument();
    expect(screen.queryByText("Photos")).not.toBeInTheDocument();

    // Defaults to checked.
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("sends autoDelete when creating an appointment", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body });
      if (url === "/api/logs" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ id: 7, entityId: 1, photos: [] }, 201));
      }
      return Promise.resolve(jsonResponse([]));
    });

    renderWithProviders(<LogAddForm category="appointment" />);
    await userEvent.type(screen.getByLabelText("Title"), "Dentist");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(calls.some((c) => c.url === "/api/logs")).toBe(true);
    });
    const create = calls.find((c) => c.url === "/api/logs")!;
    expect(JSON.parse(create.body as string)).toMatchObject({
      category: "appointment",
      title: "Dentist",
      autoDelete: true,
      rating: null,
    });
  });

  it("hang out: people + photos, no rating", () => {
    renderWithProviders(<LogAddForm category="hang_out" />);
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("Photos")).toBeInTheDocument();
    expect(screen.queryByText("Rating")).not.toBeInTheDocument();
    expect(screen.queryByText("Auto-delete once it's passed")).not.toBeInTheDocument();
  });
});
