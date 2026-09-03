import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { primeRepo } from "../test/mockRepo.js";
import { Search } from "./Search.js";

vi.mock("../local/repo.js");
import { repo } from "../local/repo.js";
const searchMock = vi.mocked(repo.search);

describe("Search", () => {
  beforeEach(() => primeRepo(repo));

  const NOW = "2024-05-01T00:00:00.000Z";
  const summary = (id: number, category: string, title: string) => ({
    id,
    category: category as never,
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
    albums: [],
    autoDelete: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  });

  it("re-queries with the selected category filter", async () => {
    renderWithProviders(<Search />);
    await screen.findByText("No results.");
    await userEvent.click(screen.getByRole("button", { name: /Filters/ }));
    await userEvent.click(screen.getByRole("tab", { name: "Eating Out" }));

    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ category: "eating_out" }));
  });

  it("re-queries with a keyword filter", async () => {
    renderWithProviders(<Search />);
    await screen.findByText("No results.");
    await userEvent.type(screen.getByPlaceholderText(/Keyword/), "Sarah");

    await waitFor(() =>
      expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ q: "Sarah" })),
    );
  });

  it("switches match mode to 'any' when selected", async () => {
    renderWithProviders(<Search />);
    await screen.findByText("No results.");
    await userEvent.selectOptions(screen.getByDisplayValue("All words"), "any");

    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ qMode: "any" }));
  });

  it("renders a People section with matched people above the other results", async () => {
    searchMock.mockResolvedValue({
      groupBy: "entity",
      entities: [],
      people: [{ id: 9, name: "Dave", appearanceCount: 4 }],
    });

    renderWithProviders(<Search />);
    await userEvent.type(screen.getByPlaceholderText(/Keyword/), "Dave");

    const link = await screen.findByRole("link", { name: /Dave/ });
    expect(link).toHaveAttribute("href", "/person/9");
    expect(screen.getByText("4 logs")).toBeInTheDocument();
  });

  it("re-queries with category=person when the Person filter is selected", async () => {
    renderWithProviders(<Search />);
    await screen.findByText("No results.");
    await userEvent.click(screen.getByRole("button", { name: /Filters/ }));
    await userEvent.click(screen.getByRole("tab", { name: "Person" }));

    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ category: "person" }));
  });

  it("renders an Albums section above the other results", async () => {
    searchMock.mockResolvedValue({
      groupBy: "entity",
      entities: [],
      albums: [{ id: 3, title: "Italy Trip", eventCount: 5 }],
    });

    renderWithProviders(<Search />);
    await userEvent.type(screen.getByPlaceholderText(/Keyword/), "Italy");

    const link = await screen.findByRole("link", { name: /Italy Trip/ });
    expect(link).toHaveAttribute("href", "/album/3");
    expect(screen.getByText("5 events")).toBeInTheDocument();
  });

  it("re-queries with category=album and hides the rating/date filters for the Album tab", async () => {
    renderWithProviders(<Search />);
    await screen.findByText("No results.");
    await userEvent.click(screen.getByRole("button", { name: /Filters/ }));
    await userEvent.click(screen.getByRole("tab", { name: "Album" }));

    expect(searchMock).toHaveBeenCalledWith(expect.objectContaining({ category: "album" }));
    expect(screen.getByText(/Searching albums by title only/i)).toBeInTheDocument();
  });

  it("shows the rating bar only for rated categories (groupBy=entity)", async () => {
    searchMock.mockResolvedValue({
      groupBy: "entity",
      entities: [
        { ...summary(1, "movie", "Dune"), logs: [logRow(1, { rating: 4 })], visitCount: 1, averageRating: 4, latestDate: "2024-06-10" },
        { ...summary(2, "hang_out", "Bowling"), logs: [logRow(2)], visitCount: 1, averageRating: null, latestDate: "2024-06-10" },
      ],
    });

    renderWithProviders(<Search />);

    const movieCard = (await screen.findByRole("link", { name: "Dune" })).closest("div")!.parentElement!;
    const hangOutCard = screen.getByRole("link", { name: "Bowling" }).closest("div")!.parentElement!;
    expect(within(movieCard).getByRole("radiogroup", { name: "Rating" })).toBeInTheDocument();
    expect(within(hangOutCard).queryByRole("radiogroup", { name: "Rating" })).not.toBeInTheDocument();
  });

  it("shows only the year for year-granularity logs, full dates otherwise (groupBy=log)", async () => {
    searchMock.mockResolvedValue({
      groupBy: "log",
      logs: [
        { ...logRow(1, { date: "2023-01-01" }), entity: summary(1, "book", "Dune") },
        { ...logRow(2, { date: "2024-06-10" }), entity: summary(2, "movie", "Arrival") },
      ],
    });

    renderWithProviders(<Search />);

    const bookCard = (await screen.findByRole("link", { name: "Dune" })).closest("div")!.parentElement!;
    expect(within(bookCard).getByText(/Book · 2023$/)).toBeInTheDocument();
    expect(within(bookCard).queryByText(/2023-01-01/)).not.toBeInTheDocument();

    const movieCard = screen.getByRole("link", { name: "Arrival" }).closest("div")!.parentElement!;
    expect(within(movieCard).getByText(/Movie · 2024-06-10/)).toBeInTheDocument();
  });

  it("shows only the year for year-granularity logs (groupBy=entity)", async () => {
    searchMock.mockResolvedValue({
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
    });

    renderWithProviders(<Search />);

    expect(await screen.findByText("2022")).toBeInTheDocument();
    expect(screen.queryByText("2022-01-01")).not.toBeInTheDocument();
  });

  it("shows the rating bar only for rated categories (groupBy=log)", async () => {
    searchMock.mockResolvedValue({
      groupBy: "log",
      logs: [
        { ...logRow(1, { rating: 4 }), entity: summary(1, "movie", "Dune") },
        { ...logRow(2), entity: summary(2, "hang_out", "Bowling") },
      ],
    });

    renderWithProviders(<Search />);

    const movieCard = (await screen.findByRole("link", { name: "Dune" })).closest("div")!.parentElement!;
    const hangOutCard = screen.getByRole("link", { name: "Bowling" }).closest("div")!.parentElement!;
    expect(within(movieCard).getByRole("radiogroup", { name: "Rating" })).toBeInTheDocument();
    expect(within(hangOutCard).queryByRole("radiogroup", { name: "Rating" })).not.toBeInTheDocument();
  });
});
