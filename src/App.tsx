import { ArrowLeft, History, KeyRound, Rocket, Settings as Cog, Tv2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppContext, useApp, type AppCtx, type Page } from "./app/context";
import { Logo } from "./components/Logo";
import { IconButton, Pill, StatusDot, ToastProvider } from "./components/ui";
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
import type { AppInfo, Settings, TvInfo } from "./types";

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

/** True while a text field has focus on a touch device: the on-screen keyboard is up, so the dock steps aside. */
function useKeyboardOpen(touch: boolean): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!touch) return;
    const check = () => {
      const el = document.activeElement as HTMLElement | null;
      setOpen(!!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && !["checkbox", "radio", "button"].includes((el as HTMLInputElement).type))));
    };
    const later = () => window.setTimeout(check, 0);
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", later);
    return () => { document.removeEventListener("focusin", check); document.removeEventListener("focusout", later); };
  }, [touch]);
  return open;
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

/** Reading width for single-column pages; the install, TV and certificate pages widen where they use two columns. */
const WIDTH: Record<Page, string> = {
  install: "max-w-[46rem] xl:max-w-none",
  tvs: "max-w-[46rem] lg:max-w-none",
  certs: "max-w-[46rem] lg:max-w-none",
  history: "max-w-[46rem]",
  settings: "max-w-[46rem]",
};

function Sidebar({ page, go, tv }: { page: Page; go: (p: Page) => void; tv: TvInfo | null }) {
  const { t } = useI18n();
  return (
    <aside className="safe-top hidden w-[16.5rem] shrink-0 flex-col border-e border-line lg:flex" aria-label="EasyTizen">
      <div className="flex items-center gap-3 px-5 pt-6 pb-7"><Logo size={32} /><span className="text-title font-semibold tracking-[-0.02em]">EasyTizen</span></div>
      <nav className="flex flex-col gap-1 px-3" aria-label={t("navMain")}>
        {NAV.map(({ page: p, icon: Icon, label }) => {
          const on = page === p;
          return (
            <button key={p} type="button" aria-current={on ? "page" : undefined} onClick={() => go(p)}
              className={`flex min-h-10 items-center gap-3 rounded-control px-3 text-start transition-[background-color,color,box-shadow] duration-150 ${on ? "bg-raised font-semibold text-fg shadow-raised" : "font-medium text-muted hover:bg-fill hover:text-fg"}`}>
              <Icon size={18} strokeWidth={on ? 2.2 : 1.9} aria-hidden className={`shrink-0 ${on ? "text-accent-text" : ""}`} /><span className="min-w-0">{t(label)}</span>
            </button>
          );
        })}
      </nav>
      <div className="mt-auto space-y-3 p-4">
        <button type="button" onClick={() => go(tv ? "tvs" : "install")} className="row-btn block w-full rounded-[14px] border border-line bg-surface p-3.5 text-start shadow-card">
          <span className="eyebrow flex items-center gap-2">
            <StatusDot tone={tv ? "ok" : "neutral"} live={!!tv} />{tv ? t("sidebarTvOn") : t("sidebarTv")}
          </span>
          {tv ? (
            <span className="mt-2 block min-w-0">
              <span className="block font-semibold break-words">{tv.name}</span>
              <span className="data block text-caption text-muted">{tv.ip}</span>
            </span>
          ) : <span className="mt-2 block text-small text-muted">{t("sidebarNoTv")}</span>}
        </button>
        <SidebarMeta />
      </div>
    </aside>
  );
}

function SidebarMeta() {
  const { t } = useI18n();
  const { info } = useApp();
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 text-caption text-muted">
      <span className="data">{t("version", { v: info.version })}</span>
      {isDemo && <span title={t("demoBadge")}><Pill tone="warn">{t("demoShort")}</Pill></span>}
    </div>
  );
}

