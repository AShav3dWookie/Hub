import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDebouncedValue } from "./useDebouncedValue.js";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("useDebouncedValue", () => {
  it("returns the initial value straight away, so nothing renders empty", () => {
    const { result } = renderHook(() => useDebouncedValue("a", 300));
    expect(result.current).toBe("a");
  });

  it("holds the old value until the delay has passed", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "a" },
    });

    rerender({ v: "b" });
    expect(result.current).toBe("a");

    advance(299);
    expect(result.current).toBe("a");

    advance(1);
    expect(result.current).toBe("b");
  });

  it("restarts the wait on every change, so fast typing only settles once", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "a" },
    });

    rerender({ v: "ab" });
    advance(200);
    rerender({ v: "abc" });
    advance(200);
    expect(result.current).toBe("a");

    advance(100);
    expect(result.current).toBe("abc");
  });

  it("settles on the newest value, never an intermediate one", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: 1 },
    });

    rerender({ v: 2 });
    rerender({ v: 3 });
    advance(300);
    expect(result.current).toBe(3);
  });

  it("honours a custom delay", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 50), {
      initialProps: { v: "a" },
    });

    rerender({ v: "b" });
    advance(50);
    expect(result.current).toBe("b");
  });

  it("works with values other than strings", () => {
    const { result, rerender } = renderHook(({ v }) => useDebouncedValue(v, 100), {
      initialProps: { v: { id: 1 } },
    });

    const next = { id: 2 };
    rerender({ v: next });
    advance(100);
    expect(result.current).toBe(next);
  });

  it("drops a pending update when it unmounts, so nothing sets state afterwards", () => {
    const { rerender, unmount } = renderHook(({ v }) => useDebouncedValue(v, 300), {
      initialProps: { v: "a" },
    });

    rerender({ v: "b" });
    unmount();
    expect(() => advance(300)).not.toThrow();
  });
});
