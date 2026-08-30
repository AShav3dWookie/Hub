import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { Calendar } from "./Calendar.js";
import type { CalendarItem } from "@logger/shared";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

/** Items across Jan–Mar 2024, deliberately in server sort order (date, then title). */
const MASTER: CalendarItem[] = [
  { date: "2023-12-27", kind: "log", category: "hang_out", title: "Xmas week", notes: null, entityId: 11, entityCategory: "hang_out", logId: 8 },
  { date: "2024-01-30", kind: "log", category: "hang_out", title: "Late Jan drinks", notes: null, entityId: 1, entityCategory: "hang_out", logId: 1 },
  { date: "2024-02-01", kind: "log", category: "eating_out", title: "Feb kickoff dinner", notes: "at Padella", entityId: 2, entityCategory: "eating_out", logId: 2 },
  { date: "2024-02-14", kind: "important_date", category: "important_date", title: "Dana", notes: null, entityId: 3, entityCategory: "person", tag: "Birthday", noteId: 1 },
  { date: "2024-02-14", kind: "log", category: "appointment", title: "MOT", notes: "10am, the garage", entityId: 4, entityCategory: "appointment", logId: 3 },
  { date: "2024-02-16", kind: "important_date", category: "important_date", title: "The car", notes: null, entityId: 4, entityCategory: "appointment", tag: "Insurance renewal", noteId: 2 },
  { date: "2024-02-20", kind: "log", category: "eating_out", title: "Brunch", notes: null, entityId: 5, entityCategory: "eating_out", logId: 4 },
  { date: "2024-02-20", kind: "important_date", category: "important_date", title: "Eve", notes: null, entityId: 6, entityCategory: "person", tag: "Anniversary", noteId: 3 },
  { date: "2024-02-20", kind: "log", category: "appointment", title: "Optician", notes: null, entityId: 7, entityCategory: "appointment", logId: 5 },
  { date: "2024-02-20", kind: "log", category: "hang_out", title: "Pub quiz", notes: null, entityId: 8, entityCategory: "hang_out", logId: 6 },
  { date: "2024-02-29", kind: "important_date", category: "important_date", title: "Leapy", notes: null, entityId: 9, entityCategory: "person", tag: "Anniversary", noteId: 4 },
  { date: "2024-03-02", kind: "log", category: "hang_out", title: "Early March hike", notes: null, entityId: 10, entityCategory: "hang_out", logId: 7 },
];

let requestedRanges: Array<{ from: string; to: string }>;
let container: HTMLElement;

function installFetch() {
  requestedRanges = [];
  (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
    const params = new URL(`http://x${url}`).searchParams;
    const from = params.get("from")!;
    const to = params.get("to")!;
    requestedRanges.push({ from, to });
    return Promise.resolve(
      jsonResponse({ from, to, items: MASTER.filter((i) => i.date >= from && i.date <= to) }),
    );
  });
}

function render(
  props: { initialMonth?: string; today?: string } = { initialMonth: "2024-02", today: "2024-02-15" },
) {
  const result = renderWithProviders(
    <Routes>
      <Route path="/calendar" element={<Calendar {...props} />} />
      <Route path="/entity/:id" element={<div>entity page</div>} />
      <Route path="/person/:id" element={<div>person page</div>} />
    </Routes>,
    { route: "/calendar" },
  );
  container = result.container;
  return result;
}

/** A day cell keyed by ISO date — locale-proof (the label renders as en-GB or en-US). */
const cell = (iso: string) => container.querySelector<HTMLButtonElement>(`button[data-date="${iso}"]`)!;
const allDayCells = () => [...container.querySelectorAll("button[data-date]")];
const selectedHeading = () => screen.queryByRole("heading", { level: 2 });
const rangeCovers = (start: string, end: string) =>
  requestedRanges.some((r) => r.from <= start && r.to >= end);

