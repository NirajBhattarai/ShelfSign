"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { apiGet } from "@/lib/api";

export interface Warehouse {
  id: string;
  name: string;
  location: string | null;
  categories: string[];
  image_url: string | null;
  supplier_id: string;
  profiles: { company_name: string } | null;
}

export interface StockItem {
  sku: string;
  count: number;
  confidence: number;
  shelf: string;
}

export interface Attestation {
  id: string;
  camera_account: string;
  nonce: string;
  image_hash: string;
  model_hash: string;
  captured_at: string;
  items: StockItem[];
}

export interface StockRow {
  warehouse: Warehouse;
  attestation: Attestation;
  item: StockItem;
}

export type OrderStatus = "pending" | "confirmed" | "fulfilled" | "cancelled";

export interface BuyerOrder {
  id: string;
  buyer_id: string;
  supplier_id: string;
  sku: string;
  quantity: number;
  attestation_id: string | null;
  status: OrderStatus;
  created_at: string;
  buyer_company_name?: string | null;
  supplier_company_name?: string | null;
  warehouse_name?: string | null;
}

interface BuyerData {
  warehouses: Warehouse[];
  stock: StockRow[];
  orders: BuyerOrder[];
  loading: boolean;
  stockError: string | null;
  refetchStock: () => Promise<void>;
  refetchOrders: () => Promise<void>;
  setOrders: React.Dispatch<React.SetStateAction<BuyerOrder[]>>;
  findStock: (warehouseId: string, sku: string) => StockRow | undefined;
}

const BuyerDataContext = createContext<BuyerData | null>(null);

export function BuyerDataProvider({ children }: { children: ReactNode }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [stock, setStock] = useState<StockRow[]>([]);
  const [orders, setOrders] = useState<BuyerOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [stockError, setStockError] = useState<string | null>(null);

  const refetchStock = useCallback(async () => {
    setStockError(null);
    try {
      const warehouseList = await apiGet<Warehouse[]>("/warehouses/browse");
      setWarehouses(warehouseList);
      const perWarehouse = await Promise.all(
        warehouseList.map(async (wh) => {
          const attestations = await apiGet<Attestation[]>(
            `/warehouses/${wh.id}/stock`,
          ).catch(() => []);
          return attestations.flatMap((att) =>
            att.items.map((item) => ({
              warehouse: wh,
              attestation: att,
              item,
            })),
          );
        }),
      );
      setStock(perWarehouse.flat());
    } catch (err) {
      setStockError(
        err instanceof Error ? err.message : "Couldn't load stock.",
      );
      setWarehouses([]);
      setStock([]);
    }
  }, []);

  const refetchOrders = useCallback(async () => {
    setOrders(await apiGet<BuyerOrder[]>("/orders/mine").catch(() => []));
  }, []);

  useEffect(() => {
    Promise.all([refetchStock(), refetchOrders()]).finally(() =>
      setLoading(false),
    );
  }, [refetchStock, refetchOrders]);

  const findStock = useCallback(
    (warehouseId: string, sku: string) =>
      stock.find(
        (row) => row.warehouse.id === warehouseId && row.item.sku === sku,
      ),
    [stock],
  );

  const value = useMemo(
    () => ({
      warehouses,
      stock,
      orders,
      loading,
      stockError,
      refetchStock,
      refetchOrders,
      setOrders,
      findStock,
    }),
    [
      warehouses,
      stock,
      orders,
      loading,
      stockError,
      refetchStock,
      refetchOrders,
      findStock,
    ],
  );

  return (
    <BuyerDataContext.Provider value={value}>
      {children}
    </BuyerDataContext.Provider>
  );
}

export function useBuyerData(): BuyerData {
  const ctx = useContext(BuyerDataContext);
  if (!ctx)
    throw new Error("useBuyerData must be used within BuyerDataProvider");
  return ctx;
}
