import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { Search } from "./Search.js";

function mockSearchResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({ groupBy: "entity", entities: [] }),
  };
}

describe("Search", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(mockSearchResponse()),
    );
  });

  it("re-fetches with the selected category filter", async () => {
    renderWithProviders(<Search />);

    await screen.findByText("No results.");
    await userEvent.click(screen.getByRole("button", { name: /Filters/ }));

    await userEvent.click(screen.getByRole("tab", { name: "Eating Out" }));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("category=eating_out"),
      expect.anything(),
    );
  });

  it("re-fetches with a keyword filter", async () => {
    renderWithProviders(<Search />);
    await screen.findByText("No results.");

    await userEvent.type(screen.getByPlaceholderText(/Keyword/), "Sarah");

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(expect.stringContaining("q=Sarah"), expect.anything()),
    );
  });

  it("switches match mode to 'any' when selected", async () => {
    renderWithProviders(<Search />);
    await screen.findByText("No results.");

    await userEvent.selectOptions(screen.getByDisplayValue("All words"), "any");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("qMode=any"),
      expect.anything(),
    );
  });

  it("renders a People section with matched people above the other results", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        groupBy: "entity",
        entities: [],
        people: [{ id: 9, name: "Dave", appearanceCount: 4 }],
      }),
    });

    renderWithProviders(<Search />);
    await userEvent.type(screen.getByPlaceholderText(/Keyword/), "Dave");

    const link = await screen.findByRole("link", { name: /Dave/ });
    expect(link).toHaveAttribute("href", "/person/9");
    expect(screen.getByText("4 logs")).toBeInTheDocument();
  });

  it("re-fetches with category=person when the Person filter is selected", async () => {
    renderWithProviders(<Search />);
    await screen.findByText("No results.");
    await userEvent.click(screen.getByRole("button", { name: /Filters/ }));

    await userEvent.click(screen.getByRole("tab", { name: "Person" }));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("category=person"),
      expect.anything(),
    );
  });

  it("renders an Albums section above the other results", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        groupBy: "entity",
        entities: [],
        albums: [{ id: 3, title: "Italy Trip", eventCount: 5 }],
      }),
    });

    renderWithProviders(<Search />);
    await userEvent.type(screen.getByPlaceholderText(/Keyword/), "Italy");

    const link = await screen.findByRole("link", { name: /Italy Trip/ });
    expect(link).toHaveAttribute("href", "/album/3");
    expect(screen.getByText("5 events")).toBeInTheDocument();
  });

  it("re-fetches with category=album and hides the rating/date filters for the Album tab", async () => {
    renderWithProviders(<Search />);
    await screen.findByText("No results.");
    await userEvent.click(screen.getByRole("button", { name: /Filters/ }));

    await userEvent.click(screen.getByRole("tab", { name: "Album" }));

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("category=album"),
      expect.anything(),
    );
    expect(screen.getByText(/Searching albums by title only/i)).toBeInTheDocument();
  });

  const NOW = "2024-05-01T00:00:00.000Z";
  const summary = (id: number, category: string, title: string) => ({
    id,
    category,
    title,
    createdAt: NOW,
    releaseYear: null,
    author: null,
  });
  const logRow = (id: number, over: Record<string, unknown> = {}) => ({
    id,
    entityId: 1,
    rating: null,
    date: "2024-06-10",
    notes: null,
    people: [],
    photos: [],
    autoDelete: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

  it("shows the rating bar only for rated categories (groupBy=entity)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        groupBy: "entity",
        entities: [
          { ...summary(1, "movie", "Dune"), logs: [logRow(1, { rating: 4 })], visitCount: 1, averageRating: 4, latestDate: "2024-06-10" },
          { ...summary(2, "hang_out", "Bowling"), logs: [logRow(2)], visitCount: 1, averageRating: null, latestDate: "2024-06-10" },
        ],
      }),
    });

    renderWithProviders(<Search />);

    const movieCard = (await screen.findByRole("link", { name: "Dune" })).closest("div")!.parentElement!;
    const hangOutCard = screen.getByRole("link", { name: "Bowling" }).closest("div")!.parentElement!;
    expect(within(movieCard).getByRole("radiogroup", { name: "Rating" })).toBeInTheDocument();
    expect(within(hangOutCard).queryByRole("radiogroup", { name: "Rating" })).not.toBeInTheDocument();
  });

  it("shows only the year for year-granularity logs, full dates otherwise (groupBy=log)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        groupBy: "log",
        logs: [
          logRow(1, { date: "2023-01-01", entity: summary(1, "book", "Dune") }),
          logRow(2, { date: "2024-06-10", entity: summary(2, "movie", "Arrival") }),
        ],
      }),
    });

    renderWithProviders(<Search />);

    const bookCard = (await screen.findByRole("link", { name: "Dune" })).closest("div")!.parentElement!;
    expect(within(bookCard).getByText(/Book · 2023$/)).toBeInTheDocument();
    expect(within(bookCard).queryByText(/2023-01-01/)).not.toBeInTheDocument();

    const movieCard = screen.getByRole("link", { name: "Arrival" }).closest("div")!.parentElement!;
    expect(within(movieCard).getByText(/Movie · 2024-06-10/)).toBeInTheDocument();
  });

  it("shows only the year for year-granularity logs (groupBy=entity)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        groupBy: "entity",
        entities: [
          {
            ...summary(1, "game", "Hades"),
            logs: [logRow(1, { date: "2022-01-01" })],
            visitCount: 1,
            averageRating: null,
            latestDate: "2022-01-01",
          },
        ],
      }),
    });

    renderWithProviders(<Search />);

    expect(await screen.findByText("2022")).toBeInTheDocument();
    expect(screen.queryByText("2022-01-01")).not.toBeInTheDocument();
  });

  it("shows the rating bar only for rated categories (groupBy=log)", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        groupBy: "log",
        logs: [
          logRow(1, { rating: 4, entity: summary(1, "movie", "Dune") }),
          logRow(2, { entity: summary(2, "hang_out", "Bowling") }),
        ],
      }),
    });

    renderWithProviders(<Search />);

    const movieCard = (await screen.findByRole("link", { name: "Dune" })).closest("div")!.parentElement!;
    const hangOutCard = screen.getByRole("link", { name: "Bowling" }).closest("div")!.parentElement!;
    expect(within(movieCard).getByRole("radiogroup", { name: "Rating" })).toBeInTheDocument();
    expect(within(hangOutCard).queryByRole("radiogroup", { name: "Rating" })).not.toBeInTheDocument();
  });
});
