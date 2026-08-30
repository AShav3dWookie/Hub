import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { Calendar } from "./Calendar.js";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

const augustItems = {
  from: "2020-07-27",
  to: "2020-08-30",
  items: [
    {
      date: "2020-08-12",
      kind: "log",
      category: "hang_out",
      title: "Bowling",
      notes: "7pm start",
      entityId: 20,
      entityCategory: "hang_out",
      logId: 5,
    },
    {
      date: "2020-08-20",
      kind: "important_date",
      category: "important_date",
      title: "Alice",
      notes: null,
      entityId: 9,
      entityCategory: "person",
      tag: "Birthday",
      noteId: 3,
    },
  ],
};

function mockFetch(byUrl: (url: string) => unknown = () => augustItems) {
  (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) =>
    Promise.resolve(jsonResponse(byUrl(url))),
  );
}

function render() {
  return renderWithProviders(
    <Routes>
      <Route path="/calendar" element={<Calendar initialMonth="2020-08" today="2020-08-15" />} />
      <Route path="/entity/:id" element={<div>entity page</div>} />
      <Route path="/person/:id" element={<div>person page</div>} />
    </Routes>,
    { route: "/calendar" },
  );
}

describe("Calendar", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mockFetch();
  });

  it("renders a Monday-first grid for the given month", async () => {
    render();
    await screen.findByText("August 2020");
    const headers = screen.getAllByText(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
    expect(headers[0]).toHaveTextContent("Mon");
    // August 2020 has 31 days; grid cells are buttons labelled with a full day label
    expect(screen.getByRole("button", { name: /\b1 August 2020/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /\b31 August 2020/ })).toBeInTheDocument();
  });

  it("fetches the whole visible grid range for the month", async () => {
    render();
    await screen.findByText("August 2020");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/calendar\?from=2020-07-\d\d&to=2020-0[89]-\d\d/),
      expect.anything(),
    );
  });

  it("shows the selected day's items with links to the right pages", async () => {
    render();
    await screen.findByText("August 2020");

    // today (2020-08-15) is auto-selected but has no items
    expect(screen.getByText("Nothing on this day.")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /12 August 2020/ }));
    const bowling = await screen.findByRole("link", { name: /Bowling/ });
    expect(bowling).toHaveAttribute("href", "/entity/20");
    expect(screen.getByText("7pm start")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /20 August 2020/ }));
    const alice = await screen.findByRole("link", { name: /Alice/ });
    expect(alice).toHaveAttribute("href", "/person/9");
    expect(within(alice).getByText(/Birthday/)).toBeInTheDocument();
  });

  it("navigates months and refetches", async () => {
    mockFetch((url) =>
      url.includes("from=2020-08")
        ? augustItems
        : { from: "x", to: "y", items: [] },
    );
    render();
    await screen.findByText("August 2020");

    await userEvent.click(screen.getByRole("button", { name: "Next month" }));
    await screen.findByText("September 2020");
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/from=2020-0[89]-\d\d&to=2020-(09|10)-\d\d/),
      expect.anything(),
    );

    await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
    await screen.findByText("August 2020");
  });

  it("clicking a spillover day switches to that month", async () => {
    render();
    await screen.findByText("August 2020");
    // The grid's first row spills into late July 2020 (Aug 1 2020 is a Saturday).
    await userEvent.click(screen.getByRole("button", { name: /\b27 July 2020/ }));
    await screen.findByText("July 2020");
  });
});
