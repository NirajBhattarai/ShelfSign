"use client";

import { useState } from "react";
import { Overlay, DetailRow } from "@/components/ui";
import { useHederaWallet } from "@/lib/HederaWalletContext";
import { ConnectWalletDialog } from "@/components/ConnectWalletDialog";
import {
  formatPaymentAmount,
  type PaymentRequirements,
} from "@/lib/x402Client";
import type { X402Challenge } from "@/lib/api";

export function PayUnlockDialog({
  title = "Unlock attested stock",
  subtitle,
  confirmVerb = "Pay & unlock",
  sku,
  warehouseName,
  challenge,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  title?: string;
  subtitle?: string;
  confirmVerb?: string;
  sku: string;
  warehouseName: string;
  challenge: X402Challenge;
  busy: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { wallet } = useHederaWallet();
  const [showConnect, setShowConnect] = useState(false);

  const requirements = challenge.accepts?.[0] as
    PaymentRequirements | undefined;
  const amount = requirements
    ? formatPaymentAmount(requirements)
    : "x402 price";

  if (showConnect) {
    return <ConnectWalletDialog onClose={() => setShowConnect(false)} />;
  }

  return (
    <Overlay onClose={busy ? () => undefined : onCancel} wide elevated>
      <div className="overlay-title">{title}</div>
      <div className="overlay-sub">
        {subtitle ?? `${sku} · ${warehouseName} · Hedera testnet x402 settle`}
      </div>

      <div className="order-summary-strip">
        <div>
          <div className="detail-label">You pay</div>
          <div className="mono">{amount}</div>
        </div>
        <div>
          <div className="detail-label">Network</div>
          <div className="mono">
            {requirements?.network ?? "hedera:testnet"}
          </div>
        </div>
        <div>
          <div className="detail-label">Asset</div>
          <div className="mono">
            {requirements?.asset === "0.0.0"
              ? "HBAR"
              : (requirements?.asset ?? "—")}
          </div>
        </div>
      </div>

      <DetailRow label="Pay to" value={requirements?.payTo} mono />
      <DetailRow
        label="Payer account"
        value={
          wallet ? `${wallet.accountId} · ${wallet.label}` : "Not connected"
        }
        mono
      />
      {requirements?.extra?.feePayer && (
        <DetailRow
          label="Fee payer (facilitator)"
          value={requirements.extra.feePayer}
          mono
        />
      )}

      {!wallet && (
        <div className="catalog-banner" style={{ marginTop: 14 }}>
          Connect HashPack (or import a funded testnet account) to sign the HBAR
          payment.
        </div>
      )}

      {error && (
        <div className="field-error" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}

      <div className="confirm-actions">
        <button
          type="button"
          className="btn btn-ghost"
          style={{ flex: 1 }}
          onClick={onCancel}
          disabled={busy}
        >
          Cancel
        </button>
        {!wallet ? (
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => setShowConnect(true)}
            disabled={busy}
          >
            Connect wallet
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy
              ? wallet.mode === "walletconnect"
                ? "Approve in wallet…"
                : "Signing & settling…"
              : `${confirmVerb} · ${amount}`}
          </button>
        )}
      </div>

      {wallet && (
        <button
          type="button"
          className="link-btn"
          style={{ marginTop: 12 }}
          onClick={() => setShowConnect(true)}
          disabled={busy}
        >
          Switch account
        </button>
      )}
    </Overlay>
  );
}
