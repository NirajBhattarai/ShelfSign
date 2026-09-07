"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";
import { ToastProvider } from "@/components/toast";
import { BuyerShell } from "@/components/BuyerShell";
import { BuyerDataProvider } from "./BuyerDataContext";
import { HederaWalletProvider } from "@/lib/HederaWalletContext";

export default function BuyerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { loading, profile } = useProfile();

  useEffect(() => {
    if (!loading && !profile) router.push("/signup");
    if (!loading && profile && profile.role !== "buyer")
      router.push("/supplier");
  }, [loading, profile, router]);

  if (loading || !profile) {
    return (
      <div
        className="dash-loading"
        aria-busy="true"
        aria-label="Loading buyer workspace"
      >
        <div
          className="skeleton skeleton-block"
          style={{ width: 232, height: "100vh" }}
        />
        <div style={{ flex: 1, padding: 32 }}>
          <div
            className="skeleton skeleton-line"
            style={{ width: 180, marginBottom: 24 }}
          />
          <div
            className="skeleton skeleton-block"
            style={{ height: 120, marginBottom: 16 }}
          />
          <div className="skeleton skeleton-block" style={{ height: 280 }} />
        </div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <HederaWalletProvider>
        <BuyerDataProvider>
          <BuyerShell>{children}</BuyerShell>
        </BuyerDataProvider>
      </HederaWalletProvider>
    </ToastProvider>
  );
}
