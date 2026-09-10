import "dotenv/config";
import { createHash } from "node:crypto";
import { supabase } from "../src/services/supabase.js";

// Seeds warehouses + cameras + verified attestations for demo.
// Half cameras → real Hikvision (HIKVISION_*), half → fake-cam stub.
// All rows are Verified (is_fake=false, enrolled) for a clean demo start.
// Safe to re-run: warehouses reused; cameras/attestations/stock replaced.

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

function realHost(): string {
  const host = process.env.HIKVISION_HOST?.trim() || "192.168.50.64";
  const port = process.env.HIKVISION_PORT?.trim();
  if (port && port !== "80" && !host.includes(":")) return `${host}:${port}`;
  return host;
}

function camCreds(index: number) {
  const useReal = index % 2 === 0;
  if (useReal) {
    return {
      kind: "hikvision" as const,
      host: realHost(),
      username: process.env.HIKVISION_USER?.trim() || "admin",
      password: process.env.HIKVISION_PASS?.trim() || "",
    };
  }
  return {
    kind: "fake-cam" as const,
    host: process.env.FAKE_CAM_HOST_PORT?.trim() || "127.0.0.1:8788",
    username: process.env.FAKE_CAM_USER?.trim() || "admin",
    password: process.env.FAKE_CAM_PASS?.trim() || "FakeCamDemo1!",
  };
}

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

async function seedWarehouse(
  demo: DemoWarehouse,
  supplierId: string,
  index: number,
) {
  const creds = camCreds(index);
  if (creds.kind === "hikvision" && !creds.password) {
    throw new Error(
      "HIKVISION_PASS missing in backend/.env — needed for real camera half",
    );
  }

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
  const cmosAccount = `0x${hash(`cmos:${demo.name}:${creds.kind}`).slice(0, 40)}`;

  const { data: existingCam } = await supabase
    .from("cameras")
    .select("id")
    .eq("warehouse_id", warehouseId)
    .eq("label", demo.cameraLabel)
    .maybeSingle();

  let cameraId = existingCam?.id as string | undefined;

  const cameraRow = {
    warehouse_id: warehouseId,
    supplier_id: supplierId,
    label: demo.cameraLabel,
    host: creds.host,
    username: creds.username,
    password: creds.password,
    // Demo-ready: Verified + enrolled (live attest can still flip fake-cam later)
    enrollment_status: "enrolled",
    cmos_account: cmosAccount,
    is_fake: false,
    fraud_detected_at: null,
  };

  if (!cameraId) {
    const { data, error } = await supabase
      .from("cameras")
      .insert(cameraRow)
      .select("id")
      .single();
    if (error || !data) throw error ?? new Error(`Failed camera ${demo.name}`);
    cameraId = data.id;
  } else {
    const { error } = await supabase
      .from("cameras")
      .update(cameraRow)
      .eq("id", cameraId);
    if (error) throw error;
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
    image_hash: imageHash,
    model: "yolov8n-stock-v1",
    model_hash: modelHash,
    items: demo.items,
    cmos_score: 1,
    detection_count: total,
    captured_at: new Date().toISOString(),
  });
  if (attErr) throw attErr;

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
    `  ${demo.name.padEnd(22)} ${creds.kind.padEnd(10)} ${creds.host.padEnd(22)} verified · ${demo.items.length} SKUs`,
  );
}

async function main() {
  console.log(
    "Seeding demo stock — half Hikvision / half fake-cam · all Verified…\n",
  );

  await supabase.from("categories").delete().neq("name", "");
  await supabase
    .from("categories")
    .insert([{ name: "Chair" }, { name: "Monitor" }, { name: "Table" }]);

  let idx = 0;
  for (const demo of DEMO_WAREHOUSES) {
    const supplierId = await findUserIdByEmail(demo.supplierEmail);
    if (!supplierId) {
      console.warn(`skip ${demo.name}: no user ${demo.supplierEmail}`);
      continue;
    }
    await seedWarehouse(demo, supplierId, idx);
    idx += 1;
  }

  const hik = Math.ceil(idx / 2);
  const fake = Math.floor(idx / 2);
  console.log(
    `\nDone. ${idx} warehouses · ${hik} Hikvision · ${fake} fake-cam · all is_fake=false / enrolled`,
  );
  console.log("Login: demo.supplier1@example.com / ShelfSignDemo1!");
  console.log("Fake stream: ensure fake-cam is running on :8788");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
