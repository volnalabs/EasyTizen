import { ArrowRight, CircleHelp, Search, Tv2, WifiOff } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useApp } from "../app/context";
import { DiagnosisPanel } from "../components/DiagnosisPanel";
import { HostIpCard } from "../components/HostIpCard";
import { Button, Modal, Pill, Progress, StatusDot } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { looksLikeIpv4, opId } from "../lib/format";
import { mergeTvs, STATUS_TONE, statusKey, type ListedTv } from "../lib/tv";
import { api, on, toApiError } from "../services/api";
import type { Diagnosis, FoundTv, TvCheck, TvInfo } from "../types";
import { DevModeGuide } from "./DevModeGuide";

/** `at` says which action failed, so the explanation appears next to it. */
interface Problem { d: Diagnosis; technical: string | null; hostIp: string | null; check: TvCheck | null; at: "scan" | "list" | "manual" }

/** After this long a search gets a reassuring hint: large networks take a while. */
const SLOW_SEARCH_MS = 7000;

function TvRow({ tv, busy, connecting, onConnect }: { tv: ListedTv; busy: boolean; connecting: boolean; onConnect: () => void }) {
  const { t } = useI18n();
  const ready = tv.status === "ready";
  const details = [tv.model, tv.tizen ? `Tizen ${tv.tizen}` : null].filter(Boolean).join(" · ");
  return (
    <li className="fade-up flex flex-wrap items-center gap-x-3 gap-y-2 py-3">
      <span className={`relative hidden h-10 w-10 shrink-0 self-start place-items-center rounded-[11px] @[20rem]:grid ${ready ? "bg-ok-soft text-ok" : "bg-fill text-muted"}`}>
        <Tv2 size={19} aria-hidden />
        {tv.live && <StatusDot tone={ready ? "ok" : "warn"} className="absolute -end-0.5 -top-0.5 ring-2 ring-surface" />}
      </span>
      <div className="min-w-0 flex-[1_1_8rem]">
        <p className="leading-snug font-semibold break-words">{tv.name ?? t("tvUnnamed")}</p>
        <p className="mt-0.5 text-caption text-muted">
          <span className="data whitespace-nowrap">{tv.ip}</span>
          {details && <span className="break-words"> · {details}</span>}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5 empty:hidden">
          {tv.status && <Pill tone={STATUS_TONE[tv.status]}>{t(statusKey(tv.status))}</Pill>}
          {tv.saved && tv.live && <Pill tone="neutral">{t("tvSaved")}</Pill>}
        </div>
      </div>
      <Button size="sm" variant={ready ? "primary" : "secondary"} busy={connecting} disabled={busy} onClick={onConnect} aria-label={`${t("tvConnect")}: ${tv.name ?? tv.ip}`}>
        {connecting ? t("tvConnecting") : ready || !tv.status ? t("tvConnect") : t("tvCheckAgain")}
      </Button>
    </li>
  );
}

