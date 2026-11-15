import { createContext, useContext } from "react";
import type { Updater } from "../features/updates/useUpdater";
import type { AppInfo, Settings, TvInfo } from "../types";

export type Page = "install" | "tvs" | "certs" | "history" | "settings";

export interface AppCtx {
  info: AppInfo;
  settings: Settings;
  /** Reloads settings from the backend after something changed them. */
  refresh: () => Promise<void>;
  /** This device's current LAN address (the TV's "Host PC IP"); refreshed when the app returns to the foreground. */
  hostIp: string | null;
  /** TV confirmed connected in this session. */
  tv: TvInfo | null;
  setTv: (tv: TvInfo | null) => void;
  go: (page: Page) => void;
  /** An installation or certificate request is running: updates wait for it. */
  busy: boolean;
  setBusy: (key: string, active: boolean) => void;
  updater: Updater;
}

export const AppContext = createContext<AppCtx | null>(null);

export function useApp(): AppCtx {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppContext is missing");
  return ctx;
}
