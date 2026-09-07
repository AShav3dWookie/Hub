import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PersonTagInput } from "@logger/shared";
import { primeRepo } from "../test/mockRepo.js";
import { PeopleTagInput } from "./PeopleTagInput.js";

vi.mock("../local/repo.js");
import { repo } from "../local/repo.js";

/**
 * Both real callers (LogAddForm, AlbumAddForm) wrap this in a <form onSubmit> with a submit
 * button, and that is exactly the condition a mobile bug needed: an Enter keydown that fails
 * the (too-narrow) "is this really Enter?" check falls through as an implicit form submission,
 * saving the entry and navigating away with the person the user was mid-typing left out. A bare
 * harness with no <form> can't observe that, so this one reproduces the real shape.
 */
function Harness({
  initial = [] as PersonTagInput[],
  onSubmit,
}: {
  initial?: PersonTagInput[];
  onSubmit?: () => void;
}) {
  const [value, setValue] = useState<PersonTagInput[]>(initial);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={client}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit?.();
        }}
      >
        <PeopleTagInput value={value} onChange={setValue} />
        <button type="submit">Save</button>
      </form>
      <output data-testid="value">{JSON.stringify(value)}</output>
    </QueryClientProvider>
  );
}

describe("PeopleTagInput", () => {
  beforeEach(() => primeRepo(repo));

  it("adds a new person by typing a name and pressing Enter", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByPlaceholderText(/Add a person/), "Sarah{Enter}");

    expect(screen.getByText("Sarah")).toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify([{ name: "Sarah" }]));
  });

  it("removes a tag via its remove button", async () => {
    render(<Harness initial={[{ name: "Sarah" }, { name: "Jamie" }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove Sarah" }));

    expect(screen.queryByText("Sarah")).not.toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify([{ name: "Jamie" }]));
  });

  it("does not add a duplicate name", async () => {
    render(<Harness initial={[{ name: "Sarah" }]} />);
    await userEvent.type(screen.getByPlaceholderText(/Add a person/), "Sarah{Enter}");
    expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify([{ name: "Sarah" }]));
  });

  it("adds an existing person from the autocomplete list by id", async () => {
    vi.mocked(repo.searchEntitiesByTitle).mockResolvedValue([
      { id: 12, title: "Sarah", category: "person" },
    ]);
    render(<Harness />);
    await userEvent.type(screen.getByPlaceholderText(/Add a person/), "Sar");

    const option = await screen.findByRole("button", { name: "Sarah" });
    await userEvent.click(option);

    expect(screen.getByTestId("value")).toHaveTextContent(
      JSON.stringify([{ id: 12, name: "Sarah" }]),
    );
  });

  // --- the mobile fix: a tap path for a name that matches nobody ---

  it("shows a Create row for a novel name, and tapping it adds the tag with no key event at all", async () => {
    render(<Harness />);
    await userEvent.type(screen.getByPlaceholderText(/Add a person/), "Priya");

    const createRow = await screen.findByRole("button", { name: /Create.*Priya/ });
    await userEvent.click(createRow);

    expect(screen.getByText("Priya")).toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify([{ name: "Priya" }]));
  });

  it("does not offer to create a name that is already tagged, case- and space-insensitively", async () => {
    render(<Harness initial={[{ name: "Sarah" }]} />);
    await userEvent.type(screen.getByPlaceholderText(/Add a person/), "  sarah  ");

    expect(screen.queryByRole("button", { name: /Create/ })).not.toBeInTheDocument();
  });

  it("does not offer to create a name that exactly matches a suggestion", async () => {
    vi.mocked(repo.searchEntitiesByTitle).mockResolvedValue([
      { id: 12, title: "Sarah", category: "person" },
    ]);
    render(<Harness />);
    await userEvent.type(screen.getByPlaceholderText(/Add a person/), "Sarah");

    await screen.findByRole("button", { name: "Sarah" });
    expect(screen.queryByRole("button", { name: /Create/ })).not.toBeInTheDocument();
  });

  // --- the mobile bug: Enter must never fall through to the enclosing form ---

  it("Enter creates the tag and does not submit the enclosing form", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    await userEvent.type(screen.getByPlaceholderText(/Add a person/), "Sarah{Enter}");

    expect(screen.getByTestId("value")).toHaveTextContent(JSON.stringify([{ name: "Sarah" }]));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("an Enter arriving mid-IME-composition (keyCode 229) neither tags nor submits", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText(/Add a person/);
    await userEvent.type(input, "Sarah");

    // Android soft keyboards report composed/autocorrected text this way: key "Unidentified"
    // (or occasionally "Enter"), keyCode 229. There is no synthetic-Enter equivalent for this
    // via userEvent, so the raw event is constructed directly.
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });

    expect(screen.queryByText("Sarah")).not.toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent("[]");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("an Enter while isComposing neither tags nor submits", async () => {
    const onSubmit = vi.fn();
    render(<Harness onSubmit={onSubmit} />);
    const input = screen.getByPlaceholderText(/Add a person/);
    await userEvent.type(input, "Sarah");

    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(screen.queryByText("Sarah")).not.toBeInTheDocument();
    expect(screen.getByTestId("value")).toHaveTextContent("[]");
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
