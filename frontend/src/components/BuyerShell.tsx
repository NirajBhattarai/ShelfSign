"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Brand } from "@/components/ui";
import { useBuyerData } from "@/app/buyer/BuyerDataContext";
import { useHederaWallet } from "@/lib/HederaWalletContext";
import { ConnectWalletDialog } from "@/components/ConnectWalletDialog";
import { shortenAccountId } from "@/lib/hederaWallet";

const SECTION_TITLE: Record<string, string> = {
  "/buyer": "Overview",
  "/buyer/stock": "Stock",
  "/buyer/orders": "Orders",
  "/buyer/profile": "Account",
};

function sectionRoot(pathname: string): string {
  if (pathname.startsWith("/buyer/stock")) return "/buyer/stock";
  if (pathname.startsWith("/buyer/orders")) return "/buyer/orders";
  if (pathname.startsWith("/buyer/profile")) return "/buyer/profile";
  return "/buyer";
}

export function BuyerShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { orders, stock } = useBuyerData();
  const { wallet, connecting, disconnect } = useHederaWallet();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const activeOrders = orders.filter(
    (o) => o.status === "pending" || o.status === "confirmed",
  ).length;
  const activeRoot = sectionRoot(pathname);

  function Nav({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <nav className="dash-nav" aria-label="Buyer navigation">
        <div className="dash-nav-label">Shopping</div>
        <Link
          className="dash-nav-link"
          href="/buyer"
          data-active={activeRoot === "/buyer"}
          onClick={onNavigate}
        >
          Home
        </Link>
        <Link
          className="dash-nav-link"
          href="/buyer/stock"
          data-active={activeRoot === "/buyer/stock"}
          onClick={onNavigate}
        >
          Stock catalog
          <span className="dash-nav-count">{stock.length}</span>
        </Link>

        <div className="dash-nav-label">Orders</div>
        <Link
          className="dash-nav-link"
          href="/buyer/orders"
          data-active={activeRoot === "/buyer/orders"}
          onClick={onNavigate}
        >
          All orders
          {activeOrders > 0 && (
            <span className="dash-nav-count">{activeOrders} active</span>
          )}
        </Link>
        <div className="dash-nav-label">Account</div>
        <Link
          className="dash-nav-link"
          href="/buyer/profile"
          data-active={activeRoot === "/buyer/profile"}
          onClick={onNavigate}
        >
          Profile
        </Link>
      </nav>
    );
  }

  return (
    <div className="dash-shell">
      <aside className="dash-sidebar">
        <div className="dash-sidebar-brand">
          <Brand />
        </div>
        <Nav />
        <div className="dash-sidebar-footer">
          <button
            className="btn btn-ghost btn-block"
            onClick={() =>
              supabase.auth.signOut().then(() => router.push("/login"))
            }
          >
            Sign out
          </button>
        </div>
      </aside>

      <div className="dash-main">
        <header className="dash-header">
          <div className="dash-header-left">
            <button
              className="dash-menu-btn"
              type="button"
              aria-label="Open navigation"
              aria-expanded={mobileOpen}
              onClick={() => setMobileOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
            <div className="dash-breadcrumb">
              <span className="dash-breadcrumb-current">
                {SECTION_TITLE[activeRoot] ?? "Buyer"}
              </span>
            </div>
          </div>
          <div className="dash-header-actions">
            {wallet ? (
              <div className="wallet-chip" title={wallet.accountId}>
                <span className="wallet-chip-dot" data-mode={wallet.mode} />
                <span className="wallet-chip-id mono">
                  {shortenAccountId(wallet.accountId)}
                </span>
                <button
                  type="button"
                  className="wallet-chip-action"
                  onClick={() => disconnect()}
                  disabled={connecting}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setConnectOpen(true)}
                disabled={connecting}
              >
                {connecting ? "Connecting…" : "Connect wallet"}
              </button>
            )}
            <span className="role-chip">Buyer</span>
          </div>
        </header>

        <div className="dash-content">{children}</div>
      </div>

      {mobileOpen && (
        <div
          className="dash-drawer"
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          <button
            className="dash-drawer-scrim"
            type="button"
            aria-label="Close navigation"
            onClick={() => setMobileOpen(false)}
          />
          <div className="dash-drawer-panel">
            <div className="dash-sidebar-brand">
              <Brand />
            </div>
            <Nav onNavigate={() => setMobileOpen(false)} />
            <div className="dash-sidebar-footer">
              {!wallet ? (
                <button
                  className="btn btn-primary btn-block"
                  style={{ marginBottom: 8 }}
                  onClick={() => {
                    setMobileOpen(false);
                    setConnectOpen(true);
                  }}
                >
                  Connect wallet
                </button>
              ) : (
                <button
                  className="btn btn-ghost btn-block"
                  style={{ marginBottom: 8 }}
                  onClick={() => disconnect()}
                >
                  Disconnect {shortenAccountId(wallet.accountId)}
                </button>
              )}
              <button
                className="btn btn-ghost btn-block"
                onClick={() =>
                  supabase.auth.signOut().then(() => router.push("/login"))
                }
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}

      {connectOpen && (
        <ConnectWalletDialog onClose={() => setConnectOpen(false)} />
      )}
    </div>
  );
}
