import { CheckCircle2, MapPin, Pencil, RefreshCw, Trash2, Tv2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "../app/context";
import { DiagnosisPanel } from "../components/DiagnosisPanel";
import { Button, CopyButton, DataList, EmptyState, Field, IconButton, Modal, PageHeader, Pill, Row, useToast } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { formatDate, looksLikeIpv4, opId } from "../lib/format";
import { api, toApiError } from "../services/api";
import type { SavedDevice, TvCheck } from "../types";
import { TvFinder } from "./TvFinder";

type Availability = { state: "checking" } | { state: "done"; check: TvCheck };

/** Change a saved TV's address (the router gave the TV a new one). */
function AddressDialog({ device, onClose, onSaved }: { device: SavedDevice; onClose: () => void; onSaved: () => void }) {
  const { t, err } = useI18n();
  const [ip, setIp] = useState(device.ip);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!looksLikeIpv4(ip)) { setError(t("tvInvalidIp")); return; }
    setBusy(true);
    try { await api.updateDeviceAddress(device.ip, device.port, ip.trim(), device.port); onSaved(); }
    catch (e) { setError(err(toApiError(e))); }
    finally { setBusy(false); }
  };
  return (
    <Modal title={t("tvAddressTitle", { name: device.name })} onClose={onClose}
      footer={<><Button variant="ghost" onClick={onClose}>{t("cancel")}</Button><Button variant="primary" busy={busy} onClick={() => void save()}>{t("save")}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3">
        <p className="text-muted">{t("tvAddressBody")}</p>
        <Field label={t("tvIpLabel")} error={error}>
          <input className="input data" value={ip} autoFocus inputMode="decimal" autoComplete="off" spellCheck={false} onChange={(e) => { setIp(e.target.value); setError(null); }} aria-invalid={!!error} />
        </Field>
      </form>
    </Modal>
  );
}

