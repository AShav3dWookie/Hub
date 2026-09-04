import { describe, it, expect } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithProviders } from "../test/renderWithProviders.js";
import { PersonLinks } from "./PersonLinks.js";

const ada = { id: 1, name: "Ada" };
const zoe = { id: 2, name: "Zoe" };

describe("PersonLinks", () => {
  it("renders nothing when nobody is tagged", () => {
    const { container } = renderWithProviders(<PersonLinks people={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("links each person to their profile", () => {
    renderWithProviders(<PersonLinks people={[ada, zoe]} />);

    expect(screen.getByRole("link", { name: "Ada" })).toHaveAttribute("href", "/person/1");
    expect(screen.getByRole("link", { name: "Zoe" })).toHaveAttribute("href", "/person/2");
  });

  it("reads as a sentence, comma-separated after the first", () => {
    renderWithProviders(<PersonLinks people={[ada, zoe]} />);
    expect(screen.getByText(/with/).textContent).toBe("with Ada, Zoe");
  });

  it("puts no trailing comma after a single person", () => {
    renderWithProviders(<PersonLinks people={[ada]} />);
    expect(screen.getByText(/with/).textContent).toBe("with Ada");
  });

  it("takes a class override for the smaller search results", () => {
    renderWithProviders(<PersonLinks people={[ada]} className="text-xs" />);
    expect(screen.getByText(/with/)).toHaveClass("text-xs");
  });
});
