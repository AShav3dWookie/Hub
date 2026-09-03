import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { pendingOutbox } from "../local/outbox.js";
import { AlbumAddForm } from "./AlbumAddForm.js";

vi.mock("../api/afterMutation.js", () => ({
  refreshAfterMutation: (qc: { invalidateQueries: () => unknown }) => {
    void qc.invalidateQueries();
    return Promise.resolve();
  },
}));

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe("AlbumAddForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("queues an album.create and navigates to its (temp) detail page", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse([]));

    renderWithProviders(
      <Routes>
        <Route path="/add/album" element={<AlbumAddForm />} />
        <Route path="/album/:id" element={<div>album page</div>} />
      </Routes>,
      { route: "/add/album" },
    );

    await userEvent.type(screen.getByLabelText("Title"), "Italy");
    await userEvent.click(screen.getByRole("button", { name: /create album/i }));

    await screen.findByText("album page");
    const [env] = await pendingOutbox();
    expect(env).toMatchObject({ type: "album.create", payload: { title: "Italy", eventLogIds: [] } });
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
