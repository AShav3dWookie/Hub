import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Add } from "./Add.js";

describe("Add", () => {
  it("renders a tile for every hardcoded category, linking to its add form", () => {
    render(
      <MemoryRouter>
        <Add />
      </MemoryRouter>,
    );

    for (const label of ["Movie", "TV Show", "Eating Out", "Book", "Game", "Person"]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }

    const personLink = screen.getByText("Person").closest("a");
    expect(personLink).toHaveAttribute("href", "/add/person");
  });
});