/** Search the network, connect by address, or pick a saved TV — and connect to it. */
export function TvFinder({ onConnected, showSaved = true, showHostIp = true }: { onConnected: (tv: TvInfo) => void; showSaved?: boolean; showHostIp?: boolean }) {
  const { t } = useI18n();
  const { settings, refresh } = useApp();
  const [found, setFound] = useState<FoundTv[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [slow, setSlow] = useState(false);
  const [scanFraction, setScanFraction] = useState<number | null>(null);
  const [connectingKey, setConnectingKey] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [guide, setGuide] = useState(false);
  const op = useRef<string | null>(null);
  const ipId = useId();

  useEffect(() => {
    const offProgress = on<{ op_id: string | null; fraction: number }>("scan-progress", (p) => { if (p.op_id === op.current) setScanFraction(p.fraction); });
    // TVs appear in the list as soon as they are confirmed, not only when the search ends.
    const offFound = on<{ op_id: string | null; device: FoundTv }>("scan-found", (p) => {
      if (p.op_id !== op.current) return;
      setFound((list) => [...(list ?? []).filter((d) => d.ip !== p.device.ip), p.device]);
    });
    return () => { void offProgress.then((f) => f()); void offFound.then((f) => f()); };
  }, []);
  useEffect(() => {
    if (!scanning) { setSlow(false); return; }
    const id = window.setTimeout(() => setSlow(true), SLOW_SEARCH_MS);
    return () => window.clearTimeout(id);
  }, [scanning]);

  const entries = useMemo(() => mergeTvs(settings.devices, found, showSaved), [settings.devices, found, showSaved]);

  const scan = useCallback(async () => {
    const id = opId();
    op.current = id;
    setScanning(true); setProblem(null); setScanFraction(null); setFound([]);
    try {
      const r = await api.scanTvs(id);
      if (r.ok && r.data) setFound(r.data.devices);
      else if (r.diagnosis && r.diagnosis !== "cancelled") setProblem({ d: r.diagnosis, technical: r.technical, hostIp: null, check: null, at: "scan" });
    } catch (e) {
      const code = toApiError(e).code;
      if (code !== "cancelled") setProblem({ d: "unknown", technical: code, hostIp: null, check: null, at: "scan" });
    } finally {
      setScanning(false); op.current = null;
    }
  }, []);

  const connect = useCallback(async (ip: string, port: number | null, at: Problem["at"]) => {
    const id = opId();
    op.current = id;
    setConnectingKey(`${ip}:${port ?? ""}`); setProblem(null);
    try {
      const r = await api.connectTv(ip, port, id);
      if (r.ok && r.data) {
        await refresh();
        onConnected(r.data);
      } else if (r.diagnosis && r.diagnosis !== "cancelled") {
        setProblem({ d: r.diagnosis, technical: r.technical, hostIp: r.host_ip, check: r.check, at });
      }
    } catch (e) {
      const code = toApiError(e).code;
      if (code === "invalid_ip" || code === "forbidden_ip") setManualError(true);
      else if (code !== "cancelled") setProblem({ d: "unknown", technical: code, hostIp: null, check: null, at });
    } finally {
      setConnectingKey(null); op.current = null;
    }
  }, [onConnected, refresh]);

  const submitManual = () => {
    if (!looksLikeIpv4(manual)) { setManualError(true); return; }
    setManualError(false);
    void connect(manual.trim(), null, "manual");
  };
  const busy = scanning || !!connectingKey;
  const nothingFound = found !== null && !scanning && !problem && !entries.some((e) => e.live);
  const live = entries.filter((e) => e.live);
  const saved = entries.filter((e) => !e.live);
  const manualKey = `${manual.trim()}:`;

  return (
    <div className="@container space-y-4">
      {showHostIp && <HostIpCard />}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" busy={scanning} disabled={!!connectingKey} onClick={scan} icon={<Search size={16} aria-hidden />} className="flex-[1_1_12rem] @[34rem]:flex-none">
          {scanning ? t("tvFinding") : found ? t("tvFindAgain") : t("tvFind")}
        </Button>
        {busy && <Button variant="ghost" onClick={() => op.current && void api.cancel(op.current)}>{t("cancel")}</Button>}
      </div>
      {scanning && (
        <div className="space-y-1.5" aria-live="polite">
          <Progress value={scanFraction} label={t("tvFinding")} size="sm" />
          {slow && <p className="fade-in text-caption text-muted">{t("tvFindingSlow")}</p>}
        </div>
      )}

      {live.length > 0 && (
        <div>
          <p className="eyebrow">{t("tvFoundTitle")}</p>
          <ul className="m-0 list-none divide-y divide-line p-0" aria-label={t("tvFoundTitle")} aria-live="polite">
            {live.map((e) => <TvRow key={`${e.ip}:${e.port}`} tv={e} busy={busy} connecting={connectingKey === `${e.ip}:${e.port}`} onConnect={() => void connect(e.ip, e.port, "list")} />)}
          </ul>
        </div>
      )}
      {nothingFound && (
        <div className="fade-up rounded-[14px] bg-fill p-4 text-small" role="status">
          <p className="flex items-center gap-2 font-semibold"><WifiOff size={16} className="shrink-0 text-muted" aria-hidden />{t("tvNoneFoundTitle")}</p>
          <ul className="m-0 mt-2 list-disc space-y-1 ps-5 text-muted marker:text-faint">
            <li>{t("tvNoneFound1")}</li>
            <li>{t("tvNoneFound2")}</li>
            <li>{t("tvNoneFound3")}</li>
          </ul>
        </div>
      )}
      {problem?.at === "scan" && <DiagnosisPanel diagnosis={problem.d} technical={problem.technical} hostIp={problem.hostIp} check={problem.check} />}

      {saved.length > 0 && (
        <div>
          <p className="eyebrow">{t("tvSavedShort")}</p>
          <ul className="m-0 list-none divide-y divide-line p-0" aria-label={t("tvSavedShort")}>
            {saved.map((e) => <TvRow key={`${e.ip}:${e.port}`} tv={e} busy={busy} connecting={connectingKey === `${e.ip}:${e.port}`} onConnect={() => void connect(e.ip, e.port, "list")} />)}
          </ul>
        </div>
      )}

      {problem?.at === "list" && <DiagnosisPanel diagnosis={problem.d} technical={problem.technical} hostIp={problem.hostIp} check={problem.check} />}

      <form className="border-t border-line pt-4" onSubmit={(e) => { e.preventDefault(); submitManual(); }}>
        <label htmlFor={ipId} className="mb-1.5 block text-small font-semibold">{t("tvIpLabel")}</label>
        <div className="flex flex-wrap gap-2">
          <input id={ipId} value={manual} onChange={(e) => { setManual(e.target.value); setManualError(false); }} placeholder={t("tvIpPlaceholder")}
            aria-invalid={manualError} aria-describedby={manualError ? `${ipId}-err` : undefined} inputMode="decimal" enterKeyHint="go" autoComplete="off" spellCheck={false}
            className="input data min-w-0 flex-[1_1_8rem]" />
          <Button type="submit" busy={connectingKey === manualKey} disabled={busy} aria-label={t("tvConnectByIp")}>
            {t("tvAddByIp")}{connectingKey !== manualKey && <ArrowRight size={16} aria-hidden />}
          </Button>
        </div>
        {manualError && <p id={`${ipId}-err`} role="alert" className="mt-1.5 text-small text-err">{t("tvInvalidIp")}</p>}
        {problem?.at === "manual" && <div className="mt-3"><DiagnosisPanel diagnosis={problem.d} technical={problem.technical} hostIp={problem.hostIp} check={problem.check} /></div>}
      </form>

      {showHostIp && <div><Button variant="link" size="sm" onClick={() => setGuide(true)} className="-ms-1" icon={<CircleHelp size={16} aria-hidden />}>{t("tvHelp")}</Button></div>}
      {guide && <Modal title={t("devTitle")} onClose={() => setGuide(false)} wide><DevModeGuide /></Modal>}
    </div>
  );
}
