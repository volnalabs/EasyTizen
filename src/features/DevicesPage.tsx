import { ArrowRight, MapPin, Plus, RefreshCw, Trash2, Tv2 } from "lucide-react";
import { useState } from "react";
import { useApp } from "../app/context";
import { DiagnosisPanel } from "../components/DiagnosisPanel";
import { ListItem, SplitView, useSplit } from "../components/SplitView";
import { Button, CopyButton, DataList, DialogCancel, EmptyState, Field, IconButton, Modal, PageHeader, Pill, Row, StatusDot, useToast } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { formatDate, looksLikeIpv4, opId } from "../lib/format";
import { api, toApiError } from "../services/api";
import type { Diagnosis, SavedDevice, TvCheck } from "../types";
import { TvFinder } from "./TvFinder";

type Availability = { state: "checking" } | { state: "done"; check: TvCheck };
const keyOf = (d: { ip: string; port: number }) => `${d.ip}:${d.port}`;

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
    <Modal title={t("tvAddressTitle")} description={device.name} onClose={onClose}
      footer={<><DialogCancel>{t("cancel")}</DialogCancel><Button variant="primary" busy={busy} onClick={() => void save()}>{t("save")}</Button></>}>
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-3">
        <p className="text-muted">{t("tvAddressBody")}</p>
        <Field label={t("tvIpLabel")} error={error}>
          <input className="input data" value={ip} autoFocus inputMode="decimal" enterKeyHint="done" autoComplete="off" spellCheck={false} onChange={(e) => { setIp(e.target.value); setError(null); }} aria-invalid={!!error} />
        </Field>
      </form>
    </Modal>
  );
}

function DeviceDetail({ device, availability, onCheck, onEdit, onForget }: {
  device: SavedDevice; availability?: Availability; onCheck: () => void; onEdit: () => void; onForget: () => void;
}) {
  const { t, lang } = useI18n();
  const { tv, setTv, refresh, go, busy } = useApp();
  const toast = useToast();
  const current = tv?.ip === device.ip && tv.port === device.port;
  const [connecting, setConnecting] = useState(false);
  const [problem, setProblem] = useState<{ d: Diagnosis; check: TvCheck | null; technical: string | null; hostIp: string | null } | null>(null);
  const a = availability;

  const connect = async () => {
    setConnecting(true); setProblem(null);
    try {
      const r = await api.connectTv(device.ip, device.port, opId());
      if (r.ok && r.data) { await refresh(); setTv(r.data); toast("ok", t("tvConnectedToast", { name: r.data.name })); }
      else if (r.diagnosis && r.diagnosis !== "cancelled") setProblem({ d: r.diagnosis, check: r.check, technical: r.technical, hostIp: r.host_ip });
    } catch (e) {
      const code = toApiError(e).code;
      if (code !== "cancelled") setProblem({ d: "unknown", check: null, technical: code, hostIp: null });
    } finally { setConnecting(false); }
  };

  return (
    <article className="panel fade-up p-5 sm:p-6" aria-labelledby="tv-detail-name">
      <div className="flex items-start gap-4">
        <span className={`relative grid h-12 w-12 shrink-0 place-items-center rounded-[14px] ${current ? "bg-ok-soft text-ok" : "bg-fill text-muted"}`}>
          <Tv2 size={22} aria-hidden />{current && <StatusDot tone="ok" live className="absolute -end-0.5 -top-0.5 ring-2 ring-surface" />}
        </span>
        <div className="min-w-0 flex-1">
          <input id="tv-detail-name" aria-label={t("renameTv", { name: device.name })} defaultValue={device.name} maxLength={60} key={`${keyOf(device)}-${device.name}`}
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== device.name) void api.renameDevice(device.ip, device.port, v).then(refresh); else e.target.value = device.name; }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className="selectable -ms-2 min-h-10 w-full min-w-0 rounded-[10px] border border-transparent bg-transparent px-2 text-title font-semibold tracking-[-0.015em] transition-colors hover:bg-fill focus:border-accent focus:bg-surface" />
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {current && <Pill tone="ok">{t("tvConnected")}</Pill>}
            {a?.state === "done" && (a.check.sdb_ok
              ? <Pill tone="ok">{t("tvAvailable")}</Pill>
              : <Pill tone={a.check.reachable ? "warn" : "err"}>{a.check.reachable ? t("tvNotReady") : t("tvUnavailable")}</Pill>)}
            <span className="text-caption text-muted">{device.last_connected ? t("tvLastSeen", { date: formatDate(device.last_connected, lang, true) }) : t("tvNeverSeen")}</span>
          </div>
        </div>
      </div>

      <DataList className="mt-5 border-t border-line">
        <Row label={t("tvAddress")} data action={<IconButton label={t("tvAddressEdit")} className="-my-2 -me-1.5" onClick={onEdit}><MapPin size={15} aria-hidden /></IconButton>}>{device.ip}:{device.port}</Row>
        {device.model && <Row label={t("tvModel")}>{device.model}</Row>}
        {device.tizen_version && <Row label={t("tvTizen")}>Tizen {device.tizen_version}</Row>}
        {device.duid && <Row label={t("tvDuid")} data action={<CopyButton value={device.duid} label={t("copyDuid")} />}>{device.duid}</Row>}
      </DataList>

      {problem && <div className="mt-4"><DiagnosisPanel diagnosis={problem.d} technical={problem.technical} hostIp={problem.hostIp} check={problem.check} /></div>}
      {!problem && a?.state === "done" && !a.check.sdb_ok && a.check.diagnosis && (
        <div className="mt-4"><DiagnosisPanel diagnosis={a.check.diagnosis} technical={a.check.technical} hostIp={a.check.host_ip} check={a.check} /></div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        {current
          ? <Button variant="primary" className="flex-[1_1_12rem] sm:flex-none" onClick={() => go("install")} icon={<ArrowRight size={16} aria-hidden />}>{t("tvUseForInstall")}</Button>
          : <Button variant="primary" className="flex-[1_1_12rem] sm:flex-none" busy={connecting} disabled={busy} onClick={() => void connect()}>{connecting ? t("tvConnecting") : t("tvConnect")}</Button>}
        <Button className="flex-[1_1_10rem] sm:flex-none" busy={a?.state === "checking"} onClick={onCheck} icon={<RefreshCw size={15} aria-hidden />}>{t("tvCheck")}</Button>
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <Button variant="ghost" size="sm" className="-ms-2 text-err hover:bg-err-soft hover:text-err" onClick={onForget} icon={<Trash2 size={15} aria-hidden />}>{t("tvForget")}</Button>
      </div>
    </article>
  );
}

