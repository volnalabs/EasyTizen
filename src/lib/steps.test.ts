import { describe, expect, it } from "vitest";
import { en } from "../i18n/en";
import { ru } from "../i18n/ru";
import { installSteps, STEP_STATES, type StepInput } from "./steps";

const base: StepInput = { tv: false, pkg: false, blocked: false, needsDuid: false, signReady: false, installed: false };
const current = (s: ReturnType<typeof installSteps>) => (["tv", "app", "sign", "install"] as const).filter((k) => s[k] === "current");

describe("installation steps", () => {
  it("starts with the TV; the file can be chosen first", () => {
    const s = installSteps(base);
    expect(s).toMatchObject({ tv: "current", app: "open", sign: "locked", install: "locked", ready: false });
  });
  it("moves on to the file once the TV is connected", () => {
    expect(installSteps({ ...base, tv: true })).toMatchObject({ tv: "done", app: "current", sign: "locked" });
  });
  it("asks for a certificate when signing is needed", () => {
    const s = installSteps({ ...base, tv: true, pkg: true });
    expect(s).toMatchObject({ sign: "current", install: "locked", ready: false });
  });
  it("flags a TV without a Device ID when a Samsung certificate is needed", () => {
    expect(installSteps({ ...base, tv: true, pkg: true, needsDuid: true }).sign).toBe("attention");
  });
  it("is ready once everything is in place", () => {
    const s = installSteps({ ...base, tv: true, pkg: true, signReady: true });
    expect(s).toMatchObject({ tv: "done", app: "done", sign: "done", install: "current", ready: true });
  });
  it("blocks installation when the checks fail", () => {
    const s = installSteps({ ...base, tv: true, pkg: true, signReady: true, blocked: true });
    expect(s).toMatchObject({ app: "attention", install: "locked", ready: false });
  });
  it("marks the installation done after success", () => {
    expect(installSteps({ ...base, tv: true, pkg: true, signReady: true, installed: true }).install).toBe("done");
  });
  it("never has two current steps", () => {
    for (const tv of [false, true]) for (const pkg of [false, true]) for (const signReady of [false, true]) for (const blocked of [false, true]) {
      expect(current(installSteps({ ...base, tv, pkg, signReady, blocked })).length).toBeLessThanOrEqual(1);
    }
  });
  it("every state has a spoken name in both languages", () => {
    for (const state of STEP_STATES) for (const dict of [en, ru]) expect(dict[`stepState_${state}` as keyof typeof en], state).toBeTruthy();
  });
});
