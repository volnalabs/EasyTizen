import { AlertTriangle, Check, CheckCircle2, ChevronDown, Copy, Info, Loader2, X, XCircle } from "lucide-react";
import {
  createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState,
  type ButtonHTMLAttributes, type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../hooks/i18n";

/* EasyTizen UI kit. Visual rules live in docs/DESIGN-SYSTEM.md; colours, radii, type and
   elevation come from the tokens in styles/index.css. */

export type Tone = "ok" | "warn" | "err" | "neutral" | "accent";
const TONE_SOFT: Record<Tone, string> = { ok: "bg-ok-soft text-ok", warn: "bg-warn-soft text-warn", err: "bg-err-soft text-err", neutral: "bg-fill text-muted", accent: "bg-accent-soft text-accent-text" };
const TONE_DOT: Record<Tone, string> = { ok: "bg-ok", warn: "bg-warn", err: "bg-err", neutral: "bg-faint", accent: "bg-accent" };

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Live media query (layout decisions that CSS alone cannot make, such as master–detail). */
export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

// ---------- buttons ----------

type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";

/** One primary per screen area. `icon` sits before the label and turns into a spinner while `busy`. */
export function Button({ variant = "secondary", busy, size = "md", block, icon, className = "", children, disabled, type = "button", ...rest }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean; size?: "sm" | "md" | "lg"; block?: boolean; icon?: ReactNode }) {
  const iconSize = size === "lg" ? 18 : size === "sm" ? 14 : 16;
  return (
    <button type={type} className={`btn btn-${size} btn-${variant} ${block ? "w-full" : ""} ${className}`} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy ? <Loader2 size={iconSize} className="spin" aria-hidden /> : icon}
      {children}
    </button>
  );
}

export function IconButton({ label, children, tone, className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: "danger" }) {
  return <button type="button" aria-label={label} title={label} className={`icon-btn ${tone === "danger" ? "icon-btn-danger" : ""} ${className}`} {...rest}>{children}</button>;
}

export function Spinner({ size = 16, className = "" }: { size?: number; className?: string }) {
  return <Loader2 size={size} className={`spin shrink-0 ${className}`} aria-hidden />;
}

// ---------- choice controls ----------

