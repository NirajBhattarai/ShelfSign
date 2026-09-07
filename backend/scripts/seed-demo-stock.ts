import "dotenv/config";
import { createHash, randomBytes } from "node:crypto";
import { supabase } from "../src/services/supabase.js";

// Seeds warehouses + catalog placeholder cameras + attestations for demo
// suppliers so buyers have searchable/filterable stock. Cameras are pending
// (no stub host/user/pass); live attest uses system_settings + real PUF.
// Safe to re-run: warehouses reused; cameras cleared of stub creds; attestations replaced.

interface StockItem {
  sku: string;
  count: number;
  confidence: number;
  shelf: string;
}

interface DemoWarehouse {
  supplierEmail: string;
  name: string;
  location: string;
  categories: string[];
  imageUrl: string;
  cameraLabel: string;
  items: StockItem[];
}

const DEMO_WAREHOUSES: DemoWarehouse[] = [
  {
    supplierEmail: "demo.supplier1@example.com",
    name: "Aisle A — Staples",
    location: "Kathmandu · Ground floor",
    categories: ["Groceries"],
    imageUrl:
      "https://images.unsplash.com/photo-1586528116311-ad8dd3c8310d?auto=format&fit=crop&w=1200&q=70",
    cameraLabel: "Aisle A overhead",
    items: [
      { sku: "RICE-25KG", count: 42, confidence: 0.93, shelf: "A1" },
      { sku: "DAL-1KG", count: 88, confidence: 0.91, shelf: "A2" },
      { sku: "OIL-5L", count: 36, confidence: 0.89, shelf: "A3" },
      { sku: "SUGAR-50KG", count: 14, confidence: 0.87, shelf: "A4" },
      { sku: "FLOUR-10KG", count: 7, confidence: 0.9, shelf: "A5" },
    ],
  },
  {
    supplierEmail: "demo.supplier1@example.com",
    name: "Hardware Bay",
    location: "Kathmandu · Yard",
    categories: ["Hardware"],
    imageUrl:
      "https://images.unsplash.com/photo-1504917595217-d4dc5ebe6122?auto=format&fit=crop&w=1200&q=70",
    cameraLabel: "Bay cam 1",
    items: [
      { sku: "HAMMER-STD", count: 24, confidence: 0.92, shelf: "H1" },
      { sku: "NAIL-BOX-500", count: 61, confidence: 0.88, shelf: "H2" },
      { sku: "PIPE-PVC-2M", count: 9, confidence: 0.86, shelf: "H3" },
      { sku: "WRENCH-SET", count: 3, confidence: 0.9, shelf: "H4" },
    ],
  },
  {
    supplierEmail: "demo.supplier2@example.com",
    name: "Cold Room 1",
    location: "Balaju · Cold chain",
    categories: ["Frozen goods", "Dairy"],
    imageUrl:
      "https://images.unsplash.com/photo-1604719312566-8912e9227c6a?auto=format&fit=crop&w=1200&q=70",
    cameraLabel: "Cold room cam",
    items: [
      { sku: "FROZEN-PEAS-1KG", count: 120, confidence: 0.94, shelf: "C1" },
      { sku: "CHICKEN-1KG", count: 45, confidence: 0.9, shelf: "C2" },
      { sku: "ICE-CREAM-12", count: 18, confidence: 0.88, shelf: "C3" },
      { sku: "MILK-1L", count: 6, confidence: 0.91, shelf: "C4" },
      { sku: "BUTTER-500G", count: 0, confidence: 0.85, shelf: "C5" },
    ],
  },
  {
    supplierEmail: "demo.supplier3@example.com",
    name: "Steel Yard East",
    location: "Biratnagar",
    categories: ["Steel", "Construction"],
    imageUrl:
      "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1200&q=70",
    cameraLabel: "Yard east cam",
    items: [
      { sku: "REBAR-12MM", count: 210, confidence: 0.89, shelf: "S1" },
      { sku: "ANGLE-IRON-3M", count: 54, confidence: 0.87, shelf: "S2" },
      { sku: "SHEET-GI-8FT", count: 28, confidence: 0.9, shelf: "S3" },
      { sku: "CEMENT-50KG", count: 4, confidence: 0.86, shelf: "S4" },
    ],
  },
  {
    supplierEmail: "demo.supplier4@example.com",
    name: "Seed Storefront",
    location: "Pokhara",
    categories: ["Seeds", "Fertilizer"],
    imageUrl:
      "https://images.unsplash.com/photo-1464226184884-fa280b87c309?auto=format&fit=crop&w=1200&q=70",
    cameraLabel: "Storefront cam",
    items: [
      { sku: "SEED-RICE-HYB", count: 75, confidence: 0.92, shelf: "F1" },
      { sku: "SEED-MAIZE-10KG", count: 33, confidence: 0.9, shelf: "F2" },
      { sku: "FERT-UREA-50KG", count: 19, confidence: 0.88, shelf: "F3" },
      { sku: "FERT-NPK-25KG", count: 11, confidence: 0.87, shelf: "F4" },
      { sku: "SEED-VEG-MIX", count: 2, confidence: 0.84, shelf: "F5" },
    ],
  },
  {
    supplierEmail: "demo.supplier5@example.com",
    name: "Parts Rack 2",
    location: "Birgunj",
    categories: ["Auto parts", "Tires"],
    imageUrl:
      "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=1200&q=70",
    cameraLabel: "Rack 2 cam",
    items: [
      { sku: "TIRE-185-65R15", count: 40, confidence: 0.93, shelf: "P1" },
      { sku: "BRAKE-PAD-SET", count: 22, confidence: 0.9, shelf: "P2" },
      { sku: "OIL-FILTER-STD", count: 67, confidence: 0.91, shelf: "P3" },
      { sku: "SPARK-PLUG-4", count: 8, confidence: 0.89, shelf: "P4" },
      { sku: "BATTERY-12V", count: 1, confidence: 0.86, shelf: "P5" },
    ],
  },
];

