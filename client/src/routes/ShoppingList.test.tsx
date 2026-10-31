import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Routes, Route } from "react-router-dom";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { makeList, makeListItem, resetFixtureCounters, seedLocalDb } from "../test/seedLocalDb.js";
import { Shopping } from "./Shopping.js";
import { ShoppingList } from "./ShoppingList.js";

vi.mock("../api/afterMutation.js", () => ({
  refreshAfterMutation: (qc: { invalidateQueries: () => unknown }) => {
    void qc.invalidateQueries();
    return Promise.resolve();
  },
}));

let mainId: number;
let tescoId: number;

function render(id: number, editing = false) {
  return renderWithProviders(
    <Routes>
      <Route path="/shopping" element={<Shopping />} />
      <Route path="/shopping/:id" element={<ShoppingList />} />
    </Routes>,
    { route: `/shopping/${id}`, editing },
  );
}

const itemTexts = () =>
  within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

describe("A shopping list's page", () => {
  beforeEach(async () => {
    resetFixtureCounters();
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    const main = makeList({ name: "Shopping", isDefault: true });
    const tesco = makeList({ name: "Tesco" });
    mainId = main.id;
    tescoId = tesco.id;
    await seedLocalDb({
      lists: [main, tesco],
      listItems: [
        makeListItem({ listId: tesco.id, text: "Eggs", createdAt: "2026-01-01T00:00:00.000Z" }),
        makeListItem({ listId: tesco.id, text: "Milk", createdAt: "2026-01-02T00:00:00.000Z" }),
      ],
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("lists the items in the order they were added", async () => {
    render(tescoId);
    await screen.findByText("Eggs");
    expect(itemTexts()).toEqual(["Eggs", "Milk"]);
  });

  it("adds an item to the bottom", async () => {
    const user = userEvent.setup();
    render(tescoId);
    await user.type(await screen.findByRole("textbox", { name: "Add an item to Tesco" }), "Bread{Enter}");

    await screen.findByText("Bread");
    expect(itemTexts()).toEqual(["Eggs", "Milk", "Bread"]);
  });

  it("removes an item with its red X", async () => {
    const user = userEvent.setup();
    render(tescoId);
    await user.click(await screen.findByRole("button", { name: "Remove Eggs" }));

    await vi.waitFor(() => expect(screen.queryByText("Eggs")).not.toBeInTheDocument());
    expect(itemTexts()).toEqual(["Milk"]);
  });

  it("says so when the list is empty", async () => {
    render(mainId);
    expect(await screen.findByText("Nothing on this list.")).toBeInTheDocument();
  });

  it("says so for a list that doesn't exist", async () => {
    render(999);
    expect(await screen.findByText("List not found.")).toBeInTheDocument();
  });

  describe("in edit mode", () => {
    it("renames the list", async () => {
      const user = userEvent.setup();
      render(tescoId, true);
      const field = await screen.findByRole("textbox", { name: "List name" });
      await user.clear(field);
      await user.type(field, "Tesco Bangor");
      await user.click(screen.getByRole("button", { name: "Save name" }));

      expect(await screen.findByRole("heading", { name: "Tesco Bangor" })).toBeInTheDocument();
    });

    it("refuses a name another list already has", async () => {
      const user = userEvent.setup();
      render(tescoId, true);
      const field = await screen.findByRole("textbox", { name: "List name" });
      await user.clear(field);
      await user.type(field, "shopping");
      await user.click(screen.getByRole("button", { name: "Save name" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/);
    });

    it("makes the list main, taking it from the old main list", async () => {
      const user = userEvent.setup();
      render(tescoId, true);
      await user.click(await screen.findByRole("button", { name: "Make main list" }));

      expect(await screen.findByText("Main")).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Make main list" })).not.toBeInTheDocument();
    });

    it("offers no delete on the main list", async () => {
      render(mainId, true);
      await screen.findByRole("textbox", { name: "List name" });
      expect(screen.queryByRole("button", { name: "Delete list" })).not.toBeInTheDocument();
      expect(screen.getByText(/can't be deleted/)).toBeInTheDocument();
    });

    it("deletes a list after confirming, and goes back to the lists", async () => {
      const user = userEvent.setup();
      render(tescoId, true);
      await user.click(await screen.findByRole("button", { name: "Delete list" }));
      expect(screen.getByText("Delete this list and its 2 items?")).toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Delete" }));

      expect(await screen.findByRole("heading", { name: "Shopping" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: /Tesco/ })).not.toBeInTheDocument();
    });
  });
});
