import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { primeRepo } from "../test/mockRepo.js";
import { pendingOutbox } from "../local/outbox.js";
import { Calendar } from "./Calendar.js";
import { LogAddForm } from "./LogAddForm.js";
import type { CalendarItem } from "@logger/shared";

vi.mock("../local/repo.js");
import { repo } from "../local/repo.js";

/** Items across Dec 2023 – Mar 2024, deliberately in server sort order (date, then title). */
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

let container: HTMLElement;

function installCalendar(items: CalendarItem[] = MASTER) {
  vi.mocked(repo.getCalendarRange).mockImplementation(async (from: string, to: string) => ({
    from,
    to,
    items: items.filter((i) => i.date >= from && i.date <= to),
  }));
}

const requestedRanges = () =>
  vi.mocked(repo.getCalendarRange).mock.calls.map(([from, to]) => ({ from, to }));

function render(
  props: { initialMonth?: string; today?: string } = { initialMonth: "2024-02", today: "2024-02-15" },
  route = "/calendar",
) {
  const result = renderWithProviders(
    <Routes>
      <Route path="/calendar" element={<Calendar {...props} />} />
      <Route path="/entity/:id" element={<div>entity page</div>} />
      <Route path="/person/:id" element={<div>person page</div>} />
      <Route path="/add/:category" element={<div>add form</div>} />
    </Routes>,
    { route },
  );
  container = result.container;
  return result;
}

const cell = (iso: string) => container.querySelector<HTMLButtonElement>(`button[data-date="${iso}"]`)!;
const allDayCells = () => [...container.querySelectorAll("button[data-date]")];
const selectedHeading = () => screen.queryByRole("heading", { level: 2 });
const rangeCovers = (start: string, end: string) =>
  requestedRanges().some((r) => r.from <= start && r.to >= end);

describe("Calendar — structure", () => {
  beforeEach(() => {
    primeRepo(repo);
    installCalendar();
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
    expect(requestedRanges()).toContainEqual({ from: "2024-01-29", to: "2024-03-03" });
  });
});

describe("Calendar — items land on the right days", () => {
  beforeEach(() => {
    primeRepo(repo);
    installCalendar();
  });

  it("marks only days that have items, and never marks spillover cells", async () => {
    render();
    await screen.findByText("February 2024");
    await vi.waitFor(() =>
      expect(cell("2024-02-01").querySelector("span.rounded-full")).not.toBeNull(),
    );
    expect(cell("2024-02-14").querySelector("span.rounded-full")).not.toBeNull();
    expect(cell("2024-02-05").querySelector("span.rounded-full")).toBeNull();
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
    primeRepo(repo);
    installCalendar();
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
    await userEvent.click(cell("2024-01-30"));
    await screen.findByText("January 2024");
    expect(cell("2024-01-30")).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("link", { name: /Late Jan drinks/ })).toBeInTheDocument();
  });

  it("the day grid always renders from the month, independent of the response", async () => {
    render();
    await screen.findByText("February 2024");
    await next();
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

describe("Calendar — add-event shortcut", () => {
  beforeEach(() => {
    primeRepo(repo);
    installCalendar();
  });

  const addLinks = () =>
    screen.queryAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/add/"));

  it("toggles a chooser of the three calendar categories for the selected day", async () => {
    render();
    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-02-20"));

    expect(addLinks()).toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: /add event/i }));

    const links = addLinks();
    expect(links.map((l) => l.textContent)).toEqual(["Appointment", "Hang Out", "Eating Out"]);
    const expectedReturn = encodeURIComponent("/calendar?date=2024-02-20");
    expect(links[0]).toHaveAttribute("href", `/add/appointment?date=2024-02-20&returnTo=${expectedReturn}`);
    expect(links[1]).toHaveAttribute("href", `/add/hang_out?date=2024-02-20&returnTo=${expectedReturn}`);
    expect(links[2]).toHaveAttribute("href", `/add/eating_out?date=2024-02-20&returnTo=${expectedReturn}`);
  });

  it("offers the shortcut on an empty day too", async () => {
    render();
    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-02-06"));
    await screen.findByText("Nothing on this day.");
    await userEvent.click(screen.getByRole("button", { name: /add event/i }));
    expect(addLinks()[0]).toHaveAttribute("href", expect.stringContaining("date=2024-02-06"));
  });

  it("collapses the chooser when another day is selected", async () => {
    render();
    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-02-20"));
    await userEvent.click(screen.getByRole("button", { name: /add event/i }));
    expect(addLinks().length).toBeGreaterThan(0);

    await userEvent.click(cell("2024-02-21"));
    expect(addLinks()).toHaveLength(0);
  });

  it("navigates to the pre-filled add form when a category is picked", async () => {
    render();
    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-02-20"));
    await userEvent.click(screen.getByRole("button", { name: /add event/i }));
    await userEvent.click(screen.getByRole("link", { name: "Appointment" }));
    await screen.findByText("add form");
  });

  it("opens on a day and month passed via ?date= in the URL", async () => {
    render({ today: "2024-02-15" }, "/calendar?date=2024-05-20");
    await screen.findByText("May 2024");
    expect(cell("2024-05-20")).toHaveAttribute("aria-pressed", "true");
    expect(selectedHeading()).toHaveTextContent("20");
    expect(selectedHeading()).toHaveTextContent(/May/);
  });

  it("ignores a malformed ?date= and falls back to today's month", async () => {
    render({ today: "2024-02-15" }, "/calendar?date=2024-99-99");
    await screen.findByText("February 2024");
    expect(cell("2024-02-15")).toHaveAttribute("aria-pressed", "true");
  });

  it("starts with the chooser collapsed on the auto-selected day", async () => {
    render();
    await screen.findByText("February 2024");
    expect(selectedHeading()).toBeInTheDocument();
    expect(addLinks()).toHaveLength(0);
    expect(screen.getByRole("button", { name: /add event/i })).toHaveAttribute("aria-expanded", "false");
  });

  it("starts collapsed when opened via ?date=", async () => {
    render({ today: "2024-02-15" }, "/calendar?date=2024-05-20");
    await screen.findByText("May 2024");
    expect(addLinks()).toHaveLength(0);
  });

  it("month navigation still works after opening via ?date=", async () => {
    render({ today: "2024-02-15" }, "/calendar?date=2024-05-20");
    await screen.findByText("May 2024");

    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByText("June 2024");
    expect(selectedHeading()).toBeNull();
    expect(cell("2024-05-20")).toBeNull();
  });

  it("carries the clicked day's date when adding from a spillover cell", async () => {
    render();
    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-01-30"));
    await screen.findByText("January 2024");
    await userEvent.click(screen.getByRole("button", { name: /add event/i }));
    expect(addLinks()[0]).toHaveAttribute("href", expect.stringContaining("date=2024-01-30"));
  });

  it("re-opening the chooser on the same day still works", async () => {
    render();
    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-02-20"));
    const toggle = screen.getByRole("button", { name: /add event/i });
    await userEvent.click(toggle);
    expect(addLinks()).toHaveLength(3);
    await userEvent.click(toggle);
    expect(addLinks()).toHaveLength(0);
    await userEvent.click(toggle);
    expect(addLinks()).toHaveLength(3);
  });
});

