"use client";

import { useState } from "react";
import { Overlay } from "@/components/ui";
import { useHederaWallet } from "@/lib/HederaWalletContext";
import { shortenAccountId } from "@/lib/hederaWallet";

export function ConnectWalletDialog({ onClose }: { onClose: () => void }) {
  const {
    connecting,
    error,
    walletConnectReady,
    demoReady,
    connectHashPack,
    connectDemo,
    connectImported,
    clearError,
  } = useHederaWallet();

  const [showImport, setShowImport] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [privateKey, setPrivateKey] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function run(action: () => Promise<void>) {
    setLocalError(null);
    clearError();
    try {
      await action();
      onClose();
    } catch (err) {
      setLocalError(
        err instanceof Error ? err.message : "Couldn't connect wallet.",
      );
    }
  }

  const displayError = localError || error;

  return (
    <Overlay onClose={connecting ? () => undefined : onClose} wide>
      <div className="overlay-title">Connect Hedera wallet</div>
      <div className="overlay-sub">
        Pay for attested stock with real HBAR on Hedera testnet (x402). Connect
        HashPack or import a funded account ID + key.
      </div>

      <div className="wallet-option-list">
        <button
          type="button"
          className="wallet-option"
          disabled={connecting || !walletConnectReady}
          onClick={() => run(connectHashPack)}
        >
          <div className="wallet-option-title">HashPack / WalletConnect</div>
          <div className="wallet-option-desc">
            {walletConnectReady
              ? "Scan QR or approve in the HashPack extension."
              : "Add NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID to enable."}
          </div>
        </button>

        <button
          type="button"
          className="wallet-option"
          disabled={connecting || !demoReady}
          onClick={() => run(connectDemo)}
        >
          <div className="wallet-option-title">Demo testnet payer</div>
          <div className="wallet-option-desc">
            {demoReady
              ? `One-click connect ${shortenAccountId(process.env.NEXT_PUBLIC_HEDERA_PAYER_ID ?? "")} (hackathon faucet account).`
              : "Set NEXT_PUBLIC_HEDERA_PAYER_ID/KEY for local demo."}
          </div>
        </button>

        <button
          type="button"
          className="wallet-option"
          disabled={connecting}
          onClick={() => {
            setShowImport((v) => !v);
            setLocalError(null);
          }}
        >
          <div className="wallet-option-title">Import testnet account</div>
          <div className="wallet-option-desc">
            Paste account ID + private key for this browser session only.
          </div>
        </button>
      </div>

      {showImport && (
        <div className="wallet-import-form">
          <div className="field">
            <label htmlFor="wc-account">Account ID</label>
            <input
              id="wc-account"
              className="mono"
              placeholder="0.0.12345"
              value={accountId}
              disabled={connecting}
              onChange={(e) => setAccountId(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="wc-key">Private key</label>
            <input
              id="wc-key"
              type="password"
              className="mono"
              placeholder="ECDSA or ED25519 DER / hex"
              value={privateKey}
              disabled={connecting}
              autoComplete="off"
              onChange={(e) => setPrivateKey(e.target.value)}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={connecting || !accountId.trim() || !privateKey.trim()}
            onClick={() => run(() => connectImported(accountId, privateKey))}
          >
            {connecting ? "Connecting…" : "Save & connect"}
          </button>
        </div>
      )}

      {displayError && (
        <div className="field-error" style={{ marginTop: 14 }}>
          {displayError}
        </div>
      )}

      <div className="confirm-actions" style={{ marginTop: 18 }}>
        <button
          type="button"
          className="btn btn-ghost btn-block"
          onClick={onClose}
          disabled={connecting}
        >
          Cancel
        </button>
      </div>
    </Overlay>
  );
}
