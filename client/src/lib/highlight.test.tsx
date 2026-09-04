import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { highlightMatches } from "./highlight.js";

const renderResult = (text: string, tokens: string[]) =>
  render(<p data-testid="out">{highlightMatches(text, tokens)}</p>);

describe("highlightMatches", () => {
  it("returns the text untouched when there is no keyword", () => {
    renderResult("Blade Runner", []);
    expect(screen.getByTestId("out").textContent).toBe("Blade Runner");
    expect(screen.queryByRole("mark")).not.toBeInTheDocument();
  });

  it("marks a matching word", () => {
    const { container } = renderResult("Blade Runner", ["blade"]);
    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("Blade");
  });

  it("matches case-insensitively but keeps the original casing", () => {
    const { container } = renderResult("BLADE Runner", ["blade"]);
    expect(container.querySelector("mark")?.textContent).toBe("BLADE");
  });

  it("marks every occurrence", () => {
    const { container } = renderResult("Dune and more Dune", ["dune"]);
    expect(container.querySelectorAll("mark")).toHaveLength(2);
  });

  it("marks each of several tokens", () => {
    const { container } = renderResult("Blade Runner 2049", ["blade", "2049"]);
    expect([...container.querySelectorAll("mark")].map((m) => m.textContent)).toEqual([
      "Blade",
      "2049",
    ]);
  });

  it("leaves the surrounding text intact", () => {
    renderResult("Blade Runner", ["blade"]);
    expect(screen.getByTestId("out").textContent).toBe("Blade Runner");
  });

  it("does not treat a token as a regular expression", () => {
    // "c++" would be an invalid pattern, and "." would match every character.
    expect(() => renderResult("c++ programming", ["c++"])).not.toThrow();
    const { container } = renderResult("a.b", ["."]);
    expect(container.querySelectorAll("mark")).toHaveLength(1);
    expect(container.querySelector("mark")?.textContent).toBe(".");
  });

  it("handles a token that matches nothing", () => {
    const { container } = renderResult("Blade Runner", ["zzz"]);
    expect(container.querySelectorAll("mark")).toHaveLength(0);
    expect(screen.getByTestId("out").textContent).toBe("Blade Runner");
  });

  it("handles an empty string", () => {
    renderResult("", ["blade"]);
    expect(screen.getByTestId("out").textContent).toBe("");
  });
});
