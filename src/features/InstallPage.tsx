import { Check, CheckCircle2, ChevronRight, CircleHelp, CircleSlash, Tv2, XCircle } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useApp } from "../app/context";
import { HostIpCard } from "../components/HostIpCard";
import { Button, CopyButton, DataList, Details, Modal, PageHeader, Row, StatusDot, useMediaQuery } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import type { Key } from "../i18n";
import { formatDate } from "../lib/format";
import { installSteps, type StepState } from "../lib/steps";
import { isTizenProfile, prefersOriginalSignature, prefersTizenCertificate, profileFitsTv } from "../lib/tv";
import { api, toApiError } from "../services/api";
import type { ExtraChecks, HistoryEntry, OpenedPackage, TvInfo } from "../types";
import { DevModeGuide } from "./DevModeGuide";
import { InstallStep } from "./InstallStep";
import { PackageStep } from "./PackageStep";
import { SignStep } from "./SignStep";
import { TvFinder } from "./TvFinder";

function StepMark({ n, state }: { n: number; state: StepState }) {
  const look = {
    done: "bg-ok text-white dark:text-[#06150e]",
    current: "bg-accent text-accent-ink ring-4 ring-accent-soft",
    open: "bg-fill-2 text-fg",
    attention: "bg-err-soft text-err",
    locked: "bg-fill text-faint",
  }[state];
  return (
    <span aria-hidden className={`data grid h-8 w-8 shrink-0 place-items-center rounded-full text-small font-semibold transition-[background-color,color,box-shadow] duration-300 ${look}`}>
      {state === "done" ? <Check size={16} strokeWidth={2.75} className="pop-in" /> : state === "attention" ? "!" : n}
    </span>
  );
}

/** One step of the installation: a mark on the rail, a title, and its panel. */
function FlowStep({ n, title, state, last, panel = true, children }: { n: number; title: string; state: StepState; last?: boolean; panel?: boolean; children: ReactNode }) {
  const { t } = useI18n();
  const boxed = panel && state !== "locked";
  return (
    <li className="relative pb-7 last:pb-0" aria-current={state === "current" ? "step" : undefined} aria-labelledby={`step-${n}`}>
      {!last && <span aria-hidden className={`absolute start-[0.9375rem] top-11 bottom-3 hidden w-0.5 rounded-full transition-colors duration-500 sm:block ${state === "done" ? "bg-ok/35" : "bg-fill-2"}`} />}
      <div className="flex min-h-8 items-center gap-3">
        <StepMark n={n} state={state} />
        <h2 id={`step-${n}`} className={`min-w-0 text-emph font-semibold tracking-[-0.01em] ${state === "locked" ? "text-muted" : ""}`}>
          {title}<span className="sr-only"> — {t(`stepState_${state}` as Key)}</span>
        </h2>
      </div>
      <div className={`mt-3 sm:ms-11 ${boxed ? "panel p-4 sm:p-5" : ""}`}>{children}</div>
    </li>
  );
}

function TvSummary({ tv, locked, onChange }: { tv: TvInfo; locked: boolean; onChange: () => void }) {
  const { t } = useI18n();
  return (
    <div className="@container fade-up">
      <div className="flex items-center gap-3">
        <span className="relative hidden h-11 w-11 shrink-0 place-items-center rounded-[12px] bg-ok-soft text-ok @[19rem]:grid">
          <Tv2 size={20} aria-hidden /><StatusDot tone="ok" live className="absolute -end-0.5 -top-0.5 ring-2 ring-surface" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-emph font-semibold break-words">{tv.name}</p>
          <p className="text-small text-muted"><span className="data whitespace-nowrap">{tv.ip}</span>{tv.tizen_version && <> · <span className="whitespace-nowrap">Tizen {tv.tizen_version}</span></>}</p>
        </div>
        <Button size="sm" disabled={locked} onClick={onChange}>{t("tvChange")}</Button>
      </div>
      <Details label={t("tvDetails")} inline className="mt-2">
        <div>
          <DataList>
            <Row label={t("tvAddress")} data>{tv.ip}:{tv.port}</Row>
            {tv.model && <Row label={t("tvModel")}>{tv.model}</Row>}
            {tv.tizen_version && <Row label={t("tvTizen")}>Tizen {tv.tizen_version}</Row>}
            {tv.host_ip && <Row label={t("tvHostIp")} data>{tv.host_ip}</Row>}
            {tv.duid && <Row label={t("tvDuid")} data action={<CopyButton value={tv.duid} label={t("copyDuid")} />}>{tv.duid}</Row>}
          </DataList>
        </div>
      </Details>
    </div>
  );
}

