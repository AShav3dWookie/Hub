import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { Home } from "./Home.js";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

const importantDates = {
  today: [
    {
      noteId: 1,
      entityId: 5,
      entityName: "Alice",
      tag: "Birthday",
      eventDate: "1990-06-15",
      nextOccurrence: "2024-06-15",
      body: "Don't forget the card!",
    },
  ],
  next7Days: [
    {
      noteId: 2,
      entityId: 6,
      entityName: "Jamie",
      tag: "Anniversary",
      eventDate: "2015-06-20",
      nextOccurrence: "2024-06-20",
      body: "",
    },
  ],
};

const emptyBuckets = { today: [], next7Days: [] };

function mockFetch(opts: { importantDates?: unknown; events?: unknown; recentLogs?: unknown[] } = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      if (url.includes("/important-dates/upcoming")) {
        return Promise.resolve(jsonResponse(opts.importantDates ?? emptyBuckets));
      }
      if (url.includes("/events/upcoming")) {
        return Promise.resolve(jsonResponse(opts.events ?? emptyBuckets));
      }
      return Promise.resolve(jsonResponse({ groupBy: "log", logs: opts.recentLogs ?? [] }));
    }),
  );
}

const NOW = "2024-05-01T00:00:00.000Z";
function recentLog(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    entityId: 3,
    rating: null,
    date: "2024-06-10",
    notes: null,
    people: [],
    photos: [],
    autoDelete: false,
    createdAt: NOW,
    updatedAt: NOW,
    entity: { id: 3, category: "movie", title: "Dune", createdAt: NOW, releaseYear: null, author: null },
    ...over,
  };
}

describe("Home", () => {
  beforeEach(() => {
    mockFetch({ importantDates });
  });

  it("shows Today and Next 7 days upcoming widgets above Recent activity", async () => {
    renderWithProviders(<Home />);

    await screen.findByText("Alice");
    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Next 7 days")).toBeInTheDocument();
    expect(screen.getByText("Jamie")).toBeInTheDocument();
    expect(screen.getByText(/Birthday/)).toBeInTheDocument();

    const todayHeading = screen.getByText("Today");
    const next7Heading = screen.getByText("Next 7 days");
    expect(
      todayHeading.compareDocumentPosition(next7Heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("merges upcoming events into the buckets alongside important dates", async () => {
    mockFetch({
      events: {
        today: [],
        next7Days: [
          {
            logId: 10,
            entityId: 20,
            entityTitle: "Bowling",
            category: "hang_out",
            date: "2024-06-19",
            notes: null,
            people: [{ id: 3, name: "Sam" }],
          },
        ],
      },
    });

    renderWithProviders(<Home />);

    const bowling = await screen.findByText("Bowling");
    expect(bowling.closest("a")).toHaveAttribute("href", "/entity/20");
    expect(screen.getByText(/Hang Out · 2024-06-19 · with Sam/)).toBeInTheDocument();
  });

  it("shows Add, Search, and Gallery action tiles", async () => {
    renderWithProviders(<Home />);
    await screen.findByText("What would you like to do?");

    expect(screen.getByRole("link", { name: /add/i })).toHaveAttribute("href", "/add");
    expect(screen.getByRole("link", { name: /search/i })).toHaveAttribute("href", "/search");
    expect(screen.getByRole("link", { name: /gallery/i })).toHaveAttribute("href", "/gallery");
  });

  it("shows a star rating for a rated recent log but not for a hang-out", async () => {
    mockFetch({
      recentLogs: [
        recentLog({ id: 1, rating: 5, entity: { id: 3, category: "movie", title: "Dune", createdAt: NOW, releaseYear: null, author: null } }),
        recentLog({
          id: 2,
          entity: { id: 4, category: "hang_out", title: "Bowling night", createdAt: NOW, releaseYear: null, author: null },
        }),
      ],
    });

    renderWithProviders(<Home />);

    const movieRow = (await screen.findByText("Dune")).closest("a")!;
    const hangOutRow = screen.getByText("Bowling night").closest("a")!;

    expect(within(movieRow).getByRole("radiogroup", { name: "Rating" })).toBeInTheDocument();
    expect(within(hangOutRow).queryByRole("radiogroup", { name: "Rating" })).not.toBeInTheDocument();
  });

  it("does not render upcoming widgets when there is nothing upcoming", async () => {
    mockFetch();

    renderWithProviders(<Home />);

    await screen.findByText("What would you like to do?");
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
    expect(screen.queryByText("Next 7 days")).not.toBeInTheDocument();
  });
});
