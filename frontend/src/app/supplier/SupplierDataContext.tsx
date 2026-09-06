"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
}

export interface Camera {
  id: string;
  label: string;
  warehouse_id: string;
  host: string;
  enrollment_status: "pending" | "enrolled" | "failed";
  cmos_account: string | null;
}

export type OrderStatus = "pending" | "confirmed" | "fulfilled" | "cancelled";

export interface Order {
  id: string;
  buyer_id: string;
  supplier_id: string;
  sku: string;
  quantity: number;
  attestation_id: string | null;
  status: OrderStatus;
  created_at: string;
  buyer_company_name: string | null;
  supplier_company_name?: string | null;
  warehouse_name: string | null;
}

interface SupplierData {
  warehouses: Warehouse[];
  cameras: Camera[];
  orders: Order[];
  loading: boolean;
  refetchWarehouses: () => Promise<void>;
  refetchCameras: () => Promise<void>;
  refetchOrders: () => Promise<void>;
  setOrders: React.Dispatch<React.SetStateAction<Order[]>>;
}

const SupplierDataContext = createContext<SupplierData | null>(null);

export function SupplierDataProvider({ children }: { children: ReactNode }) {
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [cameras, setCameras] = useState<Camera[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  const refetchWarehouses = useCallback(async () => {
    setWarehouses(await apiGet<Warehouse[]>("/warehouses").catch(() => []));
  }, []);
  const refetchCameras = useCallback(async () => {
    setCameras(await apiGet<Camera[]>("/cameras").catch(() => []));
  }, []);
  const refetchOrders = useCallback(async () => {
    setOrders(await apiGet<Order[]>("/orders/incoming").catch(() => []));
  }, []);

  useEffect(() => {
    Promise.all([
      refetchWarehouses(),
      refetchCameras(),
      refetchOrders(),
    ]).finally(() => setLoading(false));
  }, [refetchWarehouses, refetchCameras, refetchOrders]);

  return (
    <SupplierDataContext.Provider
      value={{
        warehouses,
        cameras,
        orders,
        loading,
        refetchWarehouses,
        refetchCameras,
        refetchOrders,
        setOrders,
      }}
    >
      {children}
    </SupplierDataContext.Provider>
  );
}

export function useSupplierData(): SupplierData {
  const ctx = useContext(SupplierDataContext);
  if (!ctx)
    throw new Error("useSupplierData must be used within SupplierDataProvider");
  return ctx;
}
