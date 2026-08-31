import { describe, it, expect } from "vitest";
import {
  CompositePolicy,
  DailyMidnightPolicy,
  ImmediatePolicy,
  ManualOnlyPolicy,
  OnOpenPolicy,
  type SyncContext,
} from "./policy.js";

const ctx = (over: Partial<SyncContext> = {}): SyncContext => ({
  online: true,
  lastSyncAt: null,
  now: Date.parse("2026-06-15T13:37:00"),
  ...over,
});

describe("sync policies", () => {
  it("ManualOnly allows only manual and never schedules", () => {
    const p = new ManualOnlyPolicy();
    expect(p.allows("manual", ctx())).toBe(true);
    expect(p.allows("open", ctx())).toBe(false);
    expect(p.allows("scheduled", ctx())).toBe(false);
    expect(p.nextScheduledAt(ctx())).toBeNull();
  });

  it("OnOpen allows open/focus/online/mutation when online, nothing offline", () => {
    const p = new OnOpenPolicy();
    for (const r of ["open", "focus", "online", "mutation"] as const) {
      expect(p.allows(r, ctx())).toBe(true);
      expect(p.allows(r, ctx({ online: false }))).toBe(false);
    }
    expect(p.allows("scheduled", ctx())).toBe(false);
    expect(p.nextScheduledAt(ctx())).toBeNull();
  });

  it("DailyMidnight allows only scheduled and targets the next local 00:00", () => {
    const p = new DailyMidnightPolicy();
    expect(p.allows("scheduled", ctx())).toBe(true);
    expect(p.allows("open", ctx())).toBe(false);

    const next = p.nextScheduledAt(ctx())!;
    const d = new Date(next);
    expect(d.getHours()).toBe(0);
    expect(d.getMinutes()).toBe(0);
    expect(next).toBeGreaterThan(ctx().now);
    // strictly within the next 24h
    expect(next - ctx().now).toBeLessThanOrEqual(24 * 3600 * 1000);
  });

  it("Immediate syncs on any non-scheduled reason when online", () => {
    const p = new ImmediatePolicy();
    expect(p.allows("mutation", ctx())).toBe(true);
    expect(p.allows("scheduled", ctx())).toBe(false);
    expect(p.allows("mutation", ctx({ online: false }))).toBe(false);
  });

  it("Composite ORs allows and takes the earliest schedule", () => {
    const p = new CompositePolicy([new OnOpenPolicy(), new DailyMidnightPolicy()]);
    expect(p.allows("open", ctx())).toBe(true);
    expect(p.allows("scheduled", ctx())).toBe(true);
    expect(p.allows("manual", ctx())).toBe(false); // neither sub-policy handles manual (engine does)
    expect(p.nextScheduledAt(ctx())).toBe(new DailyMidnightPolicy().nextScheduledAt(ctx()));
  });
});
