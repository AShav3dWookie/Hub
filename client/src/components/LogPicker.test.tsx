import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { primeRepo } from "../test/mockRepo.js";
import { LogPicker } from "./LogPicker.js";

vi.mock("../local/repo.js");
import { repo } from "../local/repo.js";

const NOW = "2024-05-01T00:00:00.000Z";

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
  entity: { id, category: "movie" as const, title, createdAt: NOW, releaseYear: null, author: null },
});

describe("LogPicker", () => {
  beforeEach(() => primeRepo(repo));

  it("shows nothing until a query is typed, then filters out excluded ids and calls onPick", async () => {
    vi.mocked(repo.search).mockResolvedValue({
      groupBy: "log",
      logs: [logRow(1, "Heat"), logRow(2, "Sicario")],
    });
    const onPick = vi.fn();

    renderWithProviders(<LogPicker onPick={onPick} excludeIds={[2]} />);

    expect(screen.queryByRole("button", { name: /Heat/ })).not.toBeInTheDocument();
    expect(repo.search).not.toHaveBeenCalled();

    await userEvent.type(screen.getByPlaceholderText(/find an event to add/i), "hea");

    const option = await screen.findByRole("button", { name: /Heat/ });
    expect(screen.queryByRole("button", { name: /Sicario/ })).not.toBeInTheDocument();

    await userEvent.click(option);
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("shows only the year for a year-granularity result (book)", async () => {
    vi.mocked(repo.search).mockResolvedValue({
      groupBy: "log",
      logs: [
        {
          ...logRow(1, "Dune"),
          date: "2021-01-01",
          entity: { id: 1, category: "book", title: "Dune", createdAt: NOW, releaseYear: null, author: null },
        },
      ],
    });

    renderWithProviders(<LogPicker onPick={vi.fn()} excludeIds={[]} />);
    await userEvent.type(screen.getByPlaceholderText(/find an event to add/i), "dun");

    const option = await screen.findByRole("button", { name: /Dune/ });
    expect(option).toHaveTextContent(/Book · 2021/);
    expect(option).not.toHaveTextContent("2021-01-01");
  });

  it("reports when a query matches no events", async () => {
    vi.mocked(repo.search).mockResolvedValue({ groupBy: "log", logs: [] });
    renderWithProviders(<LogPicker onPick={vi.fn()} excludeIds={[]} />);

    await userEvent.type(screen.getByPlaceholderText(/find an event to add/i), "zzz");
    expect(await screen.findByText(/no matching events/i)).toBeInTheDocument();
  });
});
