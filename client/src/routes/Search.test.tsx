import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
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

    await userEvent.selectOptions(screen.getByDisplayValue("All categories"), "restaurant");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("category=restaurant"),
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

    await userEvent.selectOptions(screen.getByDisplayValue("All categories"), "person");

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("category=person"),
      expect.anything(),
    );
  });
});