describe("Calendar — add-and-return round trip", () => {
  const NOW = "2024-02-15";

  beforeEach(() => {
    primeRepo(repo);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("select a day → add → save → back on that calendar day with the new event", async () => {
    // The write is local-first: reflect the queued log.create back through the calendar read.
    vi.mocked(repo.getCalendarRange).mockImplementation(async (from: string, to: string) => {
      const logCreate = (await pendingOutbox()).find((e) => e.type === "log.create");
      const date = (logCreate?.payload as { date?: string } | undefined)?.date;
      const items =
        logCreate && date && date >= from && date <= to
          ? [
              {
                date,
                kind: "log" as const,
                category: "appointment" as const,
                title: "Blood test",
                notes: null,
                entityId: 1,
                entityCategory: "appointment" as const,
                logId: 1,
              },
            ]
          : [];
      return { from, to, items };
    });

    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        changes: { entities: [], logs: [], photos: [], albums: [], entityNotes: [] },
        deletions: [],
        nextCursor: "0",
        hasMore: false,
        serverTime: NOW,
      }),
    });

    const { container: c } = renderWithProviders(
      <Routes>
        <Route path="/calendar" element={<Calendar today={NOW} />} />
        <Route path="/add/:category" element={<LogAddForm category="appointment" />} />
      </Routes>,
      { route: "/calendar" },
    );
    container = c;

    await screen.findByText("February 2024");
    await userEvent.click(cell("2024-02-27"));
    await userEvent.click(screen.getByRole("button", { name: /add event/i }));
    await userEvent.click(screen.getByRole("link", { name: "Appointment" }));

    await screen.findByRole("button", { name: "Save" });
    expect(document.querySelector<HTMLInputElement>('input[type="date"]')).toHaveValue("2024-02-27");

    await userEvent.type(screen.getByLabelText("Title"), "Blood test");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("February 2024");
    expect(cell("2024-02-27")).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("link", { name: /Blood test/ })).toBeInTheDocument();

    const envs = await pendingOutbox();
    expect(envs.find((e) => e.type === "entity.create")?.payload).toMatchObject({
      category: "appointment",
      title: "Blood test",
    });
    expect(envs.find((e) => e.type === "log.create")?.payload).toMatchObject({ date: "2024-02-27" });
  });
});