export function DevicesPage() {
  const { t, lang, err } = useI18n();
  const { settings, refresh, tv, setTv, go } = useApp();
  const toast = useToast();
  const [forget, setForget] = useState<SavedDevice | null>(null);
  const [editing, setEditing] = useState<SavedDevice | null>(null);
  const [availability, setAvailability] = useState<Record<string, Availability>>({});

  const checkOne = async (d: SavedDevice) => {
    const key = `${d.ip}:${d.port}`;
    setAvailability((a) => ({ ...a, [key]: { state: "checking" } }));
    try {
      const check = await api.checkTv(d.ip, d.port, opId());
      setAvailability((a) => ({ ...a, [key]: { state: "done", check } }));
    } catch (e) {
      toast("err", err(toApiError(e)));
      setAvailability((a) => { const next = { ...a }; delete next[key]; return next; });
    }
  };

  return (
    <div>
      <PageHeader title={t("tvsTitle")} subtitle={t("tvsSubtitle")} />
      <section className="card mb-6 p-4 sm:p-6" aria-label={t("tvAddTitle")}>
        <h2 className="mb-4 text-title font-semibold tracking-[-0.01em]">{t("tvAddTitle")}</h2>
        <TvFinder showSaved={false} onConnected={(connected) => { setTv(connected); toast("ok", t("tvConnectedToast", { name: connected.name })); }} />
      </section>
      {settings.devices.length === 0 ? (
        <EmptyState icon={<Tv2 size={26} aria-hidden />} title={t("tvEmptyTitle")} body={t("tvEmptyBody")} />
      ) : (
        <>
          <h2 className="eyebrow mb-2 px-1">{t("tvSavedTitle", { n: settings.devices.length })}</h2>
          <ul className="m-0 list-none space-y-3 p-0">
            {settings.devices.map((d) => {
              const key = `${d.ip}:${d.port}`;
              const current = tv?.ip === d.ip && tv.port === d.port;
              const a = availability[key];
              return (
                <li key={key} className={`card fade-up p-4 sm:p-5 ${current ? "border-[color-mix(in_srgb,var(--ok)_40%,var(--border))]" : ""}`}>
                  <div className="flex items-start gap-3">
                    <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-[11px] ${current ? "bg-ok-soft text-ok" : "bg-surface-2 text-muted"}`}><Tv2 size={20} aria-hidden /></span>
                    <div className="min-w-0 flex-1">
                      <div className="group relative flex items-center">
                        <input aria-label={t("renameTv", { name: d.name })} defaultValue={d.name} maxLength={60} key={d.name}
                          onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== d.name) void api.renameDevice(d.ip, d.port, v).then(refresh); else e.target.value = d.name; }}
                          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                          className="selectable -ml-1.5 min-h-8 w-full min-w-0 rounded-[8px] border border-transparent bg-transparent py-0.5 pr-7 pl-1.5 text-emph font-semibold transition-colors hover:border-line-strong focus:border-accent focus:bg-surface" />
                        <Pencil size={13} className="pointer-events-none absolute right-2 text-faint opacity-0 transition-opacity group-hover:opacity-100" aria-hidden />
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        {current && <Pill tone="ok"><CheckCircle2 size={12} aria-hidden />{t("tvConnected")}</Pill>}
                        {a?.state === "done" && (a.check.sdb_ok
                          ? <Pill tone="ok">{t("tvAvailable")}</Pill>
                          : <Pill tone={a.check.reachable ? "warn" : "err"}>{a.check.reachable ? t("tvNotReady") : t("tvUnavailable")}</Pill>)}
                        <span className="text-caption text-muted">{d.last_connected ? t("tvLastSeen", { date: formatDate(d.last_connected, lang, true) }) : t("tvNeverSeen")}</span>
                      </div>
                    </div>
                    <IconButton label={t("tvForgetNamed", { name: d.name })} onClick={() => setForget(d)}><Trash2 size={16} aria-hidden /></IconButton>
                  </div>
                  <DataList className="mt-3 border-t border-line">
                    <Row label={t("tvAddress")} data action={<IconButton label={t("tvAddressEdit")} onClick={() => setEditing(d)}><MapPin size={15} aria-hidden /></IconButton>}>{d.ip}:{d.port}</Row>
                    {d.model && <Row label={t("tvModel")}>{d.model}</Row>}
                    {d.tizen_version && <Row label={t("tvTizen")}>Tizen {d.tizen_version}</Row>}
                    {d.duid && <Row label={t("tvDuid")} data action={<CopyButton value={d.duid} label={t("copyDuid")} />}>{d.duid}</Row>}
                  </DataList>
                  {a?.state === "done" && !a.check.sdb_ok && a.check.diagnosis && (
                    <div className="mt-3"><DiagnosisPanel diagnosis={a.check.diagnosis} technical={a.check.technical} hostIp={a.check.host_ip} check={a.check} /></div>
                  )}
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button size="sm" busy={a?.state === "checking"} onClick={() => void checkOne(d)}>{a?.state !== "checking" && <RefreshCw size={14} aria-hidden />}{t("tvCheck")}</Button>
                    {current && <Button size="sm" variant="primary" onClick={() => go("install")}>{t("tvUseForInstall")}</Button>}
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {editing && <AddressDialog device={editing} onClose={() => setEditing(null)} onSaved={() => { const d = editing; setEditing(null); if (tv?.ip === d.ip) setTv(null); void refresh(); toast("ok", t("tvAddressSaved")); }} />}
      {forget && (
        <Modal title={t("tvForgetTitle")} onClose={() => setForget(null)}
          footer={<><Button variant="ghost" onClick={() => setForget(null)}>{t("cancel")}</Button>
            <Button variant="danger" onClick={() => { const d = forget; setForget(null); if (tv?.ip === d.ip && tv.port === d.port) setTv(null); void api.removeDevice(d.ip, d.port).then(refresh); }}>{t("tvForget")}</Button></>}>
          <p>{t("tvForgetBody", { name: forget.name })}</p>
        </Modal>
      )}
    </div>
  );
}