describe("Calendar — structure", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    installFetch();
  });

  it("renders Monday-first weekday headers in order", async () => {
    render();
    await screen.findByText("February 2024");
    expect(screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/).map((n) => n.textContent)).toEqual([
      "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    ]);
  });

  it("renders every day of the month plus the exact adjacent-month spillover", async () => {
    render();
    await screen.findByText("February 2024");
    // Feb 2024 (leap, 29 days) starts Thursday → 3 leading (Jan 29-31), 3 trailing (Mar 1-3) = 35 cells
    for (const iso of ["2024-02-01", "2024-02-15", "2024-02-29", "2024-01-29", "2024-01-31", "2024-03-01", "2024-03-03"]) {
      expect(cell(iso)).not.toBeNull();
    }
    expect(cell("2024-01-28")).toBeNull();
    expect(cell("2024-03-04")).toBeNull();
    expect(allDayCells()).toHaveLength(35);
  });

  it("auto-selects today when it is in the initial month", async () => {
    render();
    await screen.findByText("February 2024");
    expect(cell("2024-02-15")).toHaveAttribute("aria-pressed", "true");
    expect(selectedHeading()).toHaveTextContent("15");
    expect(selectedHeading()).toHaveTextContent(/February/);
  });

  it("selects no day when today is outside the initial month", async () => {
    render({ initialMonth: "2024-05", today: "2024-02-15" });
    await screen.findByText("May 2024");
    expect(selectedHeading()).toBeNull();
    expect(screen.queryByText("Nothing on this day.")).not.toBeInTheDocument();
    allDayCells().forEach((c) => expect(c).toHaveAttribute("aria-pressed", "false"));
  });

  it("fetches exactly the visible grid range", async () => {
    render();
    await screen.findByText("February 2024");
    expect(requestedRanges).toContainEqual({ from: "2024-01-29", to: "2024-03-03" });
  });
});

describe("Calendar — items land on the right days", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    installFetch();
  });

  it("marks only days that have items, and never marks spillover cells", async () => {
    render();
    await screen.findByText("February 2024");
    await vi.waitFor(() =>
      expect(cell("2024-02-01").querySelector("span.rounded-full")).not.toBeNull(),
    );
    expect(cell("2024-02-14").querySelector("span.rounded-full")).not.toBeNull();
    expect(cell("2024-02-05").querySelector("span.rounded-full")).toBeNull();
    // Jan 30 has an item but it's a spillover cell in the Feb grid — no marker
    expect(cell("2024-01-30").querySelector("span.rounded-full")).toBeNull();
  });

  it("caps the day markers at three dots with a +N overflow", async () => {
    render();
    await screen.findByText("February 2024");
    await vi.waitFor(() =>
      expect(cell("2024-02-20").querySelectorAll("span.rounded-full")).toHaveLength(3),
    );
    expect(within(cell("2024-02-20")).getByText("+1")).toBeInTheDocument();
  });

  it("opens a day's single item with badge, notes and link", async () => {
    render();
    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-02-01"));

    const link = await screen.findByRole("link", { name: /Feb kickoff dinner/ });
    expect(link).toHaveAttribute("href", "/entity/2");
    expect(within(link).getByText(/Eating Out/)).toBeInTheDocument();
    expect(within(link).getByText("at Padella")).toBeInTheDocument();
  });

  it("lists every item on a busy day in the order the API returned them", async () => {
    render();
    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-02-14"));

    const links = await screen.findAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual([
      expect.stringContaining("Dana"),
      expect.stringContaining("MOT"),
    ]);
    expect(links[0]).toHaveAttribute("href", "/person/3");
    expect(links[1]).toHaveAttribute("href", "/entity/4");
    expect(within(links[0]).getByText(/Birthday · Important date/)).toBeInTheDocument();
    expect(within(links[1]).getByText(/10am, the garage/)).toBeInTheDocument();
  });

  it("links an important date on a non-person entity to /entity/:id", async () => {
    render();
    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-02-16"));
    const link = await screen.findByRole("link", { name: /The car/ });
    expect(link).toHaveAttribute("href", "/entity/4");
    expect(within(link).getByText(/Insurance renewal · Important date/)).toBeInTheDocument();
  });

  it("places the leap day and its item", async () => {
    render();
    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-02-29"));
    expect(await screen.findByRole("link", { name: /Leapy/ })).toBeInTheDocument();
  });

  it("says nothing is on an empty day", async () => {
    render();
    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-02-06"));
    expect(await screen.findByText("Nothing on this day.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("moves the selection and panel as different days are clicked", async () => {
    render();
    await screen.findByText("February 2024");

    await userEvent.click(cell("2024-02-01"));
    expect(cell("2024-02-01")).toHaveAttribute("aria-pressed", "true");
    expect(cell("2024-02-15")).toHaveAttribute("aria-pressed", "false");
    await screen.findByRole("link", { name: /Feb kickoff dinner/ });

    await userEvent.click(cell("2024-02-20"));
    expect(cell("2024-02-01")).toHaveAttribute("aria-pressed", "false");
    expect(cell("2024-02-20")).toHaveAttribute("aria-pressed", "true");
    expect((await screen.findAllByRole("link")).length).toBe(4);
  });
});

