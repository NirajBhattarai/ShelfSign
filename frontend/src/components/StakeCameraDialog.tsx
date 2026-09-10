"use client";

import { useEffect, useState } from "react";
import { apiGet, apiPostPaid, type X402Challenge } from "@/lib/api";
import { PayUnlockDialog } from "@/components/PayUnlockDialog";
import { useHederaWallet } from "@/lib/HederaWalletContext";
import { signExactPaymentHeaderWithSigner } from "@/lib/x402Client";
import type { Camera } from "@/app/supplier/SupplierDataContext";

/**
 * Supplier legitimacy stake: x402 transfer of 10 ℏ into the escrow vault.
 * Separate from attest — after this succeeds, use Attest live to verify.
 */
export function StakeCameraDialog({
  camera,
  onClose,
  onStaked,
}: {
  camera: Camera;
  onClose: () => void;
  onStaked?: (updated: Camera) => void;
}) {
  const { getClientSigner } = useHederaWallet();
  const [challenge, setChallenge] = useState<X402Challenge | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingChallenge, setLoadingChallenge] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoadingChallenge(true);
    setError(null);
    apiGet<X402Challenge>(`/cameras/${camera.id}/stake/challenge`)
      .then((c) => {
        if (!cancelled) {
          setChallenge(c);
          setLoadingChallenge(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Challenge failed");
          setLoadingChallenge(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [camera.id]);

  async function confirmStake() {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const requirements = challenge.accepts?.[0];
      if (!requirements)
        throw new Error("Stake challenge missing requirements.");
      if (!requirements.extra?.feePayer) {
        throw new Error(
          "Facilitator feePayer missing — check X402_FACILITATOR_URL / network.",
        );
      }
      const signer = await getClientSigner();
      const signed = await signExactPaymentHeaderWithSigner(
        requirements,
        signer,
      );
      const updated = await apiPostPaid<Camera>(
        `/cameras/${camera.id}/stake`,
        {},
        { paymentSignature: signed.paymentHeader },
      );
      onStaked?.(updated);
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Stake failed.";
      if (msg !== "Payment cancelled") setError(msg);
    } finally {
      setBusy(false);
    }
  }

  const emptyChallenge: X402Challenge = {
    x402Version: 2,
    accepts: [],
    resource: `/cameras/${camera.id}/stake`,
  };

  return (
    <PayUnlockDialog
      title="Stake 10 ℏ legitimacy bond"
      subtitle={
        loadingChallenge
          ? `${camera.label} · loading x402 challenge…`
          : `${camera.label} · x402 transfer to escrow vault`
      }
      confirmVerb="Pay 10 ℏ"
      sku={camera.label}
      warehouseName="Camera legitimacy stake"
      challenge={challenge ?? emptyChallenge}
      busy={busy || loadingChallenge}
      error={error}
      onConfirm={() => {
        if (!challenge || loadingChallenge) return;
        void confirmStake();
      }}
      onCancel={() => {
        if (busy) return;
        onClose();
      }}
    />
  );
}