/** Wide screens: what the TV needs, and the last few installations. */
function InstallAside({ refreshKey }: { refreshKey: number }) {
  const { t, lang } = useI18n();
  const { go } = useApp();
  const [recent, setRecent] = useState<HistoryEntry[] | null>(null);
  const [guide, setGuide] = useState(false);
  useEffect(() => { void api.getHistory().then((h) => setRecent(h.slice(0, 4))).catch(() => setRecent([])); }, [refreshKey]);
  return (
    <aside className="sticky top-8 space-y-6" aria-label={t("asideLabel")}>
      <HostIpCard framed />
      <Button variant="link" size="sm" className="-mt-3 -ms-1" onClick={() => setGuide(true)} icon={<CircleHelp size={16} aria-hidden />}>{t("tvHelp")}</Button>
      <section aria-labelledby="recent-title">
        <div className="mb-2.5 flex items-center justify-between gap-2 px-1">
          <h2 id="recent-title" className="eyebrow">{t("recentTitle")}</h2>
          {recent && recent.length > 0 && <button type="button" onClick={() => go("history")} className="inline-flex items-center gap-0.5 rounded-[6px] text-small font-medium text-accent-text hover:underline">{t("recentAll")}<ChevronRight size={14} aria-hidden /></button>}
        </div>
        {recent && recent.length === 0 && <p className="px-1 text-small text-muted">{t("recentEmpty")}</p>}
        {recent && recent.length > 0 && (
          <ul className="panel m-0 list-none divide-y divide-line p-0">
            {recent.map((e, i) => {
              const Icon = e.result === "success" ? CheckCircle2 : e.result === "failed" ? XCircle : CircleSlash;
              return (
                <li key={`${e.time}-${i}`} className="flex gap-3 px-4 py-3">
                  <Icon size={17} className={`mt-0.5 shrink-0 ${e.result === "success" ? "text-ok" : e.result === "failed" ? "text-err" : "text-muted"}`} aria-label={t(`result_${e.result}` as Key)} />
                  <div className="min-w-0">
                    <p className="font-medium break-words">{e.app_name ?? e.file_name}</p>
                    <p className="text-caption text-muted"><span className="break-words">{e.tv_name}</span> · {formatDate(e.time, lang, true)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {guide && <Modal title={t("devTitle")} onClose={() => setGuide(false)} wide><DevModeGuide /></Modal>}
    </aside>
  );
}

export function InstallPage() {
  const { t } = useI18n();
  const { tv, setTv, settings, busy } = useApp();
  const wide = useMediaQuery("(min-width: 80rem)");
  const [pkg, setPkg] = useState<OpenedPackage | null>(null);
  const [installed, setInstalled] = useState(0);
  const [resign, setResign] = useState(true);
  const [profile, setProfile] = useState("");
  const [checks, setChecks] = useState<{ result: ExtraChecks | null; loading: boolean; error: string | null }>({ result: null, loading: false, error: null });
  const done = installed > 0;
  const alreadySigned = pkg?.report.signature === "signed_structure";
  const asIs = alreadySigned && !resign;
  const willSign = resign || !alreadySigned;
  const tizenFirst = prefersTizenCertificate(tv?.tizen_version);

  // Default for "sign with my certificate": the TV's Tizen version decides.
  useEffect(() => {
    if (pkg) setResign(!prefersOriginalSignature(tv?.tizen_version, pkg.report.signature === "signed_structure"));
  }, [pkg, tv?.tizen_version]);

  // Certificates that can sign for this TV; on TVs before Tizen 7 the Tizen certificate comes first.
  const profiles = useMemo(
    () => (tv ? settings.certificate_profiles.filter((p) => profileFitsTv(p, tv))
      .sort((a, b) => (Number(isTizenProfile(b)) - Number(isTizenProfile(a))) * (tizenFirst ? 1 : -1)) : []),
    [settings.certificate_profiles, tv, tizenFirst],
  );
  const legacy = useMemo(
    () => !!tv?.duid && settings.certificate_profiles.some((p) => p.engine === "sdk" && p.duids.some((d) => d.toLowerCase() === tv.duid!.toLowerCase())),
    [settings.certificate_profiles, tv?.duid],
  );
  useEffect(() => {
    if (!profiles.some((p) => p.name === profile)) setProfile(profiles[0]?.name ?? "");
  }, [profiles, profile]);

  // Additional checks for the chosen package; re-run when "sign with my certificate" or the
  // setting changes. Mandatory file safety already ran when the file was opened.
  useEffect(() => {
    if (!pkg) { setChecks({ result: null, loading: false, error: null }); return; }
    let live = true;
    setChecks((c) => ({ ...c, loading: true, error: null }));
    api.verifyPackage(pkg.path, asIs)
      .then((result) => live && setChecks({ result, loading: false, error: null }))
      .catch((e) => live && setChecks({ result: null, loading: false, error: toApiError(e).code }));
    return () => { live = false; };
  }, [pkg, asIs, settings.extra_package_checks]);

  const blocked = !!checks.result?.enabled && checks.result.findings.some((f) => f.blocking);
  const chosen = profiles.find((p) => p.name === profile);
  const needsDuid = willSign && !!tv && !tv.duid && !tizenFirst;
  const signReady = !willSign || (!!chosen && (isTizenProfile(chosen) || !!tv?.duid));
  const { tv: s1, app: s2, sign: s3, install: s4, ready } = installSteps({ tv: !!tv, pkg: !!pkg, blocked: blocked || !!checks.error, needsDuid, signReady, installed: done });
  const waiting = !tv ? t("installNeedTv") : !pkg ? t("installNeedApp") : blocked || checks.error ? t("installBlocked") : t("installNeedCert");

  return (
    <div>
      <PageHeader title={t("installTitle")} subtitle={t("installSubtitle")} />
      <div className="xl:grid xl:grid-cols-[minmax(0,1fr)_19rem] xl:items-start xl:gap-10">
        <ol className="m-0 list-none p-0" aria-label={t("stepsLabel")}>
          <FlowStep n={1} title={t("step1")} state={s1}>
            {tv ? <TvSummary tv={tv} locked={busy} onChange={() => { setTv(null); setInstalled(0); }} />
              : <TvFinder onConnected={setTv} showHostIp={!wide} />}
          </FlowStep>
          <FlowStep n={2} title={t("step2")} state={s2} panel={!!pkg}>
            <PackageStep pkg={pkg} locked={busy} onPackage={(p) => { setPkg(p); setInstalled(0); }} checks={checks.result} checksLoading={checks.loading} checksError={checks.error} />
          </FlowStep>
          <FlowStep n={3} title={t("step3")} state={s3}>
            {tv && pkg ? <SignStep tv={tv} alreadySigned={alreadySigned} resign={resign} onResign={setResign} profiles={profiles} profile={profile} onProfile={setProfile} legacy={legacy} tizenFirst={tizenFirst} locked={busy} />
              : <p className="text-small text-muted">{t("signNeedBoth")}</p>}
          </FlowStep>
          <FlowStep n={4} title={t("step4")} state={s4} last>
            {tv && pkg
              ? <InstallStep key={`${tv.ip}-${pkg.path}`} tv={tv} pkg={pkg} ready={ready || done} waiting={waiting} willSign={willSign} profile={profile} alreadySigned={alreadySigned}
                  checks={checks.result} checksLoading={checks.loading} onResign={setResign}
                  onReset={() => { setPkg(null); setInstalled(0); }} onInstalled={() => setInstalled((n) => n + 1)} />
              : <p className="text-small text-muted">{waiting}</p>}
          </FlowStep>
        </ol>
        {wide && <InstallAside refreshKey={installed} />}
      </div>
    </div>
  );
}
