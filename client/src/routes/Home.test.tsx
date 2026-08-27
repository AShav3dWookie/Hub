import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { Home } from "./Home.js";

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, json: async () => body };
}

describe("Home", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("/important-dates/upcoming")) {
          return Promise.resolve(
            jsonResponse({
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
            }),
          );
        }
        return Promise.resolve(jsonResponse({ groupBy: "log", logs: [] }));
      }),
    );
  });

  it("shows today's and next-7-days important date widgets above Recent activity", async () => {
    renderWithProviders(<Home />);

    await screen.findByText("Alice");
    expect(screen.getByText("Today's important dates")).toBeInTheDocument();
    expect(screen.getByText("Next 7 days")).toBeInTheDocument();
    expect(screen.getByText("Jamie")).toBeInTheDocument();
    expect(screen.getByText(/Birthday/)).toBeInTheDocument();

    const todayHeading = screen.getByText("Today's important dates");
    const next7Heading = screen.getByText("Next 7 days");
    expect(
      todayHeading.compareDocumentPosition(next7Heading) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows Add, Search, and Gallery action tiles", async () => {
    renderWithProviders(<Home />);
    await screen.findByText("What would you like to do?");

    expect(screen.getByRole("link", { name: /add/i })).toHaveAttribute("href", "/add");
    expect(screen.getByRole("link", { name: /search/i })).toHaveAttribute("href", "/search");
    expect(screen.getByRole("link", { name: /gallery/i })).toHaveAttribute("href", "/gallery");
  });

  it("does not render important date widgets when there are none", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) => {
      if (url.includes("/important-dates/upcoming")) {
        return Promise.resolve(jsonResponse({ today: [], next7Days: [] }));
      }
      return Promise.resolve(jsonResponse({ groupBy: "log", logs: [] }));
    });

    renderWithProviders(<Home />);

    await screen.findByText("What would you like to do?");
    expect(screen.queryByText("Today's important dates")).not.toBeInTheDocument();
    expect(screen.queryByText("Next 7 days")).not.toBeInTheDocument();
  });
});
