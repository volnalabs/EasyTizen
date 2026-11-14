import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTO_CHECK_DELAY_MS, AUTO_CHECK_INTERVAL_MS, scheduleAutoChecks, shouldAutoDownload } from "./useUpdater";

afterEach(() => { vi.useRealTimers(); });

describe("automatic updates", () => {
  it("does nothing in the background when the automatic mode is off", () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const stop = scheduleAutoChecks(false, check);
    vi.advanceTimersByTime(AUTO_CHECK_INTERVAL_MS * 5);
    expect(check).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    stop();
  });

  it("checks shortly after start-up and then periodically when on", () => {
    vi.useFakeTimers();
    const check = vi.fn();
    const stop = scheduleAutoChecks(true, check);
    vi.advanceTimersByTime(AUTO_CHECK_DELAY_MS - 1);
    expect(check).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(check).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(AUTO_CHECK_INTERVAL_MS);
    expect(check).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(AUTO_CHECK_INTERVAL_MS * 3);
    expect(check).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("downloads in the background only after automatic checks of installable updates", () => {
    expect(shouldAutoDownload({ available: true, install: "self" }, false)).toBe(true);
    expect(shouldAutoDownload({ available: true, install: "apk" }, false)).toBe(true);
    // A manual "Check now" only reports; the user starts the download.
    expect(shouldAutoDownload({ available: true, install: "self" }, true)).toBe(false);
    // Builds without the update key never download anything.
    expect(shouldAutoDownload({ available: true, install: "manual" }, false)).toBe(false);
    expect(shouldAutoDownload({ available: false, install: "self" }, false)).toBe(false);
  });
});
