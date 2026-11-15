/**
 * State of each installation step. done ✓ · current (the next thing to do) · open (available,
 * not yet next) · attention (blocked) · locked (needs an earlier step).
 */
export type StepState = "done" | "current" | "open" | "attention" | "locked";
export const STEP_STATES: StepState[] = ["done", "current", "open", "attention", "locked"];

export interface StepInput {
  tv: boolean;
  pkg: boolean;
  /** The additional checks found a blocking problem, or could not run. */
  blocked: boolean;
  /** Signing is needed for a Samsung certificate but the TV reported no DUID. */
  needsDuid: boolean;
  /** Installing as is, or a certificate that fits this TV is chosen. */
  signReady: boolean;
  /** The last installation of this package succeeded. */
  installed: boolean;
}

export interface Steps { tv: StepState; app: StepState; sign: StepState; install: StepState; ready: boolean }

/** TV → App → Signature → Install. Exactly one step is "current" until everything is done. */
export function installSteps(i: StepInput): Steps {
  const ready = i.tv && i.pkg && i.signReady && !i.blocked;
  return {
    tv: i.tv ? "done" : "current",
    app: i.pkg ? (i.blocked ? "attention" : "done") : i.tv ? "current" : "open",
    sign: !i.tv || !i.pkg ? "locked" : i.needsDuid ? "attention" : i.signReady ? "done" : "current",
    install: i.installed ? "done" : ready ? "current" : "locked",
    ready,
  };
}
