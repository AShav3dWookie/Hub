import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { hasUnsavedChanges, useUnsavedChanges } from "./unsavedChanges.js";

describe("useUnsavedChanges", () => {
  it("holds while dirty and lets go once clean", () => {
    const form = renderHook(({ dirty }) => useUnsavedChanges(dirty), {
      initialProps: { dirty: false },
    });
    expect(hasUnsavedChanges()).toBe(false);

    form.rerender({ dirty: true });
    expect(hasUnsavedChanges()).toBe(true);

    form.rerender({ dirty: false });
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("lets go when the form goes away, saved or abandoned", () => {
    const form = renderHook(() => useUnsavedChanges(true));
    form.unmount();
    expect(hasUnsavedChanges()).toBe(false);
  });

  it("keeps holding while a second form on the screen is still dirty", () => {
    const first = renderHook(() => useUnsavedChanges(true));
    const second = renderHook(() => useUnsavedChanges(true));

    first.unmount();
    expect(hasUnsavedChanges()).toBe(true);

    second.unmount();
    expect(hasUnsavedChanges()).toBe(false);
  });
});