async function findUserIdByEmail(email: string): Promise<string | null> {
  let page = 1;
  for (;;) {
    const { data, error } = await supabase.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match) return match.id;
    if (data.users.length < 200) return null;
    page += 1;
  }
}

function hash(input: string) {
  return createHash("sha256").update(input).digest("hex");
}

async function seedWarehouse(demo: DemoWarehouse, supplierId: string) {
  const { data: existing } = await supabase
    .from("warehouses")
    .select("id")
    .eq("supplier_id", supplierId)
    .eq("name", demo.name)
    .maybeSingle();

  let warehouseId = existing?.id as string | undefined;

  if (!warehouseId) {
    const { data, error } = await supabase
      .from("warehouses")
      .insert({
        supplier_id: supplierId,
        name: demo.name,
        location: demo.location,
        categories: demo.categories,
        image_url: demo.imageUrl,
      })
      .select("id")
      .single();
    if (error || !data)
      throw error ?? new Error(`Failed warehouse ${demo.name}`);
    warehouseId = data.id;
  } else {
    await supabase
      .from("warehouses")
      .update({
        location: demo.location,
        categories: demo.categories,
        image_url: demo.imageUrl,
      })
      .eq("id", warehouseId);
  }

  // Catalog-only placeholder camera (label only). Live attest uses
  // system_settings Hikvision + real PUF enroll — never stub host/user/pass.
  const catalogAccount = `catalog_${hash(demo.name).slice(0, 12)}`;

  const { data: existingCam } = await supabase
    .from("cameras")
    .select("id")
    .eq("warehouse_id", warehouseId)
    .eq("label", demo.cameraLabel)
    .maybeSingle();

  let cameraId = existingCam?.id as string | undefined;

  if (!cameraId) {
    const { data, error } = await supabase
      .from("cameras")
      .insert({
        warehouse_id: warehouseId,
        supplier_id: supplierId,
        label: demo.cameraLabel,
        cmos_account: null,
        enrollment_status: "pending",
        host: null,
        username: null,
        password: null,
      })
      .select("id")
      .single();
    if (error || !data)
      throw error ?? new Error(`Failed camera ${demo.cameraLabel}`);
    cameraId = data.id;
  } else {
    await supabase
      .from("cameras")
      .update({
        cmos_account: null,
        enrollment_status: "pending",
        host: null,
        username: null,
        password: null,
      })
      .eq("id", cameraId);
  }

  // Declared inventory (orderable). Attestations below are optional camera proof.
  await supabase.from("warehouse_stock").delete().eq("warehouse_id", warehouseId);
  const { error: stockError } = await supabase.from("warehouse_stock").insert(
    demo.items.map((item) => ({
      warehouse_id: warehouseId,
      supplier_id: supplierId,
      sku: item.sku,
      quantity: item.count,
      shelf: item.shelf,
      updated_at: new Date().toISOString(),
    })),
  );
  if (stockError) throw stockError;

  // Replace prior demo attestations for this camera (evidence only).
  await supabase.from("attestations").delete().eq("camera_id", cameraId);

  const nonce = `0x${randomBytes(8).toString("hex")}`;
  const capturedAt = new Date().toISOString();
  const payload = JSON.stringify(demo.items);

  const { error: attError } = await supabase.from("attestations").insert({
    camera_id: cameraId,
    supplier_id: supplierId,
    camera_account: catalogAccount,
    nonce,
    image_cid: null,
    image_hash: hash(`${demo.name}:${payload}`),
    model: "yolov8n-stock-demo",
    model_hash: hash("yolov8n-stock-demo"),
    items: demo.items.map((i) => ({
      ...i,
      // Seeded "detected" evidence can match declared for demos; live attest may differ.
    })),
    cmos_score: 1,
    detection_count: demo.items.reduce((n, i) => n + i.count, 0),
    captured_at: capturedAt,
  });
  if (attError) throw attError;

  console.log(
    `  ${demo.name.padEnd(22)} ${demo.items.length} SKUs · ${demo.categories.join(", ")}`,
  );
}

async function main() {
  console.log("Seeding demo stock for suppliers…\n");

  const supplierIds = new Map<string, string>();
  for (const email of [
    ...new Set(DEMO_WAREHOUSES.map((w) => w.supplierEmail)),
  ]) {
    const id = await findUserIdByEmail(email);
    if (!id) {
      console.error(
        `Missing account ${email} — run \`npm run seed:demo\` first.`,
      );
      process.exit(1);
    }
    supplierIds.set(email, id);
  }

  for (const warehouse of DEMO_WAREHOUSES) {
    const supplierId = supplierIds.get(warehouse.supplierEmail)!;
    await seedWarehouse(warehouse, supplierId);
  }

  const skuCount = DEMO_WAREHOUSES.reduce((n, w) => n + w.items.length, 0);
  console.log(
    `\nDone. ${DEMO_WAREHOUSES.length} warehouses · ${skuCount} SKUs searchable in /buyer/stock`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