/** Tablets and narrow windows: a navigation rail with all five sections. */
function Rail({ page, go, tv }: { page: Page; go: (p: Page) => void; tv: TvInfo | null }) {
  const { t } = useI18n();
  return (
    <aside className="safe-top safe-bottom hidden w-[6.5rem] shrink-0 flex-col items-center border-e border-line sm:flex lg:hidden" aria-label="EasyTizen">
      <div className="pt-5 pb-6"><Logo size={34} /></div>
      <nav className="flex w-full flex-col gap-2 px-1" aria-label={t("navMain")}>
        {NAV.map(({ page: p, icon: Icon, label }) => {
          const on = page === p;
          return (
            <button key={p} type="button" aria-current={on ? "page" : undefined} onClick={() => go(p)}
              className={`group flex min-h-14 flex-col items-center justify-center gap-1 rounded-control px-0.5 text-micro leading-tight ${on ? "font-semibold text-fg" : "font-medium text-muted hover:text-fg"}`}>
              <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors duration-200 ${on ? "bg-accent-soft text-accent-text" : "group-hover:bg-fill"}`}>
                <Icon size={20} strokeWidth={on ? 2.2 : 1.9} aria-hidden />
              </span>
              <span className="w-full text-center break-words">{t(label)}</span>
            </button>
          );
        })}
      </nav>
      <div className="mt-auto flex flex-col items-center gap-3 pb-5">
        <button type="button" onClick={() => go(tv ? "tvs" : "install")} title={tv ? `${tv.name} · ${tv.ip}` : t("sidebarNoTv")} aria-label={tv ? `${t("sidebarTvOn")}: ${tv.name}` : t("sidebarNoTv")}
          className="icon-btn relative">
          <Tv2 size={20} aria-hidden /><StatusDot tone={tv ? "ok" : "neutral"} live={!!tv} className="absolute end-1.5 top-1.5 ring-2 ring-bg" />
        </button>
        {isDemo && <span title={t("demoBadge")}><Pill tone="warn">{t("demoShort")}</Pill></span>}
      </div>
    </aside>
  );
}

/** Phones: a floating dock with four tabs and a sliding indicator. */
function Dock({ page, go, hidden }: { page: Page; go: (p: Page) => void; hidden: boolean }) {
  const { t } = useI18n();
  const index = TABS.findIndex((n) => n.page === page);
  if (hidden) return null;
  return (
    <nav className="safe-bottom safe-x shrink-0 sm:hidden" aria-label={t("navMain")}>
      <div className="px-1 pt-1.5 pb-2 min-[360px]:px-3">
        <div className="relative grid grid-cols-4 rounded-[22px] border border-line bg-[var(--dock)] p-0.5 shadow-raised backdrop-blur-md min-[360px]:p-1">
          <span aria-hidden className={`absolute top-0.5 bottom-0.5 left-0.5 w-[calc((100%-0.25rem)/4)] rounded-[18px] min-[360px]:top-1 min-[360px]:bottom-1 min-[360px]:left-1 min-[360px]:w-[calc((100%-0.5rem)/4)] bg-accent-soft transition-[transform,opacity] duration-[240ms] ease-[var(--ease-out)] ${index < 0 ? "opacity-0" : ""}`}
            style={{ transform: `translateX(${Math.max(0, index) * 100}%)` }} />
          {TABS.map(({ page: p, icon: Icon, label }) => {
            const on = page === p;
            return (
              <button key={p} type="button" aria-current={on ? "page" : undefined} onClick={() => go(p)}
                className={`relative flex min-h-14 min-w-0 flex-col items-center justify-center gap-[3px] rounded-[18px] px-0 text-micro leading-tight tracking-[-0.03em] transition-colors min-[360px]:tracking-[-0.02em] duration-200 active:scale-[0.96] ${on ? "font-semibold text-accent-text" : "font-medium text-muted"}`}>
                <Icon size={21} strokeWidth={on ? 2.2 : 1.9} aria-hidden className={`transition-transform duration-200 ${on ? "-translate-y-px" : ""}`} />
                <span className="w-full overflow-hidden text-center text-ellipsis whitespace-nowrap">{t(label)}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
}

function PhoneTopBar({ page, go, back, scrolled }: { page: Page; go: (p: Page) => void; back: () => void; scrolled: boolean }) {
  const { t } = useI18n();
  return (
    <header className={`safe-top safe-x shrink-0 border-b transition-colors duration-200 sm:hidden ${scrolled ? "border-line bg-surface" : "border-transparent bg-bg"}`}>
      <div className="flex min-h-14 items-center gap-1 px-2">
        {page === "history" ? (
          <>
            <IconButton label={t("back")} onClick={back}><ArrowLeft size={20} aria-hidden /></IconButton>
            <span className="min-w-0 flex-1 truncate ps-1 text-title font-semibold">{t("historyTitle")}</span>
          </>
        ) : (
          <>
            <span className="flex min-w-0 flex-1 items-center gap-2.5 ps-2"><Logo size={28} /><span className="truncate text-title font-semibold tracking-[-0.02em]">EasyTizen</span></span>
            {isDemo && <span title={t("demoBadge")}><Pill tone="warn">{t("demoShort")}</Pill></span>}
            <IconButton label={t("navHistory")} onClick={() => go("history")}><History size={20} aria-hidden /></IconButton>
          </>
        )}
      </div>
    </header>
  );
}

function Shell({ info, settings, refresh }: { info: AppInfo; settings: Settings; refresh: () => Promise<void> }) {
  const { lang } = useI18n();
  const [page, setPage] = useState<Page>("install");
  const [previous, setPrevious] = useState<Page>("install");
  const [tv, setTv] = useState<TvInfo | null>(null);
  const [hostIp, setHostIp] = useState<string | null>(info.host_ip);
  const [wizard, setWizard] = useState(!settings.onboarding_done);
  const [busyKeys, setBusyKeys] = useState<string[]>([]);
  const [scrolled, setScrolled] = useState(false);
  const main = useRef<HTMLElement>(null);
  const theme = useResolvedTheme(settings.theme);
  const busy = busyKeys.length > 0;
  const touch = info.mobile || window.matchMedia("(pointer: coarse)").matches;
  const keyboard = useKeyboardOpen(touch);

  // The phone may have joined another Wi-Fi network while the app was in the background.
  useEffect(() => {
    const reload = () => { if (document.visibilityState === "visible") void api.networkInfo().then((n) => setHostIp(n.host_ip)).catch(() => undefined); };
    document.addEventListener("visibilitychange", reload);
    window.addEventListener("focus", reload);
    return () => { document.removeEventListener("visibilitychange", reload); window.removeEventListener("focus", reload); };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#0d0e11" : "#f4f4f1");
  }, [theme]);
  useEffect(() => { document.documentElement.lang = lang; }, [lang]);
  useEffect(() => {
    if (touch) document.documentElement.dataset.touch = ""; else delete document.documentElement.dataset.touch;
  }, [touch]);

  const setBusy = useCallback((key: string, active: boolean) => setBusyKeys((k) => (active ? (k.includes(key) ? k : [...k, key]) : k.filter((x) => x !== key))), []);
  const updater = useUpdater({ auto: settings.check_updates, busy, onChecked: () => void refresh() });
  const go = useCallback((p: Page) => {
    setPage((current) => { if (current !== p) setPrevious(current); return p; });
    main.current?.scrollTo({ top: 0 });
  }, []);

  const ctx = useMemo<AppCtx>(() => ({ info, settings, refresh, hostIp, tv, setTv, go, busy, setBusy, updater }),
    [info, settings, refresh, hostIp, tv, go, busy, setBusy, updater]);

  return (
    <AppContext.Provider value={ctx}>
      <div className="flex h-full">
        <Sidebar page={page} go={go} tv={tv} />
        <Rail page={page} go={go} tv={tv} />
        <div className="flex min-w-0 flex-1 flex-col">
          <PhoneTopBar page={page} go={go} back={() => go(previous === "history" ? "install" : previous)} scrolled={scrolled} />
          <UpdateBanner onOpen={() => go("settings")} />
          <main ref={main} className="safe-x min-h-0 flex-1 overflow-x-hidden overflow-y-auto" id="main" onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
            {/* Every page starts at the same left edge, so titles do not jump between sections. */}
            <div key={page} className="page-in mx-auto w-full max-w-[74rem] px-4 pt-3 pb-10 sm:px-8 sm:pt-8 lg:px-10 lg:pt-10">
              <div className={WIDTH[page]}>
              {page === "install" && <InstallPage />}
              {page === "tvs" && <DevicesPage />}
              {page === "certs" && <CertificatesPage />}
              {page === "history" && <HistoryPage />}
              {page === "settings" && <SettingsPage onShowWizard={() => setWizard(true)} />}
              </div>
            </div>
          </main>
          <Dock page={page} go={go} hidden={keyboard} />
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
