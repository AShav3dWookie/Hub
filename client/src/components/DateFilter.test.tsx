import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DateFilter } from "./DateFilter.js";

function Harness() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <>
      <DateFilter
        dateFrom={from}
        dateTo={to}
        forceMode="specific"
        onChange={(f, t) => {
          setFrom(f);
          setTo(t);
        }}
      />
      <output data-testid="from">{from}</output>
      <output data-testid="to">{to}</output>
    </>
  );
}

describe("DateFilter specific-mode range auto-fill", () => {
  it("mirrors From into a blank To", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2024-09-01" } });

    expect(screen.getByTestId("from")).toHaveTextContent("2024-09-01");
    expect(screen.getByTestId("to")).toHaveTextContent("2024-09-01");
  });

  it("mirrors To into a blank From, and does not clobber an existing From", () => {
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2024-09-10" } });
    expect(screen.getByTestId("from")).toHaveTextContent("2024-09-10");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2024-09-01" } });
    expect(screen.getByTestId("from")).toHaveTextContent("2024-09-01");
    expect(screen.getByTestId("to")).toHaveTextContent("2024-09-10");
  });
});
