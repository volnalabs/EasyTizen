import { useCallback, useEffect, useRef, useState } from "react";
import { opId } from "../../lib/format";
import { api, on, toApiError } from "../../services/api";
import type { UpdateProgress, UpdateReady, UpdateStatus } from "../../types";

/** How often the automatic mode looks for a new release while the app is open. */
export const AUTO_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** First automatic check after start-up — after the window has settled. */
export const AUTO_CHECK_DELAY_MS = 8_000;
/** When an installation on the TV is running, a background download waits this long. */
export const BUSY_RETRY_MS = 10 * 60 * 1000;

/**
 * Background schedule of the automatic mode: a first check shortly after start-up, then one
 * every few hours. Returns the cleanup. With `auto` off it schedules nothing at all.
 */
export function scheduleAutoChecks(auto: boolean, check: () => void, timers: Pick<typeof globalThis, "setTimeout" | "clearTimeout" | "setInterval" | "clearInterval"> = globalThis): () => void {
  if (!auto) return () => undefined;
  const first = timers.setTimeout(check, AUTO_CHECK_DELAY_MS);
  const every = timers.setInterval(check, AUTO_CHECK_INTERVAL_MS);
  return () => { timers.clearTimeout(first); timers.clearInterval(every); };
}

/** After a check: start a background download only for automatic checks of installable updates. */
export function shouldAutoDownload(status: Pick<UpdateStatus, "available" | "install">, manual: boolean): boolean {
  return status.available && !manual && status.install !== "manual";
}

export type UpdatePhase = "idle" | "checking" | "latest" | "available" | "downloading" | "ready" | "applying" | "error";

export interface Updater {
  phase: UpdatePhase;
  status: UpdateStatus | null;
  ready: UpdateReady | null;
  /** 0–1 while downloading; null when the size is unknown. */
  progress: number | null;
  error: string | null;
  /** The automatic mode is on (setting "check_updates"). */
  auto: boolean;
  check: (manual: boolean) => Promise<UpdateStatus | null>;
  download: () => Promise<void>;
  apply: () => Promise<void>;
  dismissed: boolean;
  dismiss: () => void;
}

/**
 * Update state shared by the banner and the Settings section.
 *
 * Automatic mode (on by default, persisted in settings) checks shortly after start-up and every
 * few hours, then downloads and verifies the update in the background. Applying it — restarting,
 * running the Windows installer or opening Android's installer — always waits for the user.
 * With automatic mode off nothing runs in the background; "Check now" still works.
 */
export function useUpdater({ auto, busy, onChecked }: { auto: boolean; busy: boolean; onChecked: () => void }): Updater {
  const [phase, setPhase] = useState<UpdatePhase>("idle");
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [ready, setReady] = useState<UpdateReady | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const op = useRef<string | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const onCheckedRef = useRef(onChecked);
  onCheckedRef.current = onChecked;

  useEffect(() => {
    const off = on<UpdateProgress>("update-progress", (p) => {
      if (p.op_id !== op.current) return;
      setProgress(p.total ? p.downloaded / p.total : null);
    });
    return () => { void off.then((f) => f()); };
  }, []);

  const download = useCallback(async (background = false) => {
    if (phaseRef.current === "downloading" || phaseRef.current === "ready" || phaseRef.current === "applying") return;
    const id = opId();
    op.current = id;
    setPhase("downloading"); setProgress(0); setError(null);
    try {
      setReady(await api.updateDownload(id, background));
      setPhase("ready");
      setDismissed(false);
    } catch (e) {
      const code = toApiError(e).code;
      if (background && code === "update_busy") {
        setPhase("available");
        setTimeout(() => void download(true), BUSY_RETRY_MS);
      } else {
        setError(code); setPhase("error");
      }
    } finally {
      op.current = null;
    }
  }, []);

  const check = useCallback(async (manual: boolean) => {
    if (phaseRef.current === "downloading" || phaseRef.current === "applying") return null;
    if (phaseRef.current === "ready") return status;
    setPhase("checking"); setError(null);
    try {
      const result = await api.updateCheck();
      setStatus(result);
      setPhase(result.available ? "available" : "latest");
      if (shouldAutoDownload(result, manual)) void download(true);
      return result;
    } catch (e) {
      setError(toApiError(e).code); setPhase("error");
      return null;
    } finally {
      onCheckedRef.current();
    }
  }, [download, status]);

  // Automatic mode: no timers at all when it is off.
  useEffect(() => scheduleAutoChecks(auto, () => void check(false)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [auto]);

  const apply = useCallback(async () => {
    if (busyRef.current) { setError("update_busy"); return; }
    setPhase("applying"); setError(null);
    try {
      await api.updateApply();
      // Desktop restarts the app; Android hands over to the system installer and comes back.
      setPhase("ready");
    } catch (e) {
      setError(toApiError(e).code); setPhase("ready");
    }
  }, []);

  return { phase, status, ready, progress, error, auto, check, download: () => download(false), apply, dismissed, dismiss: () => setDismissed(true) };
}
