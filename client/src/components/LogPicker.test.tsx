import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { LogPicker } from "./LogPicker.js";

const NOW = "2024-05-01T00:00:00.000Z";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const logRow = (id: number, title: string) => ({
  id,
  entityId: id,
  rating: null,
  date: "2024-06-10",
  notes: null,
  people: [],
  photos: [],
  albums: [],
  autoDelete: false,
  createdAt: NOW,
  updatedAt: NOW,
  entity: { id, category: "movie", title, createdAt: NOW, releaseYear: null, author: null },
});

describe("LogPicker", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows nothing until a query is typed, then filters out excluded ids and calls onPick", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ groupBy: "log", logs: [logRow(1, "Heat"), logRow(2, "Sicario")] }),
    );
    const onPick = vi.fn();

    renderWithProviders(<LogPicker onPick={onPick} excludeIds={[2]} />);

    // nothing rendered before typing
    expect(screen.queryByRole("button", { name: /Heat/ })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText(/find an event to add/i), "hea");

    const option = await screen.findByRole("button", { name: /Heat/ });
    // excluded id 2 (Sicario) is filtered out
    expect(screen.queryByRole("button", { name: /Sicario/ })).not.toBeInTheDocument();

    await userEvent.click(option);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("shows only the year for a year-granularity result (book)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({
        groupBy: "log",
        logs: [
          {
            ...logRow(1, "Dune"),
            date: "2021-01-01",
            entity: { id: 1, category: "book", title: "Dune", createdAt: NOW, releaseYear: null, author: null },
          },
        ],
      }),
    );

    renderWithProviders(<LogPicker onPick={vi.fn()} excludeIds={[]} />);
    await userEvent.type(screen.getByPlaceholderText(/find an event to add/i), "dun");

    const option = await screen.findByRole("button", { name: /Dune/ });
    expect(option).toHaveTextContent(/Book · 2021/);
    expect(option).not.toHaveTextContent("2021-01-01");
  });

  it("reports when a query matches no events", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ groupBy: "log", logs: [] }));
    renderWithProviders(<LogPicker onPick={vi.fn()} excludeIds={[]} />);

    await userEvent.type(screen.getByPlaceholderText(/find an event to add/i), "zzz");
    expect(await screen.findByText(/no matching events/i)).toBeInTheDocument();
  });
});
