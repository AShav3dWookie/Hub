import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route, useSearchParams } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { pendingOutbox } from "../local/outbox.js";
import { LogAddForm } from "./LogAddForm.js";

vi.mock("../api/afterMutation.js", () => ({
  refreshAfterMutation: (qc: { invalidateQueries: () => unknown }) => {
    void qc.invalidateQueries();
    return Promise.resolve();
  },
}));

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

/** The payload of the queued `log.create` envelope (its inline entity is a separate envelope). */
async function queuedLogCreate() {
  const envs = await pendingOutbox();
  const log = envs.find((e) => e.type === "log.create");
  return { envs, log, payload: log?.payload as Record<string, unknown> | undefined };
}

const dateInput = () => document.querySelector<HTMLInputElement>('input[type="date"]')!;

describe("LogAddForm photos", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows the photo picker for a movie but not for a book", () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse([]));

    const { unmount } = renderWithProviders(<LogAddForm category="movie" />);
    expect(screen.getByText("Photos & videos")).toBeInTheDocument();
    unmount();

    renderWithProviders(<LogAddForm category="book" />);
    expect(screen.queryByText("Photos & videos")).not.toBeInTheDocument();
  });

  it("queues an entity.create + log.create for a new-title movie", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse([]));

    renderWithProviders(<LogAddForm category="movie" />);

    await userEvent.type(screen.getByLabelText("Title"), "Sicario");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(async () => expect((await pendingOutbox()).length).toBeGreaterThanOrEqual(2));
    const { envs, payload } = await queuedLogCreate();
    expect(envs.map((e) => e.type)).toEqual(["entity.create", "log.create"]);
    expect(envs[0].payload).toMatchObject({ category: "movie", title: "Sicario" });
    expect(payload).toMatchObject({ entityId: envs[0].tempId, rating: null });
  });
});

describe("LogAddForm event categories", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse([]));
  });

  it("appointment: Title/Date/Notes + auto-delete, no rating/people/photos", () => {
    renderWithProviders(<LogAddForm category="appointment" />);

    expect(screen.getByLabelText("Title")).toBeInTheDocument();
    expect(screen.getByText("Date")).toBeInTheDocument();
    expect(screen.getByText("Notes")).toBeInTheDocument();
    expect(screen.getByText("Auto-delete once it's passed")).toBeInTheDocument();

    expect(screen.queryByText("Rating")).not.toBeInTheDocument();
    expect(screen.queryByText("People")).not.toBeInTheDocument();
    expect(screen.queryByText("Photos")).not.toBeInTheDocument();

    // Defaults to checked.
    expect(screen.getByRole("checkbox")).toBeChecked();
  });

  it("queues autoDelete when creating an appointment", async () => {
    renderWithProviders(<LogAddForm category="appointment" />);
    await userEvent.type(screen.getByLabelText("Title"), "Dentist");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(async () => expect((await queuedLogCreate()).log).toBeDefined());
    const { envs, payload } = await queuedLogCreate();
    expect(envs[0].payload).toMatchObject({ category: "appointment", title: "Dentist" });
    expect(payload).toMatchObject({ autoDelete: true, rating: null });
  });

  it("hang out: people + photos, no rating", () => {
    renderWithProviders(<LogAddForm category="hang_out" />);
    expect(screen.getByText("People")).toBeInTheDocument();
    expect(screen.getByText("Photos & videos")).toBeInTheDocument();
    expect(screen.queryByText("Rating")).not.toBeInTheDocument();
    expect(screen.queryByText("Auto-delete once it's passed")).not.toBeInTheDocument();
  });
});

