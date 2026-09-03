import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { Home } from "./Home.js";
import {
  makeEntity,
  makeLog,
  makeNote,
  makePerson,
  resetFixtureCounters,
  seedLocalDb,
} from "../test/seedLocalDb.js";

const NOW = new Date("2026-06-15T12:00:00.000Z");

describe("Home", () => {
  beforeEach(() => {
    resetFixtureCounters();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Home should not hit the network"))));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function seedUpcoming() {
    const alice = makePerson("Alice");
    const jamie = makePerson("Jamie");
    await seedLocalDb({
      entities: [alice, jamie],
      notes: [
        makeNote({
          entityId: alice.id,
          category: "important_date",
          tag: "Birthday",
          eventDate: "1990-06-15",
          body: "Don't forget the card!",
        }),
        makeNote({
          entityId: jamie.id,
          category: "important_date",
          tag: "Anniversary",
          eventDate: "2015-06-20",
          body: "",
        }),
      ],
    });
  }

  it("shows Today and Next 7 days upcoming widgets", async () => {
    await seedUpcoming();
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
    await seedUpcoming();
    const bowlingEntity = makeEntity({ title: "Bowling", category: "hang_out" });
    const sam = makePerson("Sam");
    await seedLocalDb({
      entities: [bowlingEntity, sam],
      logs: [
        makeLog({
          entityId: bowlingEntity.id,
          date: "2026-06-19",
          createdAt: "2026-06-01T00:00:00.000Z",
          peopleIds: [sam.id],
        }),
      ],
    });

    renderWithProviders(<Home />);

    const bowling = await screen.findByText("Bowling");
    expect(bowling.closest("a")).toHaveAttribute("href", `/entity/${bowlingEntity.id}`);
    expect(screen.getByText(/Hang Out · 2026-06-19 · with Sam/)).toBeInTheDocument();
  });

  it("shows Add, Search, Calendar, and Gallery action tiles", async () => {
    renderWithProviders(<Home />);
    await screen.findByText("What would you like to do?");

    expect(screen.getByRole("link", { name: /add/i })).toHaveAttribute("href", "/add");
    expect(screen.getByRole("link", { name: /search/i })).toHaveAttribute("href", "/search");
    expect(screen.getByRole("link", { name: /calendar/i })).toHaveAttribute("href", "/calendar");
    expect(screen.getByRole("link", { name: /gallery/i })).toHaveAttribute("href", "/gallery");
  });

  it("does not render upcoming widgets when there is nothing upcoming", async () => {
    renderWithProviders(<Home />);

    await screen.findByText("What would you like to do?");
    expect(screen.queryByText("Today")).not.toBeInTheDocument();
    expect(screen.queryByText("Next 7 days")).not.toBeInTheDocument();
  });
});
