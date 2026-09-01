import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { pendingOutbox } from "../local/outbox.js";
import { getDB } from "../local/db.js";
import { PersonAddForm } from "./PersonAddForm.js";

vi.mock("../api/afterMutation.js", () => ({
  refreshAfterMutation: (qc: { invalidateQueries: () => unknown }) => {
    void qc.invalidateQueries();
    return Promise.resolve();
  },
}));

describe("PersonAddForm", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  it("shows a validation error and queues nothing when name is empty", async () => {
    renderWithProviders(<PersonAddForm />);

    await userEvent.click(screen.getByRole("button", { name: /create person/i }));

    expect(await screen.findByText("Name is required")).toBeInTheDocument();
    expect(await pendingOutbox()).toEqual([]);
  });

  it("queues an entity.create with the trimmed name and writes a temp person row", async () => {
    renderWithProviders(<PersonAddForm />);
    await userEvent.type(screen.getByLabelText("Name"), "  Sarah  ");
    await userEvent.click(screen.getByRole("button", { name: /create person/i }));

    await vi.waitFor(async () => expect(await pendingOutbox()).toHaveLength(1));
    expect((await pendingOutbox())[0]).toMatchObject({
      type: "entity.create",
      payload: { category: "person", title: "Sarah" },
    });

    const [person] = await (await getDB()).getAll("entities");
    expect(person).toMatchObject({ category: "person", title: "Sarah", _localDirty: true });
  });
});