/** Single choice among 2–4 short options, with a sliding thumb. `stretch` fills the row. */
export function Segmented<T extends string>({ value, options, onChange, label, stretch }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string; stretch?: boolean }) {
  const track = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const index = options.findIndex((o) => o.value === value);
  useLayoutEffect(() => {
    const node = track.current;
    if (!node) return;
    const measure = () => {
      const el = node.children[index + 1] as HTMLElement | undefined;
      if (el) setThumb({ x: el.offsetLeft, w: el.offsetWidth });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, [index, options.length]);
  const move = (dir: number) => onChange(options[(index + dir + options.length) % options.length].value);
  return (
    <div ref={track} role="radiogroup" aria-label={label}
      onKeyDown={(e) => { if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(1); } if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(-1); } }}
      className={`relative ${stretch ? "flex w-full" : "inline-flex max-w-full"} rounded-control bg-fill p-[3px]`}>
      <span aria-hidden className={`absolute top-[3px] bottom-[3px] left-0 rounded-[9px] bg-raised shadow-raised transition-[transform,width] duration-200 ease-[var(--ease-out)] ${thumb ? "" : "opacity-0"}`}
        style={thumb ? { width: thumb.w, transform: `translateX(${thumb.x}px)` } : undefined} />
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => onChange(o.value)}
            className={`relative min-h-9 min-w-0 rounded-[9px] px-3 py-1 text-small leading-tight transition-colors duration-150 [:root[data-touch]_&]:min-h-10 ${stretch ? "flex-[1_1_0]" : ""} ${on ? "font-semibold text-fg" : "font-medium text-muted hover:text-fg"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Track({ checked }: { checked: boolean }) {
  return (
    <span aria-hidden className={`relative inline-flex h-[1.625rem] w-11 shrink-0 items-center rounded-full transition-colors duration-200 ${checked ? "bg-accent" : "bg-fill-3"}`}>
      <span className={`absolute top-[3px] left-[3px] grid h-5 w-5 place-items-center rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-transform duration-200 ease-[var(--ease-spring)] ${checked ? "translate-x-[1.125rem]" : ""}`}>
        <Check size={12} strokeWidth={3} className={`text-accent transition-opacity duration-150 ${checked ? "opacity-100" : "opacity-0"}`} />
      </span>
    </span>
  );
}

/** A switch whose whole row — title and description included — is the control. */
export function Toggle({ checked, onChange, label, description, disabled, className = "" }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode; disabled?: boolean; className?: string }) {
  const id = useId();
  return (
    <button type="button" role="switch" aria-checked={checked} aria-describedby={description ? id : undefined} disabled={disabled} onClick={() => onChange(!checked)}
      className={`row-btn -mx-3 flex w-[calc(100%+1.5rem)] items-start gap-4 rounded-control px-3 py-3 text-start disabled:opacity-50 ${className}`}>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {description && <span id={id} className="mt-0.5 block text-small text-muted">{description}</span>}
      </span>
      <span className="pt-px"><Track checked={checked} /></span>
    </button>
  );
}

// ---------- status ----------

export function Pill({ tone, children, className = "" }: { tone: Tone; children: ReactNode; className?: string }) {
  return <span className={`chip ${TONE_SOFT[tone]} ${className}`}>{children}</span>;
}

/** Small status light. `live` adds a soft pulse for an active connection. */
export function StatusDot({ tone, live, className = "" }: { tone: Tone; live?: boolean; className?: string }) {
  return <span aria-hidden className={`${className.includes("absolute") ? "" : "relative inline-block"} h-2 w-2 shrink-0 rounded-full ${TONE_DOT[tone]} ${live ? "signal" : ""} ${className}`} />;
}

// ---------- data ----------

/** Key/value list. Side by side when there is room, stacked on narrow screens; values wrap
 *  instead of being cut off, so long IDs and addresses stay readable. */
export function DataList({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <dl className={`@container m-0 ${className}`}>{children}</dl>;
}

export function Row({ label, children, data, action }: { label: string; children: ReactNode; data?: boolean; action?: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-6 gap-y-0.5 border-b border-line py-2.5 last:border-b-0 @sm:grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] @sm:items-center">
      <dt className="text-small text-muted @sm:text-body">{label}</dt>
      <dd className={`selectable flex min-h-7 min-w-0 items-center gap-1 font-medium @sm:justify-end @sm:text-end ${data ? "data" : "break-words"}`}>
        <span className="min-w-0">{children}</span>{action}
      </dd>
    </div>
  );
}

export function CopyButton({ value, label }: { value: string; label?: string }) {
  const { t } = useI18n();
  const toast = useToast();
  const [done, setDone] = useState(false);
  useEffect(() => { if (!done) return; const id = setTimeout(() => setDone(false), 1400); return () => clearTimeout(id); }, [done]);
  return (
    <IconButton label={label ?? t("copy")} className="-my-2 -me-1.5" onClick={() => void copyText(value).then((ok) => { if (ok) { setDone(true); toast("ok", t("copied")); } })}>
      {done ? <Check size={15} className="text-ok" aria-hidden /> : <Copy size={15} aria-hidden />}
    </IconButton>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: string; error?: string | null; children: ReactNode; htmlFor?: string }) {
  const Tag = htmlFor ? "div" : "label";
  return (
    <Tag className="block min-w-0">
      {htmlFor ? <label htmlFor={htmlFor} className="mb-1.5 block text-small font-semibold">{label}</label> : <span className="mb-1.5 block text-small font-semibold">{label}</span>}
      {children}
      {error ? <span role="alert" className="mt-1.5 flex items-start gap-1.5 text-small text-err"><XCircle size={14} className="mt-[3px] shrink-0" aria-hidden />{error}</span>
        : hint ? <span className="mt-1.5 block text-small text-muted">{hint}</span> : null}
    </Tag>
  );
}

/** Determinate when `value` is a number (0–1), a travelling stripe otherwise. */
export function Progress({ value, label, tone = "accent", size = "md" }: { value: number | null; label?: string; tone?: "accent" | "ok"; size?: "sm" | "md" }) {
  const fill = tone === "ok" ? "bg-ok" : "brand-gradient";
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value == null ? undefined : Math.round(value * 100)}
      className={`${size === "sm" ? "h-1" : "h-1.5"} w-full overflow-hidden rounded-full bg-fill-3`}>
      {value == null
        ? <div className={`indeterminate h-full w-2/5 rounded-full ${fill}`} />
        : <div className={`h-full rounded-full transition-[width] duration-300 ease-[var(--ease-out)] ${fill}`} style={{ width: `${Math.max(2, Math.min(100, value * 100))}%` }} />}
    </div>
  );
}

const NOTICE: Record<"info" | "warn" | "err" | "ok", { box: string; icon: string; Icon: typeof Info }> = {
  info: { box: "bg-accent-soft", icon: "text-accent-text", Icon: Info },
  warn: { box: "bg-warn-soft", icon: "text-warn", Icon: AlertTriangle },
  err: { box: "bg-err-soft", icon: "text-err", Icon: XCircle },
  ok: { box: "bg-ok-soft", icon: "text-ok", Icon: CheckCircle2 },
};

/** Inline message. Title says what happened; the body explains why and what to do next. */
export function Notice({ tone, title, children, action, live = true }: { tone: "info" | "warn" | "err" | "ok"; title?: string; children?: ReactNode; action?: ReactNode; live?: boolean }) {
  const { box, icon, Icon } = NOTICE[tone];
  return (
    <div role={live ? (tone === "err" ? "alert" : "status") : undefined} className={`fade-up flex gap-3 rounded-[14px] px-4 py-3.5 ${box}`}>
      <Icon size={18} className={`mt-px shrink-0 ${icon}`} aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-semibold text-fg">{title}</p>}
        {children && <div className={`text-small leading-relaxed ${title ? "mt-0.5 text-muted" : "text-fg"}`}>{children}</div>}
        {action && <div className="mt-3 flex flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
}

/**
 * Disclosure for secondary or technical information. Default: monospaced technical text in a
 * scrollable well. `prose`: long readable text in a well (release notes). `inline`: structured
 * content (lists, key/value data) shown in place, without a box or height limit.
 */
export function Details({ label, children, onOpen, prose, inline, className = "mt-2" }: { label: string; children: ReactNode; onOpen?: () => void; prose?: boolean; inline?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={className}>
      <button type="button" onClick={() => { if (!open) onOpen?.(); setOpen(!open); }} aria-expanded={open} aria-controls={id}
        className="-ms-1.5 inline-flex min-h-8 items-center gap-1 rounded-[8px] px-1.5 text-small font-medium text-muted transition-colors hover:bg-fill hover:text-fg [:root[data-touch]_&]:min-h-10">
        <ChevronDown size={15} className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden />
        {label}
      </button>
      {open && (inline
        ? <div id={id} className="selectable fade-in mt-2">{children}</div>
        : prose
        ? <div id={id} className="selectable fade-in mt-1.5 max-h-64 overflow-auto rounded-[12px] bg-fill p-3.5 text-small leading-relaxed whitespace-pre-line text-fg">{children}</div>
        : <pre id={id} className="selectable data fade-in mt-1.5 max-h-56 overflow-auto rounded-[12px] bg-fill p-3.5 font-mono text-caption leading-relaxed whitespace-pre-wrap text-fg">{children}</pre>)}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="fade-up flex flex-col items-center px-6 py-12 text-center sm:py-16">
      <span className="grid h-16 w-16 place-items-center rounded-[20px] bg-surface text-muted shadow-raised">{icon}</span>
      <p className="mt-5 text-title font-semibold tracking-[-0.01em]">{title}</p>
      <p className="mt-1.5 max-w-[38ch] text-muted">{body}</p>
      {action && <div className="mt-6 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end gap-x-4 gap-y-3 sm:mb-8">
      <div className="min-w-0 flex-[1_1_16rem]">
        <h1 className="text-heading font-semibold tracking-[-0.025em]">{title}</h1>
        {subtitle && <p className="mt-2 max-w-[56ch] text-muted">{subtitle}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </header>
  );
}

/** Settings-style group: small heading above one panel. */
export function Section({ title, description, children, id, flush }: { title: string; description?: string; children: ReactNode; id?: string; flush?: boolean }) {
  return (
    <section id={id} aria-label={title}>
      <h2 className="eyebrow mb-2.5 px-1">{title}</h2>
      <div className={`panel ${flush ? "" : "px-4 py-3 sm:px-5 sm:py-4"}`}>
        {description && <p className="mb-3 text-small text-muted">{description}</p>}
        {children}
      </div>
    </section>
  );
}

// ---------- dialogs ----------

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const DialogContext = createContext<() => void>(() => undefined);
/** Closes the surrounding dialog with its exit animation. */
const useDialogClose = () => useContext(DialogContext);

/** Dismiss button for a dialog footer: plays the closing animation, then calls `onClose`. */
export function DialogCancel({ children }: { children: ReactNode }) {
  const close = useDialogClose();
  return <Button variant="ghost" onClick={close}>{children}</Button>;
}

/** Dialog: centred from 600 px, a bottom sheet on phones. Traps focus and gives it back. */
export function Modal({ title, onClose, children, footer, wide, dismissible = true, description }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean; dismissible?: boolean; description?: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [leaving, setLeaving] = useState(false);
  const close = useRef(onClose);
  close.current = onClose;
  const dismiss = useCallback(() => {
    if (prefersReducedMotion()) { close.current(); return; }
    setLeaving(true);
    window.setTimeout(() => close.current(), 160);
  }, []);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>("[autofocus], input, select, textarea");
    (first ?? node)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && dismissible) { e.stopPropagation(); dismiss(); }
      if (e.key !== "Tab" || !node) return;
      const items = [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const [a, z] = [items[0], items[items.length - 1]];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); }
      else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("keydown", onKey); previous?.focus?.(); };
  }, [dismissible, dismiss]);
  return createPortal(
    <DialogContext.Provider value={dismiss}>
      <div className={`${leaving ? "scrim-out" : "scrim-in"} fixed inset-0 z-40 flex items-end justify-center bg-[var(--scrim)] sm:items-center sm:p-6`} onMouseDown={(e) => dismissible && e.target === e.currentTarget && dismiss()}>
        <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId}
          className={`${leaving ? "sheet-out" : "sheet-in"} safe-x flex max-h-[min(94dvh,54rem)] w-full flex-col rounded-t-dialog bg-surface shadow-pop outline-none sm:rounded-dialog sm:border sm:border-line ${wide ? "sm:max-w-[38rem]" : "sm:max-w-[28rem]"}`}>
          <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-fill-3 sm:hidden" aria-hidden />
          <div className="flex items-start gap-3 px-5 pt-4 pb-2 sm:px-6 sm:pt-6">
            <div className="min-w-0 flex-1 pt-1">
              <h2 id={titleId} className="text-title font-semibold tracking-[-0.015em]">{title}</h2>
              {description && <p className="mt-1 text-small text-muted">{description}</p>}
            </div>
            {dismissible && <IconButton label={t("close")} onClick={dismiss} className="-me-2 -mt-0.5"><X size={18} aria-hidden /></IconButton>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pt-2 pb-5 sm:px-6 sm:pb-6">{children}</div>
          {footer && <div className="safe-bottom flex flex-col-reverse gap-2 border-t border-line px-5 pt-3 pb-3 sm:flex-row sm:justify-end sm:px-6 sm:py-4 [&>.btn]:w-full sm:[&>.btn]:w-auto">{footer}</div>}
          {!footer && <div className="safe-bottom" />}
        </div>
      </div>
    </DialogContext.Provider>,
    document.body,
  );
}

// ---------- toasts ----------

interface Toast { id: number; tone: "ok" | "err" | "info"; text: string; leaving?: boolean }
const ToastContext = createContext<(tone: Toast["tone"], text: string) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((tone: Toast["tone"], text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t.filter((x) => x.text !== text).slice(-2), { id, tone, text }]);
    window.setTimeout(() => setToasts((t) => t.map((x) => (x.id === id ? { ...x, leaving: true } : x))), tone === "err" ? 6000 : 3200);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), (tone === "err" ? 6000 : 3200) + 180);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* Above the phone dock; bottom-right next to the content on wide screens. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(6rem+env(safe-area-inset-bottom,0px))] z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((t) => (
          <div key={t.id} role="status" className={`${t.leaving ? "toast-out" : "toast-in"} pointer-events-auto flex max-w-md items-start gap-2.5 rounded-[14px] border border-line bg-surface px-4 py-3 shadow-pop`}>
            {t.tone === "ok" ? <CheckCircle2 size={18} className="mt-px shrink-0 text-ok" aria-hidden /> : t.tone === "err" ? <AlertTriangle size={18} className="mt-px shrink-0 text-err" aria-hidden /> : <Info size={18} className="mt-px shrink-0 text-accent-text" aria-hidden />}
            <span className="min-w-0 font-medium">{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Copies text; falls back for webviews without the async clipboard API. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}
