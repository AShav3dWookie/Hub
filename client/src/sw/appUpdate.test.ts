import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import {
  startAppUpdates,
  RESUME_CHECK_INTERVAL_MS,
  RESUME_SETTLE_MS,
  type AppUpdates,
} from "./appUpdate.js";
import { useUnsavedChanges } from "../lib/unsavedChanges.js";

/**
 * When the running app moves onto a new build.
 *
 * The case this exists for: 1.3.0 was deployed and the installed app on the phone kept saying
 * 1.2.0, because it was only ever resumed, never relaunched, and the version check ran only on
 * launch. A private window had 1.3.0 already. The other half is that moving means a reload, and
 * a reload must never take a half-filled form with it.
 *
 * How the shell is actually updated (worker update, cache clear, the reload-loop guard) is
 * `shellVersion.test.ts`; here it is stubbed so the tests are about *when*.
 */

const BUILT = "1.2.0";

const shell = vi.hoisted(() => ({
  serving: null as string | null,
  checks: 0,
  updateWorks: true,
  reload: () => {},
}));

vi.mock("./shellVersion.js", () => ({
  builtVersion: () => BUILT,
  newerServingVersion: async () => {
    shell.checks += 1;
    return shell.serving;
  },
  updateShell: async ({ reload }: { reload: () => void }) => {
    if (!shell.updateWorks) return false;
    reload();
    return true;
  },
}));

let clock = 0;
let visibility: DocumentVisibilityState = "visible";
let reload: ReturnType<typeof vi.fn>;
let showToast: ReturnType<typeof vi.fn>;
let updates: AppUpdates | undefined;

function start() {
  updates = startAppUpdates({ showToast, reload, now: () => clock });
  return updates;
}

/** Let the launch check's promise chain run. */
const settle = () => vi.advanceTimersByTimeAsync(0);

/** Background the app, let `ms` pass, bring it back, and let the resume decide. */
async function awayFor(ms: number) {
  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  clock += ms;
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.advanceTimersByTimeAsync(RESUME_SETTLE_MS);
}

/** The "ready — tap to update" toast's tap handler. */
function lastToastTap(): () => void {
  const [, options] = showToast.mock.calls.at(-1)!;
  return options.onTap;
}

beforeEach(() => {
  vi.useFakeTimers();
  clock = 1_000_000;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  shell.serving = null;
  shell.checks = 0;
  shell.updateWorks = true;
  reload = vi.fn();
  showToast = vi.fn();
  sessionStorage.clear();
});

afterEach(() => {
  updates?.stop();
  updates = undefined;
  vi.useRealTimers();
  (document.activeElement as HTMLElement | null)?.blur();
  document.body.innerHTML = "";
});

describe("at launch", () => {
  it("moves straight onto a newer build, as before", async () => {
    shell.serving = "1.3.0";
    start();
    await settle();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the build is current", async () => {
    start();
    await settle();

    expect(reload).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });
});

