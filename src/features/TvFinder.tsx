import { ArrowRight, CircleHelp, Search, Tv2 } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useApp } from "../app/context";
import { DiagnosisPanel } from "../components/DiagnosisPanel";
import { HostIpCard } from "../components/HostIpCard";
import { Button, Modal, Pill, Progress } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { looksLikeIpv4, opId } from "../lib/format";
import { mergeTvs, STATUS_TONE, statusKey } from "../lib/tv";
import { api, on, toApiError } from "../services/api";
import type { Diagnosis, FoundTv, TvCheck, TvInfo } from "../types";
import { DevModeGuide } from "./DevModeGuide";

interface Problem { d: Diagnosis; technical: string | null; hostIp: string | null; check: TvCheck | null }

/** Search the network, connect by address, or pick a saved TV — and connect to it. */
export function TvFinder({ onConnected, showSaved = true }: { onConnected: (tv: TvInfo) => void; showSaved?: boolean }) {
  const { t } = useI18n();
  const { settings, refresh } = useApp();
  const [found, setFound] = useState<FoundTv[] | null>(null);
  const [scanning, setScanning] = useState(false);
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

  const entries = useMemo(() => mergeTvs(settings.devices, found, showSaved), [settings.devices, found, showSaved]);

  const scan = useCallback(async () => {
    const id = opId();
    op.current = id;
    setScanning(true); setProblem(null); setScanFraction(null); setFound([]);
    try {
      const r = await api.scanTvs(id);
      if (r.ok && r.data) setFound(r.data.devices);
      else if (r.diagnosis && r.diagnosis !== "cancelled") setProblem({ d: r.diagnosis, technical: r.technical, hostIp: null, check: null });
    } catch (e) {
      const code = toApiError(e).code;
      if (code !== "cancelled") setProblem({ d: "unknown", technical: code, hostIp: null, check: null });
    } finally {
      setScanning(false); op.current = null;
    }
  }, []);

  const connect = useCallback(async (ip: string, port: number | null) => {
    const id = opId();
    op.current = id;
    setConnectingKey(`${ip}:${port ?? ""}`); setProblem(null);
    try {
      const r = await api.connectTv(ip, port, id);
      if (r.ok && r.data) {
        await refresh();
        onConnected(r.data);
      } else if (r.diagnosis && r.diagnosis !== "cancelled") {
        setProblem({ d: r.diagnosis, technical: r.technical, hostIp: r.host_ip, check: r.check });
      }
    } catch (e) {
      const code = toApiError(e).code;
      if (code === "invalid_ip" || code === "forbidden_ip") setManualError(true);
      else if (code !== "cancelled") setProblem({ d: "unknown", technical: code, hostIp: null, check: null });
    } finally {
      setConnectingKey(null); op.current = null;
    }
  }, [onConnected, refresh]);

  const submitManual = () => {
    if (!looksLikeIpv4(manual)) { setManualError(true); return; }
    setManualError(false);
    void connect(manual.trim(), null);
  };
  const busy = scanning || !!connectingKey;
  const nothingFound = found !== null && !scanning && !problem && !entries.some((e) => e.live);

  return (
    <div className="space-y-4">
      <HostIpCard />
      <div className="grid gap-x-4 gap-y-3 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-end">
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" busy={scanning} disabled={!!connectingKey} onClick={scan} className="max-sm:flex-1">{!scanning && <Search size={16} aria-hidden />}{scanning ? t("tvFinding") : t("tvFind")}</Button>
          {busy && <Button variant="ghost" onClick={() => op.current && void api.cancel(op.current)}>{t("cancel")}</Button>}
        </div>
        <form className="@container min-w-0" onSubmit={(e) => { e.preventDefault(); submitManual(); }}>
          <label htmlFor={ipId} className="mb-1.5 block text-small font-semibold sm:sr-only">{t("tvIpLabel")}</label>
          <div className="flex flex-col gap-2 @[19rem]:flex-row sm:justify-end">
            <input id={ipId} value={manual} onChange={(e) => { setManual(e.target.value); setManualError(false); }} placeholder={t("tvIpPlaceholder")}
              aria-invalid={manualError} aria-describedby={manualError ? `${ipId}-err` : undefined} inputMode="decimal" autoComplete="off" spellCheck={false}
              className="input data min-w-0 @[19rem]:flex-1 sm:max-w-[12rem]" />
            <Button type="submit" busy={connectingKey === `${manual.trim()}:`} disabled={busy} aria-label={t("tvConnectByIp")}>{t("tvAddByIp")}{connectingKey !== `${manual.trim()}:` && <ArrowRight size={16} aria-hidden />}</Button>
          </div>
        </form>
      </div>
      {scanning && <Progress value={scanFraction} label={t("tvFinding")} />}
      {manualError && <p id={`${ipId}-err`} role="alert" className="text-small text-err">{t("tvInvalidIp")}</p>}

      {entries.length > 0 && (
        <ul className="@container m-0 list-none divide-y divide-line overflow-hidden rounded-[12px] border border-line p-0" aria-label={t("tvListLabel")} aria-live="polite">
          {entries.map((e) => {
            const key = `${e.ip}:${e.port}`;
            const ready = e.status === "ready";
            const details = [e.model, e.tizen ? `Tizen ${e.tizen}` : null].filter(Boolean).join(" · ");
            return (
              <li key={key} className="fade-up flex flex-wrap items-center gap-x-3 gap-y-2 py-3 pr-3 pl-3.5 sm:px-4">
                <span className="relative hidden h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-muted @[22rem]:grid">
                  <Tv2 size={18} aria-hidden />
                  {e.live && <span className={`absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${ready ? "bg-ok" : "bg-warn"}`} aria-hidden />}
                </span>
                <div className="min-w-0 flex-[1_1_12rem]">
                  <p className="leading-snug font-semibold break-words">{e.name ?? "Samsung TV"}</p>
                  <p className="text-caption text-muted">
                    <span className="data whitespace-nowrap">{e.ip}</span>
                    {details && <span className="break-words"> · {details}</span>}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {e.status ? <Pill tone={STATUS_TONE[e.status]}>{t(statusKey(e.status))}</Pill> : <Pill tone="neutral">{t("tvSaved")}</Pill>}
                    {e.saved && e.live && <Pill tone="neutral">{t("tvSaved")}</Pill>}
                  </div>
                </div>
                <Button size="sm" variant={ready ? "primary" : "secondary"} busy={connectingKey === key} disabled={busy} onClick={() => connect(e.ip, e.port)} aria-label={`${t("tvConnect")}: ${e.name ?? e.ip}`}>
                  {connectingKey === key ? t("tvConnecting") : ready || !e.status ? t("tvConnect") : t("tvCheckAgain")}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {nothingFound && (
        <div className="rounded-[12px] border border-line p-4 text-small" role="status">
          <p className="font-semibold">{t("tvNoneFoundTitle")}</p>
          <ul className="m-0 mt-2 list-disc space-y-1 pl-5 text-muted">
            <li>{t("tvNoneFound1")}</li>
            <li>{t("tvNoneFound2")}</li>
            <li>{t("tvNoneFound3")}</li>
          </ul>
        </div>
      )}
      {problem && <DiagnosisPanel diagnosis={problem.d} technical={problem.technical} hostIp={problem.hostIp} check={problem.check} />}
      <Button variant="link" size="sm" onClick={() => setGuide(true)} className="-ml-1"><CircleHelp size={16} aria-hidden />{t("tvHelp")}</Button>
      {guide && <Modal title={t("devTitle")} onClose={() => setGuide(false)} wide><DevModeGuide /></Modal>}
    </div>
  );
}
