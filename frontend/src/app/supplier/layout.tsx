"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProfile } from "@/lib/useProfile";
import { ToastProvider } from "@/components/toast";
import { SupplierShell } from "@/components/SupplierShell";
import { SupplierDataProvider } from "./SupplierDataContext";
import { HederaWalletProvider } from "@/lib/HederaWalletContext";

export default function SupplierLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { loading, profile } = useProfile();

  useEffect(() => {
    if (!loading && !profile) router.push("/signup");
    if (!loading && profile && profile.role !== "supplier")
      router.push("/buyer");
  }, [loading, profile, router]);

  if (loading || !profile) return null;

  return (
    <ToastProvider>
      <HederaWalletProvider>
        <SupplierDataProvider>
          <SupplierShell>{children}</SupplierShell>
        </SupplierDataProvider>
      </HederaWalletProvider>
    </ToastProvider>
  );
}
