"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Brand } from "@/components/ui";
import { useBuyerData } from "@/app/buyer/BuyerDataContext";

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
  const [mobileOpen, setMobileOpen] = useState(false);

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
          <span className="role-chip">Buyer</span>
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
    </div>
  );
}
