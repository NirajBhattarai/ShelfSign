"use client";

import type { ReactNode } from "react";

export function Brand() {
  return (
    <div className="brand">
      <span className="brand-mark" />
      ShelfSign
    </div>
  );
}

export function TopBar({
  role,
  onSignOut,
}: {
  role: string;
  onSignOut: () => void;
}) {
  return (
    <div className="topbar">
      <Brand />
      <div className="topbar-meta">
        <span className="role-chip">{role}</span>
        <button className="btn btn-ghost" onClick={onSignOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  );
}

const STATUS_META: Record<string, { label: string; fg: string; bg: string }> = {
  pending: { label: "New", fg: "var(--pending)", bg: "var(--pending-bg)" },
  confirmed: {
    label: "Processing",
    fg: "var(--fulfilled)",
    bg: "var(--fulfilled-bg)",
  },
  fulfilled: {
    label: "Received",
    fg: "var(--verified)",
    bg: "var(--verified-bg)",
  },
  cancelled: {
    label: "Cancelled",
    fg: "var(--cancelled)",
    bg: "var(--cancelled-bg)",
  },
  verified: {
    label: "Verified",
    fg: "var(--verified)",
    bg: "var(--verified-bg)",
  },
  failed: {
    label: "Unverified",
    fg: "var(--failed)",
    bg: "var(--failed-bg)",
  },
};

export function Badge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span className="badge" style={{ color: meta.fg, background: meta.bg }}>
      {meta.label}
    </span>
  );
}

const LED_META: Record<string, { label: string; color: string }> = {
  pending: { label: "Enrolling", color: "var(--pending)" },
  enrolled: { label: "Enrolled", color: "var(--verified)" },
  failed: { label: "Failed", color: "var(--failed)" },
};

export function LedStatus({ status }: { status: string }) {
  const meta = LED_META[status] ?? LED_META.pending;
  return (
    <div className="led-row">
      <span
        className="led-dot"
        style={{
          background: meta.color,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${meta.color} 22%, transparent)`,
        }}
      />
      <span className="led-label" style={{ color: meta.color }}>
        {meta.label}
      </span>
    </div>
  );
}

export function Tabs<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div className="tabs">
      {options.map((o) => (
        <button
          key={o.value}
          className="tab"
          data-active={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function FilterRow({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div className="filter-row">
      <button
        className="filter-chip"
        data-active={value === "all"}
        onClick={() => onChange("all")}
      >
        All
      </button>
      {options.map((o) => (
        <button
          key={o}
          className="filter-chip"
          data-active={value === o}
          onClick={() => onChange(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

export function Ledger({
  children,
  empty,
}: {
  children: ReactNode;
  empty?: string;
}) {
  const hasChildren = Array.isArray(children)
    ? children.length > 0
    : !!children;
  return (
    <div className="panel">
      {hasChildren ? children : <div className="ledger-empty">{empty}</div>}
    </div>
  );
}

export function Overlay({
  onClose,
  children,
  wide,
  elevated,
}: {
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Stack above another open overlay (e.g. pay dialog over attest wizard). */
  elevated?: boolean;
}) {
  return (
    <div
      className={`overlay${elevated ? " overlay-elevated" : ""}`}
      onClick={onClose}
    >
      <div
        className={`overlay-body${wide ? " overlay-body-wide" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function DetailRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string | null | undefined;
  mono?: boolean;
}) {
  const display = value == null || value === "" ? "—" : value;
  return (
    <div className="detail-row">
      <div className="detail-label">{label}</div>
      <div className={`detail-value${mono ? " mono" : ""}`}>{display}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  note,
  onClick,
}: {
  label: string;
  value: number | string;
  note?: string;
  onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      className="stat-card"
      onClick={onClick}
      type={onClick ? "button" : undefined}
    >
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value">{value}</div>
      {note && <div className="stat-card-note">{note}</div>}
    </Tag>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state-title">{title}</div>
      <div className="empty-state-desc">{description}</div>
      {action}
    </div>
  );
}

export function ConfirmDialog({
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Overlay onClose={onCancel}>
      <div className="overlay-title">{title}</div>
      <div className="overlay-sub">{description}</div>
      <div className="confirm-actions">
        <button
          className="btn btn-ghost"
          style={{ flex: 1 }}
          onClick={onCancel}
          disabled={busy}
        >
          {cancelLabel}
        </button>
        <button
          className={`btn ${destructive ? "btn-danger" : "btn-primary"}`}
          style={{ flex: 1 }}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
    </Overlay>
  );
}