describe("Calendar — navigation", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    installFetch();
  });

  const next = () => userEvent.click(screen.getByRole("button", { name: "Next month" }));
  const prev = () => userEvent.click(screen.getByRole("button", { name: "Previous month" }));

  it("steps forward and back a month, refetching each time", async () => {
    render();
    await screen.findByText("February 2024");

    await next();
    await screen.findByText("March 2024");
    expect(rangeCovers("2024-03-01", "2024-03-31")).toBe(true);

    await prev();
    await screen.findByText("February 2024");

    await prev();
    await screen.findByText("January 2024");
    expect(rangeCovers("2024-01-01", "2024-01-31")).toBe(true);
  });

  it("crosses the year boundary in both directions", async () => {
    render({ initialMonth: "2024-01", today: "2024-06-01" });
    await screen.findByText("January 2024");

    await prev();
    await screen.findByText("December 2023");
    expect(rangeCovers("2023-12-01", "2023-12-31")).toBe(true);

    await next();
    await screen.findByText("January 2024");
  });

  it("wraps December → January of the next year", async () => {
    render({ initialMonth: "2024-12", today: "2024-06-01" });
    await screen.findByText("December 2024");
    await next();
    await screen.findByText("January 2025");
  });

  it("clears the day selection when navigating away from the month holding today", async () => {
    render();
    await screen.findByText("February 2024");
    expect(selectedHeading()).toHaveTextContent("15");

    await next();
    await screen.findByText("March 2024");
    expect(selectedHeading()).toBeNull();
  });

  it("shows the newly-visible month's events after navigating", async () => {
    render();
    await screen.findByText("February 2024");
    await next();
    await screen.findByText("March 2024");

    await userEvent.click(cell("2024-03-02"));
    expect(await screen.findByRole("link", { name: /Early March hike/ })).toBeInTheDocument();
  });

  it("the Today button returns to the current month and re-selects today", async () => {
    render();
    await screen.findByText("February 2024");
    await next();
    await next();
    await screen.findByText("April 2024");

    await userEvent.click(screen.getByRole("button", { name: "Today" }));
    await screen.findByText("February 2024");
    expect(cell("2024-02-15")).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking a spillover day jumps to its month and selects it", async () => {
    render();
    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-01-30")); // leading spillover
    await screen.findByText("January 2024");
    expect(cell("2024-01-30")).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("link", { name: /Late Jan drinks/ })).toBeInTheDocument();
  });

  it("the day grid always renders from the month, independent of the response", async () => {
    render();
    await screen.findByText("February 2024");
    await next();
    // keepPreviousData + the grid coming from `month` means cells never vanish mid-fetch
    expect(allDayCells().length).toBeGreaterThan(27);
    await screen.findByText("March 2024");
    expect(allDayCells().length).toBeGreaterThan(27);
  });

  it("day cells are keyboard-operable", async () => {
    render();
    await screen.findByText("February 2024");
    cell("2024-02-01").focus();
    await userEvent.keyboard("{Enter}");
    expect(cell("2024-02-01")).toHaveAttribute("aria-pressed", "true");
  });
});
