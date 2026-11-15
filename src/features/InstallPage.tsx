import { Check, CheckCircle2, Tv2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useApp } from "../app/context";
import { Button, CopyButton, DataList, IconTile, Notice, PageHeader, Pill, Row } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { api, toApiError } from "../services/api";
import type { ExtraChecks, OpenedPackage } from "../types";
import { InstallStep } from "./InstallStep";
import { PackageStep } from "./PackageStep";
import { TvFinder } from "./TvFinder";

type StepState = "done" | "current" | "locked";

/** Three-step overview: where the user is and what is left. */
function Stepper({ steps }: { steps: { title: string; status: string; state: StepState }[] }) {
  const { t } = useI18n();
  return (
    <ol className="mb-6 grid grid-cols-3 gap-2 sm:mb-8 sm:gap-3" aria-label={t("stepsLabel")}>
      {steps.map((s, i) => (
        <li key={s.title} aria-current={s.state === "current" ? "step" : undefined} className="min-w-0">
          <div className={`h-1 rounded-full transition-colors duration-300 ${s.state === "done" ? "bg-ok" : s.state === "current" ? "bg-accent" : "bg-surface-3"}`} />
          <p className={`mt-2 truncate text-caption font-semibold tracking-wide uppercase ${s.state === "locked" ? "text-faint" : s.state === "done" ? "text-ok" : "text-accent-text"}`}>{t("stepN", { n: i + 1 })}</p>
          <p title={s.title} className={`truncate text-small leading-snug font-medium ${s.state === "locked" ? "text-muted" : "text-fg"}`}>{s.title}</p>
          <p className="hidden truncate text-caption text-muted sm:block" title={s.status}>{s.status}</p>
        </li>
      ))}
    </ol>
  );
}

function StepCard({ n, title, state, status, children }: { n: number; title: string; state: StepState; status?: ReactNode; children: ReactNode }) {
  return (
    <section className={`card fade-up p-4 transition-opacity sm:p-6 ${state === "locked" ? "opacity-70" : ""}`} style={{ animationDelay: `${(n - 1) * 50}ms` }} aria-labelledby={`step-${n}`}>
      <header className="mb-4 flex items-center gap-3">
        <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-small font-semibold transition-colors ${state === "done" ? "bg-ok text-white dark:text-[#0b0c10]" : state === "current" ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted"}`} aria-hidden>
          {state === "done" ? <Check size={15} strokeWidth={2.75} /> : n}
        </span>
        <h2 id={`step-${n}`} className="min-w-0 flex-1 text-title font-semibold tracking-[-0.01em]">{title}</h2>
        {status}
      </header>
      {children}
    </section>
  );
}

export function InstallPage() {
  const { t } = useI18n();
  const { tv, setTv, settings } = useApp();
  const [pkg, setPkg] = useState<OpenedPackage | null>(null);
  const [installed, setInstalled] = useState(false);
  const [resign, setResign] = useState(true);
  const [checks, setChecks] = useState<{ result: ExtraChecks | null; loading: boolean; error: string | null }>({ result: null, loading: false, error: null });
  const alreadySigned = pkg?.report.signature === "signed_structure";
  const asIs = alreadySigned && !resign;

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

  const s1: StepState = tv ? "done" : "current";
  const s2: StepState = pkg ? "done" : "current";
  const s3: StepState = installed ? "done" : tv && pkg ? "current" : "locked";

  return (
    <div>
      <PageHeader title={t("installTitle")} subtitle={t("installSubtitle")} />
      <Stepper steps={[
        { title: t("step1"), status: tv ? tv.name : t("statusNotConnected"), state: s1 },
        { title: t("step2"), status: pkg ? (pkg.report.app_name ?? pkg.report.file_name) : t("statusNotChosen"), state: s2 },
        { title: t("step3"), status: installed ? t("installSuccessTitle") : tv && pkg ? t("statusReady") : t("statusWaiting"), state: s3 },
      ]} />
      <div className="space-y-4">
        <StepCard n={1} title={t("step1")} state={s1} status={tv ? <Pill tone="ok"><CheckCircle2 size={12} aria-hidden />{t("tvConnected")}</Pill> : undefined}>
          {tv ? (
            <div className="fade-up">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-3">
                <IconTile tone="ok"><Tv2 size={20} aria-hidden /></IconTile>
                <div className="min-w-0 flex-[1_1_10rem]">
                  <p className="text-emph font-semibold break-words">{tv.name}</p>
                  <p className="data text-small text-muted">{tv.ip}:{tv.port}</p>
                </div>
                <Button size="sm" onClick={() => { setTv(null); setInstalled(false); }}>{t("tvChange")}</Button>
              </div>
              <DataList className="mt-3 border-t border-line">
                {tv.model && <Row label={t("tvModel")}>{tv.model}</Row>}
                {tv.tizen_version && <Row label={t("tvTizen")}>Tizen {tv.tizen_version}</Row>}
                {tv.host_ip && <Row label={t("tvHostIp")} data>{tv.host_ip}</Row>}
                {tv.duid && <Row label={t("tvDuid")} data action={<CopyButton value={tv.duid} label={t("copyDuid")} />}>{tv.duid}</Row>}
              </DataList>
              {!tv.duid && <div className="mt-3"><Notice tone="warn">{t("tvNoDuid")}</Notice></div>}
            </div>
          ) : <TvFinder onConnected={setTv} />}
        </StepCard>
        <StepCard n={2} title={t("step2")} state={s2}>
          <PackageStep pkg={pkg} onPackage={(p) => { setPkg(p); setInstalled(false); setResign(true); }} checks={checks.result} checksLoading={checks.loading} checksError={checks.error} />
        </StepCard>
        <StepCard n={3} title={t("step3")} state={s3}>
          {tv && pkg
            ? <InstallStep key={`${tv.ip}-${pkg.path}`} tv={tv} pkg={pkg} resign={resign} onResign={setResign} checks={checks.result} checksLoading={checks.loading}
                onReset={() => { setPkg(null); setInstalled(false); }} onInstalled={() => setInstalled(true)} />
            : <p className="text-muted">{!tv ? t("installNeedTv") : t("installNeedApp")}</p>}
        </StepCard>
      </div>
    </div>
  );
}