describe("returning to the foreground", () => {
  it("picks up a build deployed while the app sat in the background", async () => {
    // The 1.3.0 case: current at launch, swiped away to recents, deployed, resumed.
    start();
    await settle();
    shell.serving = "1.3.0";

    await awayFor(RESUME_CHECK_INTERVAL_MS);

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("checks at most once every few minutes, so flicking between apps is free", async () => {
    start();
    await settle();
    expect(shell.checks).toBe(1);

    await awayFor(10_000);
    await awayFor(30_000);
    await awayFor(RESUME_CHECK_INTERVAL_MS - 40_001);
    expect(shell.checks).toBe(1);

    await awayFor(1);
    expect(shell.checks).toBe(2);
  });

  it("waits a moment before deciding, so files from the picker land first", async () => {
    // Coming back from the photo picker is a return to the foreground too, and the picked
    // files arrive just after it. Deciding at once would reload the form out from under them.
    start();
    await settle();
    shell.serving = "1.3.0";
    clock += RESUME_CHECK_INTERVAL_MS;

    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(RESUME_SETTLE_MS - 1);
    expect(shell.checks).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(shell.checks).toBe(2);
  });

  it("does not check when the app only went to the background", async () => {
    start();
    await settle();
    clock += RESUME_CHECK_INTERVAL_MS;

    visibility = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(RESUME_SETTLE_MS);

    expect(shell.checks).toBe(1);
  });

  it("stays quiet offline: no server, no reload, no toast", async () => {
    start();
    await settle();
    shell.serving = null; // what the check answers when /api/health can't be reached

    await awayFor(RESUME_CHECK_INTERVAL_MS);

    expect(shell.checks).toBe(2);
    expect(reload).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("stops listening once stopped", async () => {
    start().stop();
    await settle();
    shell.serving = "1.3.0";

    await awayFor(RESUME_CHECK_INTERVAL_MS);

    expect(reload).not.toHaveBeenCalled();
  });
});

describe("with a form half filled in", () => {
  it("does not reload, and offers the update instead", async () => {
    const form = renderHook(() => useUnsavedChanges(true));
    start();
    await settle();
    shell.serving = "1.3.0";

    await awayFor(RESUME_CHECK_INTERVAL_MS);

    expect(reload).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("Hub 1.3.0 is ready — tap to update", {
      onTap: expect.any(Function),
      persist: true,
    });
    form.unmount();
  });

  it("updates when the toast is tapped", async () => {
    const form = renderHook(() => useUnsavedChanges(true));
    shell.serving = "1.3.0";
    start();
    await settle();
    expect(reload).not.toHaveBeenCalled();

    lastToastTap()();
    await settle();

    expect(reload).toHaveBeenCalledTimes(1);
    form.unmount();
  });

  it("updates on the next return once the form is saved or abandoned", async () => {
    const form = renderHook(({ dirty }) => useUnsavedChanges(dirty), {
      initialProps: { dirty: true },
    });
    shell.serving = "1.3.0";
    start();
    await settle();
    expect(reload).not.toHaveBeenCalled();

    form.rerender({ dirty: false });
    // A known update needs no second check, and isn't held up by the throttle.
    await awayFor(1_000);

    expect(reload).toHaveBeenCalledTimes(1);
    expect(shell.checks).toBe(1);
    form.unmount();
  });

  it("keeps offering it on each return while the form is still open", async () => {
    const form = renderHook(() => useUnsavedChanges(true));
    shell.serving = "1.3.0";
    start();
    await settle();
    await awayFor(1_000);

    expect(showToast).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
    form.unmount();
  });

  it("treats a focused field as someone typing", async () => {
    const input = document.createElement("input");
    document.body.append(input);
    input.focus();
    shell.serving = "1.3.0";
    start();
    await settle();

    expect(reload).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("does not count a focused button", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    shell.serving = "1.3.0";
    start();
    await settle();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe("after an update reload", () => {
  it("says what it updated to", async () => {
    // What the version being left writes down just before reloading.
    sessionStorage.setItem("logger:updating-from", "1.1.0");
    start();

    expect(showToast).toHaveBeenCalledWith("Updated to 1.2.0");
  });

  it("says it only once", async () => {
    sessionStorage.setItem("logger:updating-from", "1.1.0");
    start().stop();
    showToast.mockClear();

    start();

    expect(showToast).not.toHaveBeenCalled();
  });

  it("says nothing when the reload did not change the build", async () => {
    sessionStorage.setItem("logger:updating-from", BUILT);
    start();

    expect(showToast).not.toHaveBeenCalled();
  });

  it("records the version being left, so the next load can tell", async () => {
    shell.serving = "1.3.0";
    start();
    await settle();

    expect(sessionStorage.getItem("logger:updating-from")).toBe(BUILT);
  });

  it("stops offering an update that has already failed twice", async () => {
    shell.updateWorks = false;
    const form = renderHook(() => useUnsavedChanges(true));
    shell.serving = "1.3.0";
    start();
    await settle();

    lastToastTap()();
    await settle();
    expect(sessionStorage.getItem("logger:updating-from")).toBeNull();

    shell.serving = null;
    showToast.mockClear();
    await awayFor(1_000);
    expect(showToast).not.toHaveBeenCalled();
    form.unmount();
  });
});

describe("a worker that updated by itself", () => {
  // A push or periodic sync can wake the worker, which then finds and activates a new build
  // while the app is open. The plugin would reload on the spot; it hands that to us instead.

  it("reloads onto it when nothing is unsaved", async () => {
    start().workerUpdated();

    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("waits for a half-filled form, like any other update", async () => {
    const form = renderHook(() => useUnsavedChanges(true));
    start().workerUpdated();

    expect(reload).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("A new Hub is ready — tap to update", {
      onTap: expect.any(Function),
      persist: true,
    });
    form.unmount();
  });

  it("waits for the app to come back when it happens in the background", async () => {
    const app = start();
    await settle();
    visibility = "hidden";

    app.workerUpdated();
    expect(reload).not.toHaveBeenCalled();

    visibility = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.advanceTimersByTimeAsync(RESUME_SETTLE_MS);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("is ignored while our own update is already reloading", async () => {
    // updateShell's worker update activates a worker too; that must not reload a second time.
    shell.serving = "1.3.0";
    const app = start();
    await settle();

    app.workerUpdated();

    expect(reload).toHaveBeenCalledTimes(1);
  });
});
