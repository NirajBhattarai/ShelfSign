"use client";

import { useEffect, useMemo, useState, useDeferredValue } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { Badge, EmptyState, FilterRow, PageHeader } from "@/components/ui";
import { type CatalogResponse, type StockRow } from "../BuyerDataContext";
import { PlaceOrderDialog } from "../PlaceOrderDialog";

type SortKey = "sku" | "count" | "supplier" | "captured";

const PAGE_SIZE = 12;

function availabilityLabel(count: number) {
  if (count < 1) return "Out of stock";
  if (count <= 10) return "Low stock";
  return "In stock";
}

export default function StockCatalogPage() {
  const router = useRouter();

  const [category, setCategory] = useState("all");
  const [supplier, setSupplier] = useState("all");
  const [availability, setAvailability] = useState<"all" | "in_stock" | "low">(
    "all",
  );
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [sort, setSort] = useState<SortKey>("sku");
  const [page, setPage] = useState(1);
  const [reloadKey, setReloadKey] = useState(0);
  const [orderTarget, setOrderTarget] = useState<StockRow | null>(null);

  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
  }, [deferredSearch, category, supplier, availability, sort]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({
      page: String(page),
      limit: String(PAGE_SIZE),
      sort,
      availability,
      category,
      supplierId: supplier,
    });
    if (deferredSearch.trim()) params.set("q", deferredSearch.trim());

    setLoading(true);
    apiGet<CatalogResponse>(`/warehouses/catalog?${params}`)
      .then((data) => {
        if (!cancelled) {
          setCatalog(data);
          setError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setCatalog(null);
          setError(
            err instanceof Error
              ? err.message
              : "Couldn't load the stock catalog.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, deferredSearch, category, supplier, availability, sort, reloadKey]);

  const items = catalog?.items ?? [];
  const total = catalog?.total ?? 0;
  const totalPages = catalog?.totalPages ?? 1;
  const categories = catalog?.categories ?? [];
  const suppliers = catalog?.suppliers ?? [];
  const searching = search !== deferredSearch;

  const hasFilters =
    category !== "all" ||
    supplier !== "all" ||
    availability !== "all" ||
    search.trim() !== "";

  const pageNumbers = useMemo(() => {
    const maxButtons = 5;
    if (totalPages <= maxButtons) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    const start = Math.max(1, Math.min(page - 2, totalPages - maxButtons + 1));
    return Array.from({ length: maxButtons }, (_, i) => start + i);
  }, [page, totalPages]);

  function clearFilters() {
    setCategory("all");
    setSupplier("all");
    setAvailability("all");
    setSearch("");
    setPage(1);
  }

  return (
    <div className="catalog-page">
      <PageHeader
        title="Stock catalog"
        description="Browse camera-attested inventory across supplier warehouses."
      />

      <div className="catalog-controls">
        <div className="catalog-search-wrap">
          <label className="sr-only" htmlFor="catalog-search">
            Search stock
          </label>
          <input
            id="catalog-search"
            className="input-line catalog-search"
            placeholder="Search SKU, supplier, warehouse, shelf, category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoComplete="off"
          />
          {searching && <span className="catalog-searching">Filtering…</span>}
        </div>

        <div className="catalog-filters">
          <select
            className="input-line"
            value={supplier}
            onChange={(e) => setSupplier(e.target.value)}
            aria-label="Filter by supplier"
          >
            <option value="all">All suppliers</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
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
            <button className="btn btn-ghost" onClick={clearFilters}>
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

        <div className="catalog-meta" aria-live="polite">
          {loading && !catalog
            ? "Loading catalog…"
            : `Showing ${items.length} of ${total} SKUs · page ${page} of ${totalPages}`}
          {hasFilters ? " · filters on" : ""}
        </div>
      </div>

      {loading && !catalog ? (
        <div className="stock-grid">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="stock-card skeleton-card">
              <div
                className="skeleton skeleton-block"
                style={{ height: 148 }}
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
      ) : error ? (
        <div className="panel panel-pad">
          <EmptyState
            title="Couldn't load stock"
            description={error}
            action={
              <button
                className="btn btn-primary"
                onClick={() => setReloadKey((k) => k + 1)}
              >
                Try again
              </button>
            }
          />
        </div>
      ) : items.length === 0 ? (
        <div className="panel panel-pad">
          <EmptyState
            title={
              total === 0 && !hasFilters
                ? "No attested stock yet"
                : "No products found"
            }
            description={
              total === 0 && !hasFilters
                ? "Stock appears here after a supplier seeds or publishes attested inventory."
                : "Try a different search term or remove some filters."
            }
            action={
              hasFilters ? (
                <button className="btn btn-ghost" onClick={clearFilters}>
                  Clear filters
                </button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <>
          <div className={`stock-grid${loading ? " is-loading" : ""}`}>
            {items.map((row, index) => {
              const avail = availabilityLabel(row.item.count);
              return (
                <article
                  key={`${row.attestation.id}-${row.item.sku}`}
                  className="stock-card stock-card-deferred"
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
                      <img
                        src={row.warehouse.image_url}
                        alt=""
                        width={480}
                        height={280}
                        loading={index < 2 ? "eager" : "lazy"}
                        fetchPriority={index === 0 ? "high" : undefined}
                      />
                    ) : (
                      <div className="stock-card-media-empty">
                        No warehouse photo
                      </div>
                    )}
                  </button>
                  <div className="stock-card-body">
                    <div className="stock-card-top">
                      <h3 className="stock-card-title">{row.item.sku}</h3>
                      {row.attestation.is_fake ? (
                        <span className="meta-chip meta-chip--fraud">
                          Unverified camera
                        </span>
                      ) : (
                        <Badge status="verified" />
                      )}
                    </div>
                    <div className="row-sub">
                      {row.warehouse.profiles?.company_name}
                      {" · "}
                      {row.warehouse.name}
                    </div>
                    <div className="stock-card-tags">
                      {row.warehouse.categories.slice(0, 2).map((c) => (
                        <span key={c} className="warehouse-tag">
                          {c}
                        </span>
                      ))}
                      <span
                        className="meta-chip"
                        data-tone={
                          row.item.count < 1
                            ? "danger"
                            : row.item.count <= 10
                              ? "warn"
                              : "ok"
                        }
                      >
                        {avail}
                      </span>
                    </div>
                    <div className="stock-card-meta">
                      <span className="mono">{row.item.count} units</span>
                      <span>Shelf {row.item.shelf}</span>
                      <span className="stock-card-detail">
                        {Math.round(row.item.confidence * 100)}% conf.
                      </span>
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
              );
            })}
          </div>

          {totalPages > 1 && (
            <nav className="pagination" aria-label="Catalog pages">
              <button
                className="btn btn-ghost"
                disabled={page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </button>
              <div className="pagination-pages">
                {pageNumbers.map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="pagination-page"
                    data-active={n === page}
                    aria-current={n === page ? "page" : undefined}
                    disabled={loading}
                    onClick={() => setPage(n)}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <button
                className="btn btn-ghost"
                disabled={page >= totalPages || loading}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              >
                Next
              </button>
            </nav>
          )}
        </>
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
