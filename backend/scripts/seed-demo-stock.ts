import "dotenv/config";
import { createHash } from "node:crypto";
import { supabase } from "../src/services/supabase.js";

// Seeds warehouses + catalog cameras + attestations for demo suppliers.
// Catalog is Chair / Monitor / Table only (matches YOLO stock classes).
// Safe to re-run: warehouses reused; attestations replaced.

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
    name: "Showroom Floor A",
    location: "Kathmandu · Ground floor",
    categories: ["Chair", "Table"],
    imageUrl:
      "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=70",
    cameraLabel: "Floor A overhead",
    items: [
      { sku: "CHAIR", count: 24, confidence: 1, shelf: "-" },
      { sku: "TABLE", count: 8, confidence: 1, shelf: "-" },
    ],
  },
  {
    supplierEmail: "demo.supplier1@example.com",
    name: "AV Bay",
    location: "Kathmandu · Yard",
    categories: ["Monitor", "Chair"],
    imageUrl:
      "https://images.unsplash.com/photo-1524758631624-e2822e304c36?auto=format&fit=crop&w=1200&q=70",
    cameraLabel: "AV bay cam",
    items: [
      { sku: "MONITOR", count: 18, confidence: 1, shelf: "-" },
      { sku: "CHAIR", count: 12, confidence: 1, shelf: "-" },
    ],
  },
  {
    supplierEmail: "demo.supplier2@example.com",
    name: "Office Pack Line",
    location: "Balaju",
    categories: ["Chair", "Monitor", "Table"],
    imageUrl:
      "https://images.unsplash.com/photo-1497366811353-6870744d04b2?auto=format&fit=crop&w=1200&q=70",
    cameraLabel: "Pack line cam",
    items: [
      { sku: "CHAIR", count: 40, confidence: 1, shelf: "-" },
      { sku: "MONITOR", count: 22, confidence: 1, shelf: "-" },
      { sku: "TABLE", count: 10, confidence: 1, shelf: "-" },
    ],
  },
  {
    supplierEmail: "demo.supplier3@example.com",
    name: "Steel Yard East",
    location: "Biratnagar",
    categories: ["Table", "Chair"],
    imageUrl:
      "https://images.unsplash.com/photo-1518455027359-f3f8164ba9c5?auto=format&fit=crop&w=1200&q=70",
    cameraLabel: "Yard east cam",
    items: [
      { sku: "TABLE", count: 15, confidence: 1, shelf: "-" },
      { sku: "CHAIR", count: 30, confidence: 1, shelf: "-" },
    ],
  },
  {
    supplierEmail: "demo.supplier4@example.com",
    name: "Display Wall",
    location: "Pokhara",
    categories: ["Monitor"],
    imageUrl:
      "https://images.unsplash.com/photo-1467232004584-a241de8bcf5d?auto=format&fit=crop&w=1200&q=70",
    cameraLabel: "Display cam",
    items: [{ sku: "MONITOR", count: 28, confidence: 1, shelf: "-" }],
  },
  {
    supplierEmail: "demo.supplier5@example.com",
    name: "Parts Rack 2",
    location: "Birgunj",
    categories: ["Chair", "Table", "Monitor"],
    imageUrl:
      "https://images.unsplash.com/photo-1486262715619-67b85e0b08d3?auto=format&fit=crop&w=1200&q=70",
    cameraLabel: "Rack 2 cam",
    items: [
      { sku: "CHAIR", count: 16, confidence: 1, shelf: "-" },
      { sku: "TABLE", count: 6, confidence: 1, shelf: "-" },
      { sku: "MONITOR", count: 9, confidence: 1, shelf: "-" },
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
    if (error || !data) throw error ?? new Error(`Failed camera ${demo.name}`);
    cameraId = data.id;
  } else {
    await supabase
      .from("cameras")
      .update({
        host: null,
        username: null,
        password: null,
        enrollment_status: "pending",
        cmos_account: null,
      })
      .eq("id", cameraId);
  }

  await supabase.from("attestations").delete().eq("camera_id", cameraId);

  const nonce = `0x${hash(`nonce:${demo.name}:${Date.now()}`).slice(0, 32)}`;
  const imageHash = `0x${hash(`img:${demo.name}`)}`;
  const modelHash = `0x${hash("yolov8n-stock-v1")}`;
  const total = demo.items.reduce((s, i) => s + i.count, 0);

  const { error: attErr } = await supabase.from("attestations").insert({
    camera_id: cameraId,
    supplier_id: supplierId,
    camera_account: catalogAccount,
    nonce,
    image_cid: null,
    image_hash: imageHash,
    model: "yolov8n-stock-v1",
    model_hash: modelHash,
    items: demo.items,
    cmos_score: 1,
    detection_count: total,
    captured_at: new Date().toISOString(),
  });
  if (attErr) throw attErr;

  // Declared warehouse stock matches category SKUs (integer totals).
  await supabase
    .from("warehouse_stock")
    .delete()
    .eq("warehouse_id", warehouseId);
  if (demo.items.length) {
    const { error: stockErr } = await supabase.from("warehouse_stock").insert(
      demo.items.map((i) => ({
        warehouse_id: warehouseId,
        supplier_id: supplierId,
        sku: i.sku,
        quantity: i.count,
        shelf: i.shelf,
      })),
    );
    if (stockErr) throw stockErr;
  }

  console.log(
    `  ${demo.name.padEnd(22)} ${String(demo.items.length).padStart(2)} SKUs · ${demo.categories.join(", ")}`,
  );
}

async function main() {
  console.log("Seeding Chair / Monitor / Table demo stock…\n");

  // Ensure canonical categories exist (idempotent with migration 0007).
  await supabase.from("categories").delete().neq("name", "");
  await supabase
    .from("categories")
    .insert([{ name: "Chair" }, { name: "Monitor" }, { name: "Table" }]);

  for (const demo of DEMO_WAREHOUSES) {
    const supplierId = await findUserIdByEmail(demo.supplierEmail);
    if (!supplierId) {
      console.warn(`skip ${demo.name}: no user ${demo.supplierEmail}`);
      continue;
    }
    await seedWarehouse(demo, supplierId);
  }

  console.log(
    `\nDone. ${DEMO_WAREHOUSES.length} warehouses · Chair/Monitor/Table only`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