export function DevicesPage() {
  const { t, lang, err } = useI18n();
  const { settings, refresh, tv, setTv } = useApp();
  const toast = useToast();
  const split = useSplit();
  const [selected, setSelected] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [forget, setForget] = useState<SavedDevice | null>(null);
  const [editing, setEditing] = useState<SavedDevice | null>(null);
  const [availability, setAvailability] = useState<Record<string, Availability>>({});
  const devices = settings.devices;
  const chosen = devices.find((d) => keyOf(d) === selected) ?? (split ? devices[0] : undefined);

  const checkOne = async (d: SavedDevice) => {
    const key = keyOf(d);
    setAvailability((a) => ({ ...a, [key]: { state: "checking" } }));
    try {
      const check = await api.checkTv(d.ip, d.port, opId());
      setAvailability((a) => ({ ...a, [key]: { state: "done", check } }));
    } catch (e) {
      toast("err", err(toApiError(e)));
      setAvailability((a) => { const next = { ...a }; delete next[key]; return next; });
    }
  };

  const addButton = <Button variant="primary" onClick={() => setAdding(true)} icon={<Plus size={16} aria-hidden />}>{t("tvAddTitle")}</Button>;

  return (
    <div>
      {/* On a phone the open detail replaces the list, header included. */}
      {(split || !chosen) && <PageHeader title={t("tvsTitle")} subtitle={t("tvsSubtitle")} action={devices.length > 0 ? addButton : undefined} />}
      {devices.length === 0 ? (
        <EmptyState icon={<Tv2 size={28} aria-hidden />} title={t("tvEmptyTitle")} body={t("tvEmptyBody")} action={addButton} />
      ) : (
        <SplitView open={!!chosen} onBack={() => setSelected(null)} backLabel={t("tvsTitle")}
          list={(
            <section aria-labelledby="tv-list-title">
              <h2 id="tv-list-title" className="eyebrow mb-2.5 px-1">{t("tvSavedTitle", { n: devices.length })}</h2>
              <ul className="panel m-0 list-none divide-y divide-line overflow-hidden p-0">
                {devices.map((d) => {
                  const current = tv?.ip === d.ip && tv.port === d.port;
                  return (
                    <ListItem key={keyOf(d)} selected={chosen ? keyOf(chosen) === keyOf(d) : false} onSelect={() => setSelected(keyOf(d))}
                      leading={(
                        <span className={`relative grid h-10 w-10 shrink-0 place-items-center rounded-[11px] ${current ? "bg-ok-soft text-ok" : "bg-fill text-muted"}`}>
                          <Tv2 size={19} aria-hidden />{current && <StatusDot tone="ok" live className="absolute -end-0.5 -top-0.5 ring-2 ring-surface" />}
                        </span>
                      )}
                      title={d.name}
                      meta={<><span className="data">{d.ip}</span>{current ? ` · ${t("tvConnected")}` : d.last_connected ? ` · ${formatDate(d.last_connected, lang)}` : ""}</>} />
                  );
                })}
              </ul>
            </section>
          )}
          detail={chosen && (
            <DeviceDetail key={keyOf(chosen)} device={chosen} availability={availability[keyOf(chosen)]} onCheck={() => void checkOne(chosen)}
              onEdit={() => setEditing(chosen)} onForget={() => setForget(chosen)} />
          )} />
      )}

      {adding && (
        <Modal title={t("tvAddTitle")} description={t("tvAddBody")} onClose={() => setAdding(false)} wide>
          <TvFinder showSaved={false} onConnected={(connected) => { setTv(connected); setAdding(false); setSelected(keyOf(connected)); toast("ok", t("tvConnectedToast", { name: connected.name })); }} />
        </Modal>
      )}
      {editing && <AddressDialog device={editing} onClose={() => setEditing(null)} onSaved={() => { const d = editing; setEditing(null); if (tv?.ip === d.ip) setTv(null); setSelected(null); void refresh(); toast("ok", t("tvAddressSaved")); }} />}
      {forget && (
        <Modal title={t("tvForgetTitle")} onClose={() => setForget(null)}
          footer={<><DialogCancel>{t("cancel")}</DialogCancel>
            <Button variant="danger" onClick={() => { const d = forget; setForget(null); setSelected(null); if (tv?.ip === d.ip && tv.port === d.port) setTv(null); void api.removeDevice(d.ip, d.port).then(refresh); }}>{t("tvForgetConfirm")}</Button></>}>
          <p>{t("tvForgetBody", { name: forget.name })}</p>
        </Modal>
      )}
    </div>
  );
}
