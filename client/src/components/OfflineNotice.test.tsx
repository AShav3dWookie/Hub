import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { OfflineNotice } from "./OfflineNotice.js";

afterEach(() => vi.restoreAllMocks());

describe("OfflineNotice", () => {
  it("renders nothing while online", () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
    const { container } = render(<OfflineNotice />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows a message while offline and reacts to reconnecting", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    render(<OfflineNotice verb="Creating" />);
    expect(screen.getByRole("status")).toHaveTextContent(/offline.*Creating needs a connection/i);

    onLine.mockReturnValue(true);
    act(() => window.dispatchEvent(new Event("online")));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
