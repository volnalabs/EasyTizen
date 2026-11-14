import { describe, expect, it } from "vitest";
import type { ExtraChecks, Settings, UpdateStatus } from "../types";
import { demoInvoke } from "./demo";

describe("demo backend mirrors the settings contract", () => {
  it("additional checks follow the setting and the setting persists", async () => {
    const on = await demoInvoke<ExtraChecks>("verify_package", { path: "/demo/MyApp.wgt", asIs: true });
    expect(on.enabled).toBe(true);
    expect(on.ran).toContain("signature");
    await demoInvoke("set_extra_package_checks", { enabled: false });
    expect((await demoInvoke<Settings>("get_settings")).extra_package_checks).toBe(false);
    const off = await demoInvoke<ExtraChecks>("verify_package", { path: "/demo/MyApp.wgt", asIs: false });
    expect(off).toEqual({ enabled: false, ran: [], findings: [] });
    await demoInvoke("set_extra_package_checks", { enabled: true });
  });

  it("a manual check records the time of the last check", async () => {
    const before = Math.floor(Date.now() / 1000);
    const status = await demoInvoke<UpdateStatus>("update_check");
    expect(status.checked_at).toBeGreaterThanOrEqual(before);
    expect((await demoInvoke<Settings>("get_settings")).last_update_check).toBeGreaterThanOrEqual(before);
  });

  it("turning automatic updates off is kept", async () => {
    const s = await demoInvoke<Settings>("get_settings");
    await demoInvoke("save_preferences", { theme: s.theme, language: s.language, defaultPort: s.default_port, timeoutMs: s.timeout_ms, checkUpdates: false });
    expect((await demoInvoke<Settings>("get_settings")).check_updates).toBe(false);
  });
});
