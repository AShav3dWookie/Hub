import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { primeRepo } from "../test/mockRepo.js";
import { EntityNotes } from "./EntityNotes.js";
import type { EntityNoteDTO } from "@logger/shared";

vi.mock("../local/repo.js");
vi.mock("../api/afterMutation.js", () => ({
  refreshAfterMutation: (qc: { invalidateQueries: () => unknown }) => {
    void qc.invalidateQueries();
    return Promise.resolve();
  },
}));
import { repo } from "../local/repo.js";

const NOW = "2024-05-01T00:00:00.000Z";

function jsonResponse(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body };
}

describe("EntityNotes", () => {
  beforeEach(() => {
    primeRepo(repo);
    vi.stubGlobal("fetch", vi.fn());
  });

  it("lists existing notes with their category badge, once the section is expanded", async () => {
    vi.mocked(repo.listEntityNotes).mockResolvedValue([
      {
        id: 1,
        entityId: 5,
        category: "gift_idea",
        body: "Concert tickets",
        tag: null,
        eventDate: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ] satisfies EntityNoteDTO[]);

    renderWithProviders(<EntityNotes entityId={5} />);

    await screen.findByRole("button", { name: /Gift idea/ });
    expect(screen.queryByText("Concert tickets")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Gift idea/ }));
    expect(await screen.findByText("Concert tickets")).toBeInTheDocument();
  });

  it("shows all three category sections, collapsed, with zero counts when there are no notes", async () => {
    renderWithProviders(<EntityNotes entityId={5} />);

    expect(await screen.findByRole("button", { name: /General/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Gift idea/ })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: /Conversation topic/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("submits a new note to the API", async () => {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      jsonResponse(
        { id: 2, entityId: 5, category: "general", body: "Loves hiking", createdAt: NOW, updatedAt: NOW },
        201,
      ),
    );

    renderWithProviders(<EntityNotes entityId={5} />);
    await screen.findByRole("button", { name: /General/ });

    await userEvent.type(screen.getByPlaceholderText(/Conversation topics/), "Loves hiking");
    await userEvent.click(screen.getByRole("button", { name: "Add note" }));

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/entities/5/notes",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ category: "general", body: "Loves hiking" }),
      }),
    );
  });

  it("shows a delete confirmation before removing a note", async () => {
    vi.mocked(repo.listEntityNotes).mockResolvedValue([
      {
        id: 1,
        entityId: 5,
        category: "general",
        body: "Note body",
        tag: null,
        eventDate: null,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ]);

    renderWithProviders(<EntityNotes entityId={5} />);
    await userEvent.click(await screen.findByRole("button", { name: /General/ }));
    await screen.findByText("Note body");

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByText("Delete this note?")).toBeInTheDocument();
  });
});
