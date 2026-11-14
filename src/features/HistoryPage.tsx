import { CheckCircle2, CircleSlash, History, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Button, Details, EmptyState, Modal, PageHeader, Pill } from "../components/ui";
import { useI18n } from "../hooks/i18n";
import { formatDate } from "../lib/format";
import { api } from "../services/api";
import type { HistoryEntry } from "../types";

export function HistoryPage() {
  const { t, lang, err } = useI18n();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [confirm, setConfirm] = useState(false);
  const load = useCallback(() => void api.getHistory().then(setEntries).catch(() => setEntries([])), []);
  useEffect(load, [load]);
  if (!entries) return null;

  return (
    <div>
      <PageHeader title={t("historyTitle")} subtitle={t("historySubtitle")} action={entries.length > 0 ? <Button onClick={() => setConfirm(true)}>{t("historyClear")}</Button> : undefined} />
      {entries.length === 0 ? (
        <EmptyState icon={<History size={26} aria-hidden />} title={t("historyEmptyTitle")} body={t("historyEmptyBody")} />
      ) : (
        <ul className="card m-0 list-none divide-y divide-line overflow-hidden p-0">
          {entries.map((e, i) => {
            const Icon = e.result === "success" ? CheckCircle2 : e.result === "failed" ? XCircle : CircleSlash;
            const tone = e.result === "success" ? "ok" : e.result === "failed" ? "err" : "neutral";
            return (
              <li key={`${e.time}-${i}`} className="fade-up px-4 py-4 sm:px-5">
                <div className="flex items-start gap-3">
                  <Icon size={20} className={`mt-0.5 shrink-0 ${tone === "ok" ? "text-ok" : tone === "err" ? "text-err" : "text-muted"}`} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <p className="font-semibold break-words">{e.app_name ?? e.file_name}</p>
                      {e.version && <span className="data text-small text-muted">{e.version}</span>}
                      <Pill tone={tone} className="ml-auto">{t(`result_${e.result}`)}</Pill>
                    </div>
                    <p className="mt-0.5 text-small text-muted"><span className="break-words">{e.tv_name}</span> · <span className="data">{e.tv_ip}</span></p>
                    <p className="text-caption text-muted"><time dateTime={new Date(e.time * 1000).toISOString()}>{formatDate(e.time, lang, true)}</time></p>
                    {e.error_code && <p className="mt-2 text-small text-fg">{err(e.error_code)}</p>}
                    {e.detail && <Details label={t("technicalDetails")}>{e.detail}</Details>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {confirm && (
        <Modal title={t("historyClear")} onClose={() => setConfirm(false)}
          footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>{t("cancel")}</Button><Button variant="danger" onClick={() => void api.clearHistory().then(() => { setConfirm(false); load(); })}>{t("historyClear")}</Button></>}>
          <p>{t("historyClearConfirm")}</p>
        </Modal>
      )}
    </div>
  );
}
