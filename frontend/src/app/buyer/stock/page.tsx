"use client";

import { useMemo, useState, useDeferredValue } from "react";
import { useRouter } from "next/navigation";
import { Badge, EmptyState, FilterRow, PageHeader } from "@/components/ui";
import { useBuyerData, type StockRow } from "../BuyerDataContext";
import { PlaceOrderDialog } from "../PlaceOrderDialog";

type SortKey = "sku" | "count" | "supplier" | "captured";

export default function StockCatalogPage() {
  const router = useRouter();
  const { stock, warehouses, loading, stockError, refetchStock } =
    useBuyerData();

  const [category, setCategory] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [availability, setAvailability] = useState<"all" | "in_stock" | "low">(
    "all",
  );
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sort, setSort] = useState<SortKey>("sku");
  const [orderTarget, setOrderTarget] = useState<StockRow | null>(null);

  const categories = useMemo(() => {
    const set = new Set<string>();
    warehouses.forEach((wh) => wh.categories.forEach((c) => set.add(c)));
    return Array.from(set).sort();
  }, [warehouses]);

  const suppliers = useMemo(() => {
    const map = new Map<string, string>();
    warehouses.forEach((wh) => {
      if (wh.profiles?.company_name)
        map.set(wh.supplier_id, wh.profiles.company_name);
    });
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [warehouses]);

  const filtered = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    const rows = stock.filter((row) => {
      if (category !== "all" && !row.warehouse.categories.includes(category))
        return false;
      if (supplier !== "all" && row.warehouse.supplier_id !== supplier)
        return false;
      if (availability === "in_stock" && row.item.count < 1) return false;
      if (availability === "low" && (row.item.count < 1 || row.item.count > 10))
        return false;
      if (q) {
        const hay = [
          row.item.sku,
          row.warehouse.name,
          row.warehouse.profiles?.company_name ?? "",
          row.item.shelf,
          ...row.warehouse.categories,
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    rows.sort((a, b) => {
      switch (sort) {
        case "count":
          return b.item.count - a.item.count;
        case "supplier":
          return (a.warehouse.profiles?.company_name ?? "").localeCompare(
            b.warehouse.profiles?.company_name ?? "",
          );
        case "captured":
          return (
            new Date(b.attestation.captured_at).getTime() -
            new Date(a.attestation.captured_at).getTime()
          );
        default:
          return a.item.sku.localeCompare(b.item.sku);
      }
    });
    return rows;
  }, [stock, category, supplier, availability, deferredSearch, sort]);

  const hasFilters =
    category !== "all" ||
    supplier !== "all" ||
    availability !== "all" ||
    search.trim() !== "";

  return (
    <div>
      <PageHeader
        title="Stock catalog"
        description="Browse camera-attested inventory across supplier warehouses."
      />

      <div className="toolbar">
        <input
          className="input-line toolbar-search"
          placeholder="Search products, SKU, category, supplier…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search stock"
        />
        <select
          className="input-line"
          value={supplier}
          onChange={(e) => setSupplier(e.target.value)}
          aria-label="Filter by supplier"
        >
          <option value="all">All suppliers</option>
          {suppliers.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <select
          className="input-line"
          value={availability}
          onChange={(e) =>
            setAvailability(e.target.value as typeof availability)
          }
          aria-label="Filter by availability"
        >
          <option value="all">Any availability</option>
          <option value="in_stock">In stock</option>
          <option value="low">Low stock (≤10)</option>
        </select>
        <select
          className="input-line"
          value={sort}
          onChange={(e) => setSort(e.target.value as SortKey)}
          aria-label="Sort stock"
        >
          <option value="sku">Sort by SKU</option>
          <option value="count">Sort by quantity</option>
          <option value="supplier">Sort by supplier</option>
          <option value="captured">Sort by latest attestation</option>
        </select>
        {hasFilters && (
          <button
            className="btn btn-ghost"
            onClick={() => {
              setCategory("all");
              setSupplier("all");
              setAvailability("all");
              setSearch("");
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      {categories.length > 0 && (
        <FilterRow
          value={category}
          onChange={setCategory}
          options={categories}
        />
      )}

      {loading ? (
        <div className="stock-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="stock-card skeleton-card">
              <div
                className="skeleton skeleton-block"
                style={{ height: 140 }}
              />
              <div className="stock-card-body">
                <div
                  className="skeleton skeleton-line"
                  style={{ width: "60%" }}
                />
                <div
                  className="skeleton skeleton-line"
                  style={{ width: "40%", marginTop: 10 }}
                />
              </div>
            </div>
          ))}
        </div>
      ) : stockError ? (
        <div className="panel panel-pad">
          <EmptyState
            title="Couldn't load stock"
            description={stockError}
            action={
              <button
                className="btn btn-primary"
                onClick={() => refetchStock()}
              >
                Try again
              </button>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="panel panel-pad">
          <EmptyState
            title={
              stock.length === 0 ? "No attested stock yet" : "No products found"
            }
            description={
              stock.length === 0
                ? "Stock appears here after a supplier's enrolled camera captures inventory."
                : "Try a different search term or remove some filters."
            }
            action={
              hasFilters ? (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setCategory("all");
                    setSupplier("all");
                    setAvailability("all");
                    setSearch("");
                  }}
                >
                  Clear filters
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className="stock-grid">
          {filtered.map((row) => (
            <article
              key={`${row.attestation.id}-${row.item.sku}`}
              className="stock-card"
            >
              <button
                type="button"
                className="stock-card-media"
                onClick={() =>
                  router.push(
                    `/buyer/stock/${row.warehouse.id}/${encodeURIComponent(row.item.sku)}`,
                  )
                }
                aria-label={`View ${row.item.sku}`}
              >
                {row.warehouse.image_url ? (
                  <img src={row.warehouse.image_url} alt="" loading="lazy" />
                ) : (
                  <div className="stock-card-media-empty">
                    No warehouse photo
                  </div>
                )}
              </button>
              <div className="stock-card-body">
                <div className="stock-card-top">
                  <h3 className="stock-card-title">{row.item.sku}</h3>
                  <Badge status="verified" />
                </div>
                <div className="row-sub">
                  {row.warehouse.profiles?.company_name}
                  {" · "}
                  {row.warehouse.name}
                </div>
                <div className="stock-card-meta">
                  <span className="mono">{row.item.count} units</span>
                  <span>Shelf {row.item.shelf}</span>
                </div>
                <div className="stock-card-actions">
                  <button
                    className="btn btn-ghost"
                    onClick={() =>
                      router.push(
                        `/buyer/stock/${row.warehouse.id}/${encodeURIComponent(row.item.sku)}`,
                      )
                    }
                  >
                    Details
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => setOrderTarget(row)}
                    disabled={row.item.count < 1}
                  >
                    Place order
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {orderTarget && (
        <PlaceOrderDialog
          target={orderTarget}
          onClose={() => setOrderTarget(null)}
        />
      )}
    </div>
  );
}
