import { describe, expect, it } from "vitest";
import { dayKey, daysLeft, formatBytes, looksLikeIpv4, passwordProblem, validProfileName } from "./format";

describe("format", () => {
  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024, "ru")).toBe("5.0 МБ");
  });
  it("checks ipv4 shape", () => {
    expect(looksLikeIpv4("192.168.1.50")).toBe(true);
    expect(looksLikeIpv4("192.168.1.256")).toBe(false);
    expect(looksLikeIpv4("tv.local")).toBe(false);
  });
  it("mirrors the backend password and profile rules", () => {
    expect(passwordProblem("Passw0rdX")).toBe(false);
    for (const bad of ["short1A", "alllowercase1", "ALLUPPERCASE1", "NoDigitsHere"]) expect(passwordProblem(bad)).toBe(true);
    expect(validProfileName("EasyTizen-TV_1")).toBe(true);
    expect(validProfileName("has space")).toBe(false);
    expect(validProfileName("ab")).toBe(false);
  });
  it("counts days to expiry", () => {
    const now = Date.UTC(2026, 0, 1);
    expect(daysLeft(now / 1000 + 86_400 * 10, now)).toBe(10);
    expect(daysLeft(now / 1000 - 86_400, now)).toBe(-1);
    expect(daysLeft(null)).toBeNull();
  });
  it("groups history by local day", () => {
    const now = new Date(2026, 10, 15, 9, 30);
    const at = (d: Date) => d.getTime() / 1000;
    expect(dayKey(at(new Date(2026, 10, 15, 0, 5)), now)).toBe("today");
    expect(dayKey(at(new Date(2026, 10, 14, 23, 59)), now)).toBe("yesterday");
    expect(dayKey(at(new Date(2026, 10, 9, 12)), now)).toBe("2026-11-09");
  });
});
