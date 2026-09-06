"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Brand } from "@/components/ui";
import { useSupplierData } from "@/app/supplier/SupplierDataContext";

const SECTION_TITLE: Record<string, string> = {
  "/supplier": "Overview",
  "/supplier/orders": "Orders",
  "/supplier/warehouses": "Warehouses",
};

function sectionRoot(pathname: string): string {
  if (pathname.startsWith("/supplier/orders")) return "/supplier/orders";
  if (pathname.startsWith("/supplier/warehouses"))
    return "/supplier/warehouses";
  return "/supplier";
}

export function SupplierShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { orders, warehouses } = useSupplierData();
  const [mobileOpen, setMobileOpen] = useState(false);

  const newOrderCount = orders.filter((o) => o.status === "pending").length;
  const activeRoot = sectionRoot(pathname);

  function Nav({ onNavigate }: { onNavigate?: () => void }) {
    return (
      <nav className="dash-nav" aria-label="Supplier navigation">
        <div className="dash-nav-label">Overview</div>
        <Link
          className="dash-nav-link"
          href="/supplier"
          data-active={activeRoot === "/supplier"}
          onClick={onNavigate}
        >
          Dashboard
        </Link>

        <div className="dash-nav-label">Orders</div>
        <Link
          className="dash-nav-link"
          href="/supplier/orders"
          data-active={activeRoot === "/supplier/orders"}
          onClick={onNavigate}
        >
          All orders
          {newOrderCount > 0 && (
            <span className="dash-nav-count">{newOrderCount} new</span>
          )}
        </Link>

        <div className="dash-nav-label">Warehouses</div>
        <Link
          className="dash-nav-link"
          href="/supplier/warehouses"
          data-active={activeRoot === "/supplier/warehouses"}
          onClick={onNavigate}
        >
          All warehouses
          <span className="dash-nav-count">{warehouses.length}</span>
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
                {SECTION_TITLE[activeRoot] ?? "Supplier"}
              </span>
            </div>
          </div>
          <span className="role-chip">Supplier</span>
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