describe("LogAddForm ?date / ?returnTo (calendar shortcut)", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string, init?: RequestInit) => {
      if (url === "/api/logs" && init?.method === "POST") {
        return Promise.resolve(jsonResponse({ id: 5, entityId: 1, photos: [] }, 201));
      }
      return Promise.resolve(jsonResponse([]));
    });
  });

  it("pre-fills the date field from ?date=", () => {
    renderWithProviders(<LogAddForm category="appointment" />, {
      route: "/add/appointment?date=2024-02-20",
    });
    expect(dateInput()).toHaveValue("2024-02-20");
  });

  it("defaults the date to today when there is no ?date=", () => {
    renderWithProviders(<LogAddForm category="appointment" />);
    expect(dateInput()).toHaveValue(new Date().toISOString().slice(0, 10));
  });

  it("ignores ?date= for a year-granularity category", () => {
    renderWithProviders(<LogAddForm category="book" />, { route: "/add/book?date=2024-02-20" });
    expect(screen.queryByText("Date")).not.toBeInTheDocument();
    expect(screen.getByRole("spinbutton")).toHaveValue(new Date().getFullYear());
  });

  it("returns to the ?returnTo path after saving", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/add/:category" element={<LogAddForm category="appointment" />} />
        <Route path="/calendar" element={<div>calendar screen</div>} />
      </Routes>,
      { route: "/add/appointment?date=2024-02-20&returnTo=%2Fcalendar%3Fdate%3D2024-02-20" },
    );

    await userEvent.type(screen.getByLabelText("Title"), "Dentist");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("calendar screen");
  });

  it.each(["hang_out", "eating_out"] as const)("pre-fills the date for %s too", (category) => {
    renderWithProviders(<LogAddForm category={category} />, {
      route: `/add/${category}?date=2024-02-20`,
    });
    expect(dateInput()).toHaveValue("2024-02-20");
  });

  it("queues the pre-filled date in the create payload", async () => {
    renderWithProviders(<LogAddForm category="appointment" />, {
      route: "/add/appointment?date=2025-11-03",
    });
    await userEvent.type(screen.getByLabelText("Title"), "Flu jab");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(async () => expect((await queuedLogCreate()).log).toBeDefined());
    expect((await queuedLogCreate()).payload).toMatchObject({ date: "2025-11-03" });
  });

  it("still lets the user change the pre-filled date, and queues the edited value", async () => {
    renderWithProviders(<LogAddForm category="appointment" />, {
      route: "/add/appointment?date=2025-11-03",
    });
    fireEvent.change(dateInput(), { target: { value: "2025-11-10" } });
    await userEvent.type(screen.getByLabelText("Title"), "Dentist");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(async () => expect((await queuedLogCreate()).log).toBeDefined());
    expect((await queuedLogCreate()).payload).toMatchObject({ date: "2025-11-10" });
  });

  it("goes home on save when there is a ?date= but no ?returnTo", async () => {
    renderWithProviders(
      <Routes>
        <Route path="/add/:category" element={<LogAddForm category="appointment" />} />
        <Route path="/" element={<div>home screen</div>} />
      </Routes>,
      { route: "/add/appointment?date=2024-02-20" },
    );
    await userEvent.type(screen.getByLabelText("Title"), "Dentist");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("home screen");
  });

  it.each([
    ["off-site https", "https://evil.example"],
    ["protocol-relative", "//evil.example"],
    ["bare path", "calendar"],
  ])("rejects a %s returnTo and goes home instead", async (_label, returnTo) => {
    renderWithProviders(
      <Routes>
        <Route path="/add/:category" element={<LogAddForm category="appointment" />} />
        <Route path="/" element={<div>home screen</div>} />
        <Route path="/calendar" element={<div>calendar screen</div>} />
      </Routes>,
      { route: `/add/appointment?returnTo=${encodeURIComponent(returnTo)}` },
    );

    await userEvent.type(screen.getByLabelText("Title"), "Dentist");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("home screen");
  });

  it("returns to the calendar with the date query param intact", async () => {
    function CalendarStub() {
      const [params] = useSearchParams();
      return <div>calendar on {params.get("date")}</div>;
    }
    renderWithProviders(
      <Routes>
        <Route path="/add/:category" element={<LogAddForm category="appointment" />} />
        <Route path="/calendar" element={<CalendarStub />} />
      </Routes>,
      { route: "/add/appointment?date=2026-10-15&returnTo=%2Fcalendar%3Fdate%3D2026-10-15" },
    );

    await userEvent.type(screen.getByLabelText("Title"), "Flu jab");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await screen.findByText("calendar on 2026-10-15");
  });
});
