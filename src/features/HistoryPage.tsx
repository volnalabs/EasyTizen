import { CheckCircle2, ChevronDown, CircleSlash, History, XCircle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useApp } from "../app/context";
import { Button, DataList, DialogCancel, Details, EmptyState, Modal, PageHeader, Pill, Row, Segmented } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import type { Key } from "../i18n";
import { dayKey, formatDate, formatTime } from "../lib/format";
import { api } from "../services/api";
import type { HistoryEntry } from "../types";

type Filter = "all" | "success" | "failed";
const RESULT = {
  success: { Icon: CheckCircle2, tone: "ok", color: "text-ok" },
  failed: { Icon: XCircle, tone: "err", color: "text-err" },
  cancelled: { Icon: CircleSlash, tone: "neutral", color: "text-muted" },
} as const;

function Entry({ e }: { e: HistoryEntry }) {
  const { t, lang, err } = useI18n();
  const [open, setOpen] = useState(false);
  const r = RESULT[e.result];
  const id = `h-${e.time}-${e.tv_ip}`;
  return (
    <li>
      <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} aria-controls={id} className="row-btn flex w-full items-start gap-3 px-4 py-3.5 text-start sm:px-5">
        <r.Icon size={20} className={`mt-px shrink-0 ${r.color}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-semibold break-words">{e.app_name ?? e.file_name}</span>
            {e.version && <span className="data text-small text-muted">{e.version}</span>}
          </span>
          <span className="mt-0.5 block text-small text-muted"><span className="break-words">{e.tv_name}</span> · <time dateTime={new Date(e.time * 1000).toISOString()}>{formatTime(e.time, lang)}</time></span>
          {e.error_code && !open && <span className="mt-1 line-clamp-2 block text-small text-fg">{err(e.error_code)}</span>}
        </span>
        <Pill tone={r.tone} className="mt-px hidden @[26rem]:inline-flex">{t(`result_${e.result}` as Key)}</Pill>
        <ChevronDown size={18} className={`mt-px shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div id={id} className="fade-in px-4 pb-4 sm:ps-[3.25rem] sm:pe-5">
          {e.error_code && <p className="mb-2 text-small text-fg">{err(e.error_code)}</p>}
          <DataList className="text-small">
            <Row label={t("historyResult")}>{t(`result_${e.result}` as Key)}</Row>
            <Row label={t("pkgFile")} data>{e.file_name}</Row>
            {e.app_id && <Row label={t("pkgId")} data>{e.app_id}</Row>}
            <Row label={t("historyTv")}><span className="break-words">{e.tv_name}</span> · <span className="data">{e.tv_ip}</span></Row>
            <Row label={t("historyWhen")}>{formatDate(e.time, lang, true)}</Row>
          </DataList>
          {e.detail && <Details label={t("technicalDetails")}>{e.detail}</Details>}
        </div>
      )}
    </li>
  );
}

export function HistoryPage() {
  const { t, lang } = useI18n();
  const { go } = useApp();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [confirm, setConfirm] = useState(false);
  const load = useCallback(() => void api.getHistory().then(setEntries).catch(() => setEntries([])), []);
  useEffect(load, [load]);

  const groups = useMemo(() => {
    const out: { label: string; items: HistoryEntry[] }[] = [];
    for (const e of entries ?? []) {
      if (filter === "success" && e.result !== "success") continue;
      if (filter === "failed" && e.result === "success") continue;
      const day = dayKey(e.time);
      const label = day === "today" ? t("today") : day === "yesterday" ? t("yesterday") : formatDate(e.time, lang);
      const last = out[out.length - 1];
      if (last?.label === label) last.items.push(e); else out.push({ label, items: [e] });
    }
    return out;
  }, [entries, filter, lang, t]);

  if (!entries) return null;
  const failed = entries.filter((e) => e.result !== "success").length;

  return (
    <div>
      <PageHeader title={t("historyTitle")} subtitle={t("historySubtitle")} action={entries.length > 0 ? <Button variant="ghost" onClick={() => setConfirm(true)}>{t("historyClear")}</Button> : undefined} />
      {entries.length === 0 ? (
        <EmptyState icon={<History size={28} aria-hidden />} title={t("historyEmptyTitle")} body={t("historyEmptyBody")} action={<Button variant="primary" onClick={() => go("install")}>{t("historyEmptyAction")}</Button>} />
      ) : (
        <>
          <div className="mb-6">
            <Segmented label={t("historyFilter")} value={filter} onChange={setFilter} options={[
              { value: "all", label: t("historyAll", { n: entries.length }) },
              { value: "success", label: t("historySuccess", { n: entries.length - failed }) },
              { value: "failed", label: t("historyFailed", { n: failed }) },
            ]} />
          </div>
          {groups.length === 0 && <p className="px-1 text-muted">{t("historyNoneFiltered")}</p>}
          <div className="space-y-6">
            {groups.map((g) => (
              <section key={g.label} aria-label={g.label}>
                <h2 className="eyebrow mb-2.5 px-1">{g.label}</h2>
                <ul className="panel @container m-0 list-none divide-y divide-line overflow-hidden p-0">
                  {g.items.map((e, i) => <Entry key={`${e.time}-${i}`} e={e} />)}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}
      {confirm && (
        <Modal title={t("historyClearTitle")} onClose={() => setConfirm(false)}
          footer={<><DialogCancel>{t("cancel")}</DialogCancel><Button variant="danger" onClick={() => void api.clearHistory().then(() => { setConfirm(false); load(); })}>{t("historyClear")}</Button></>}>
          <p>{t("historyClearConfirm")}</p>
        </Modal>
      )}
    </div>
  );
}
