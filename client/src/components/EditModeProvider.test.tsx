import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Link, MemoryRouter, Route, Routes } from "react-router-dom";
import { EditModeProvider, useEditableRoute, useEditModeToggle } from "./EditModeProvider.js";

/** Stands in for `Layout`: the one place the toggle is rendered. */
function Header() {
  const { editing, supported, toggle } = useEditModeToggle();
  if (!supported) return <p>no pencil</p>;
  return (
    <button type="button" onClick={toggle}>
      {editing ? "Done editing" : "Edit"}
    </button>
  );
}

function EditableScreen({ name }: { name: string }) {
  const editing = useEditableRoute();
  return (
    <div>
      <p>{`${name}: ${editing ? "editing" : "reading"}`}</p>
      <Link to="/plain">to plain</Link>
      <Link to="/other">to other</Link>
    </div>
  );
}

function PlainScreen() {
  return <Link to="/">to editable</Link>;
}

function renderApp(route = "/") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <EditModeProvider>
        <Header />
        <Routes>
          <Route path="/" element={<EditableScreen name="first" />} />
          <Route path="/other" element={<EditableScreen name="second" />} />
          <Route path="/plain" element={<PlainScreen />} />
        </Routes>
      </EditModeProvider>
    </MemoryRouter>,
  );
}

describe("EditModeProvider", () => {
  it("offers no toggle until a screen says it has something to edit", () => {
    renderApp("/plain");
    expect(screen.getByText("no pencil")).toBeInTheDocument();
  });

  it("toggles the screen between reading and editing", async () => {
    renderApp();
    expect(screen.getByText("first: reading")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByText("first: editing")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Done editing" }));
    expect(screen.getByText("first: reading")).toBeInTheDocument();
  });

  it("leaves edit mode behind when you navigate to a screen that cannot edit", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    await userEvent.click(screen.getByRole("link", { name: "to plain" }));
    expect(screen.getByText("no pencil")).toBeInTheDocument();

    // And coming back starts in read mode rather than where we left off.
    await userEvent.click(screen.getByRole("link", { name: "to editable" }));
    expect(screen.getByText("first: reading")).toBeInTheDocument();
  });

  it("leaves edit mode behind when you navigate between two editable screens", async () => {
    renderApp();
    await userEvent.click(screen.getByRole("button", { name: "Edit" }));

    await userEvent.click(screen.getByRole("link", { name: "to other" }));
    expect(screen.getByText("second: reading")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });
});
