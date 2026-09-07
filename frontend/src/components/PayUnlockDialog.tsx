"use client";

import { useState } from "react";
import { Overlay, DetailRow } from "@/components/ui";
import { useHederaWallet } from "@/lib/HederaWalletContext";
import { ConnectWalletDialog } from "@/components/ConnectWalletDialog";
import {
  formatPaymentAmount,
  type PaymentRequirements,
} from "@/lib/x402Client";
import { shortenAccountId } from "@/lib/hederaWallet";
import type { X402Challenge } from "@/lib/api";

export function PayUnlockDialog({
  sku,
  warehouseName,
  challenge,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
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

  const requirements = challenge.accepts?.[0] as PaymentRequirements | undefined;
  const amount = requirements
    ? formatPaymentAmount(requirements)
    : "x402 price";

  if (showConnect) {
    return (
      <ConnectWalletDialog
        onClose={() => setShowConnect(false)}
      />
    );
  }

  return (
    <Overlay onClose={busy ? () => undefined : onCancel} wide>
      <div className="overlay-title">Unlock attested stock</div>
      <div className="overlay-sub">
        {sku} · {warehouseName}
        {challenge.mock
          ? " · mock settlement (local)"
          : " · Hedera x402 settle"}
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
        label="Payer wallet"
        value={
          wallet
            ? `${shortenAccountId(wallet.accountId)} · ${wallet.label}`
            : "Not connected"
        }
        mono
      />

      {!wallet && (
        <div className="catalog-banner" style={{ marginTop: 14 }}>
          Connect a Hedera wallet to sign this payment in your browser.
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
              : `Pay ${amount}`}
          </button>
        )}
      </div>
    </Overlay>
  );
}
