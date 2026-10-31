import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { makeList, makeListItem, resetFixtureCounters, seedLocalDb } from "../test/seedLocalDb.js";
import { pendingOutbox } from "../local/outbox.js";
import { Shopping } from "./Shopping.js";

vi.mock("../api/afterMutation.js", () => ({
  refreshAfterMutation: (qc: { invalidateQueries: () => unknown }) => {
    void qc.invalidateQueries();
    return Promise.resolve();
  },
}));

function render() {
  return renderWithProviders(
    <Routes>
      <Route path="/shopping" element={<Shopping />} />
    </Routes>,
    { route: "/shopping" },
  );
}

const row = (name: string) => screen.getByRole("link", { name: new RegExp(name) }).closest("li")!;

describe("Shopping lists screen", () => {
  beforeEach(async () => {
    resetFixtureCounters();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const main = makeList({ name: "Shopping", isDefault: true });
    const tesco = makeList({ name: "Tesco" });
    await seedLocalDb({
      lists: [tesco, main, makeList({ name: "Aldi" })],
      listItems: [
        makeListItem({ listId: tesco.id, text: "Eggs" }),
        makeListItem({ listId: tesco.id, text: "Milk" }),
      ],
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the main list first, then the rest by name, with item counts", async () => {
    render();
    await screen.findByRole("link", { name: /Tesco/ });

    const names = screen.getAllByRole("link").map((l) => l.textContent);
    expect(names).toEqual(["ShoppingMainEmpty", "AldiEmpty", "Tesco2 items"]);
  });

  it("links each list to its page", async () => {
    render();
    const link = await screen.findByRole("link", { name: /Tesco/ });
    expect(link.getAttribute("href")).toMatch(/^\/shopping\/\d+$/);
  });

  it("adds several items to a list from its + without opening it", async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Add to Aldi" }));

    const field = screen.getByRole("textbox", { name: "Add an item to Aldi" });
    expect(field).toHaveFocus();
    await user.type(field, "Bread{Enter}");
    await user.type(field, "Butter{Enter}");

    expect(await within(row("Aldi")).findByText("2 items")).toBeInTheDocument();
    expect(field).toHaveValue("");
    // Queued for the server too, so it isn't lost when the phone reconnects.
    expect((await pendingOutbox()).map((r) => r.type)).toEqual([
      "listItem.create",
      "listItem.create",
    ]);
  });

  it("doesn't add an item a list already has", async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "Add to Tesco" }));
    await user.type(screen.getByRole("textbox", { name: "Add an item to Tesco" }), " eggs {Enter}");

    expect(within(row("Tesco")).getByText("2 items")).toBeInTheDocument();
    expect(await pendingOutbox()).toEqual([]);
  });

  it("creates a new list", async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "New list" }));
    await user.type(screen.getByRole("textbox", { name: "New list name" }), "M&S Bangor{Enter}");

    expect(await screen.findByRole("link", { name: /M&S Bangor/ })).toBeInTheDocument();
  });

  it("explains why a duplicate list name is refused", async () => {
    const user = userEvent.setup();
    render();
    await user.click(await screen.findByRole("button", { name: "New list" }));
    await user.type(screen.getByRole("textbox", { name: "New list name" }), "tesco{Enter}");

    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/);
    expect(screen.getAllByRole("link", { name: /Tesco/ })).toHaveLength(1);
  });
});
