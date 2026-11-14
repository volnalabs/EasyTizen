import { ArrowLeft, History, KeyRound, Rocket, Settings as Cog, Tv2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppContext, type AppCtx, type Page } from "./app/context";
import { Logo } from "./components/Logo";
import { IconButton, Pill, ToastProvider } from "./components/ui";
import { CertificatesPage } from "./features/CertificatesPage";
import { DevicesPage } from "./features/DevicesPage";
import { HistoryPage } from "./features/HistoryPage";
import { InstallPage } from "./features/InstallPage";
import { Onboarding } from "./features/Onboarding";
import { SettingsPage } from "./features/SettingsPage";
import { UpdateBanner } from "./features/updates/UpdateBanner";
import { useUpdater } from "./features/updates/useUpdater";
import { I18nProvider, useI18n } from "./hooks/i18n";
import type { Key } from "./i18n";
import { api, isDemo } from "./services/api";
import type { AppInfo, Settings, ToolchainStatus, TvInfo } from "./types";

function useResolvedTheme(pref: Settings["theme"]): "light" | "dark" {
  const [sys, setSys] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const on = (e: MediaQueryListEvent) => setSys(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return pref === "system" ? (sys ? "dark" : "light") : pref;
}

type NavItem = { page: Page; icon: typeof Tv2; label: Key };
const NAV: NavItem[] = [
  { page: "install", icon: Rocket, label: "navInstall" },
  { page: "tvs", icon: Tv2, label: "navTvs" },
  { page: "certs", icon: KeyRound, label: "navCerts" },
  { page: "history", icon: History, label: "navHistory" },
  { page: "settings", icon: Cog, label: "navSettings" },
];
/** Phones: four tabs. History opens from the top bar (and after an installation). */
const TABS = NAV.filter((n) => n.page !== "history");

function Shell({ info, settings, refresh }: { info: AppInfo; settings: Settings; refresh: () => Promise<void> }) {
  const { t, lang } = useI18n();
  const [page, setPage] = useState<Page>("install");
  const [previous, setPrevious] = useState<Page>("install");
  const [tool, setTool] = useState<ToolchainStatus | null>(null);
  const [tv, setTv] = useState<TvInfo | null>(null);
  const [wizard, setWizard] = useState(!settings.onboarding_done);
  const [busyKeys, setBusyKeys] = useState<string[]>([]);
  const theme = useResolvedTheme(settings.theme);
  const usesSdk = !info.mobile && settings.engine === "sdk";
  const busy = busyKeys.length > 0;

  const reloadTool = useCallback(() => { if (!info.mobile) void api.toolchainStatus().then(setTool).catch(() => setTool(null)); }, [info.mobile]);
  useEffect(reloadTool, [reloadTool, settings.sdk_path, settings.engine]);
  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    const touch = info.mobile || window.matchMedia("(pointer: coarse)").matches;
    if (touch) document.documentElement.dataset.touch = ""; else delete document.documentElement.dataset.touch;
  }, [info.mobile]);

  const setBusy = useCallback((key: string, active: boolean) => setBusyKeys((k) => (active ? (k.includes(key) ? k : [...k, key]) : k.filter((x) => x !== key))), []);
  const updater = useUpdater({ auto: settings.check_updates, busy, onChecked: () => void refresh() });
  const go = useCallback((p: Page) => { setPage((current) => { if (current !== p) setPrevious(current); return p; }); }, []);

  const toolsMissing = usesSdk && !!tool && !(tool.sdk_ready && tool.tv_extension_ready && tool.cli_ready && tool.node !== "missing");
  const ctx = useMemo<AppCtx>(() => ({ info, settings, refresh, tool, reloadTool, tv, setTv, go, toolsMissing, busy, setBusy, updater }),
    [info, settings, refresh, tool, reloadTool, tv, go, toolsMissing, busy, setBusy, updater]);

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex h-full">
        <aside className="safe-top hidden w-60 shrink-0 flex-col border-r border-line bg-surface md:flex" aria-label="EasyTizen">
          <div className="flex items-center gap-2.5 px-5 pt-5 pb-6"><Logo size={30} /><span className="text-title font-semibold tracking-[-0.01em]">EasyTizen</span></div>
          <nav className="flex flex-col gap-0.5 px-3">
            {NAV.map(({ page: p, icon: Icon, label }) => {
              const on = page === p;
              return (
                <button key={p} type="button" aria-current={on ? "page" : undefined} onClick={() => go(p)}
                  className={`flex min-h-9 items-center gap-3 rounded-control px-3 py-1.5 text-left transition-colors ${on ? "bg-accent-soft font-semibold text-accent-text" : "font-medium text-muted hover:bg-surface-2 hover:text-fg"}`}>
                  <Icon size={18} strokeWidth={on ? 2.1 : 1.8} aria-hidden className="shrink-0" /><span className="min-w-0">{t(label)}</span>
                </button>
              );
            })}
          </nav>
          <div className="mt-auto space-y-3 p-4">
            <div className="rounded-[12px] border border-line bg-surface-2/60 p-3">
              <p className="eyebrow">{t("sidebarTv")}</p>
              {tv ? (
                <div className="mt-1.5 flex items-start gap-2">
                  <span className="mt-[7px] h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden />
                  <div className="min-w-0">
                    <p className="font-semibold break-words">{tv.name}</p>
                    <p className="data text-caption text-muted">{tv.ip}</p>
                  </div>
                </div>
              ) : <p className="mt-1.5 text-small text-muted">{t("sidebarNoTv")}</p>}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-caption text-muted">
              <span>{t("version", { v: info.version })}</span>
              {isDemo && <Pill tone="warn">{t("demoShort")}</Pill>}
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <header className="safe-top safe-x border-b border-line bg-surface md:hidden">
            <div className="flex min-h-14 items-center gap-2 px-2">
              {page === "history" ? (
                <>
                  <IconButton label={t("back")} onClick={() => go(previous === "history" ? "install" : previous)}><ArrowLeft size={20} aria-hidden /></IconButton>
                  <span className="min-w-0 flex-1 truncate text-title font-semibold">{t("historyTitle")}</span>
                </>
              ) : (
                <>
                  <span className="flex min-w-0 flex-1 items-center gap-2.5 pl-2"><Logo size={28} /><span className="truncate text-title font-semibold tracking-[-0.01em]">EasyTizen</span></span>
                  {isDemo && <span title={t("demoBadge")}><Pill tone="warn">{t("demoShort")}</Pill></span>}
                  <IconButton label={t("navHistory")} onClick={() => go("history")}><History size={20} aria-hidden /></IconButton>
                </>
              )}
            </div>
          </header>
          <UpdateBanner onOpen={() => go("settings")} />
          <main className="safe-x min-h-0 flex-1 overflow-y-auto overflow-x-hidden" id="main">
            <div key={page} className="mx-auto w-full max-w-[50rem] px-4 pt-5 pb-10 sm:px-8 sm:pt-8 xl:max-w-[54rem]">
              {page === "install" && <InstallPage />}
              {page === "tvs" && <DevicesPage />}
              {page === "certs" && <CertificatesPage />}
              {page === "history" && <HistoryPage />}
              {page === "settings" && <SettingsPage onShowWizard={() => setWizard(true)} />}
            </div>
          </main>
          <nav className="safe-bottom safe-x border-t border-line bg-surface md:hidden" aria-label={t("navMain")}>
            <div className="grid grid-cols-4">
              {TABS.map(({ page: p, icon: Icon, label }) => {
                const on = page === p;
                return (
                  <button key={p} type="button" aria-current={on ? "page" : undefined} onClick={() => go(p)}
                    title={t(label)} className={`flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 px-px pt-2 pb-2 text-[0.6875rem] leading-tight tracking-[-0.02em] transition-colors ${on ? "font-semibold text-accent-text" : "font-medium text-muted"}`}>
                    <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${on ? "bg-accent-soft" : ""}`}><Icon size={20} strokeWidth={on ? 2.1 : 1.8} aria-hidden /></span>
                    <span className="w-full overflow-hidden text-center text-ellipsis whitespace-nowrap">{t(label)}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </div>
      </div>
      {wizard && <Onboarding onDone={() => { setWizard(false); go("install"); }} />}
    </AppContext.Provider>
  );
}

export default function App() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [info, setInfo] = useState<AppInfo | null>(null);
  const refresh = useCallback(() => api.getSettings().then(setSettings), []);
  useEffect(() => { void refresh(); void api.appInfo().then(setInfo); }, [refresh]);
  if (!settings || !info) return null;
  return (
    <I18nProvider pref={settings.language}>
      <ToastProvider>
        <Shell info={info} settings={settings} refresh={refresh} />
      </ToastProvider>
    </I18nProvider>
  );
}
