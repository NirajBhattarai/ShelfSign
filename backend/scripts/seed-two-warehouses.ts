/**
 * Reset to exactly two warehouses under demo.supplier1 (DB data only):
 *   1) Real Hikvision — camera row from HIKVISION_* (read once for insert)
 *   2) fake-cam stub — 127.0.0.1:8788 / FakeCamDemo1!
 *
 * Clears hikvision_* rows in system_settings. Existing backend uses
 * defaults || camera — so after clearing settings, camera rows apply.
 * Also comment out HIKVISION_* in backend/.env (env is a fallback in settings.ts).
 *
 *   cd backend && npm run seed:two-warehouses
 */
import "dotenv/config";
import { supabase } from "../src/services/supabase.js";

const SUPPLIER_EMAIL = "demo.supplier1@example.com";

const REAL_HOST = process.env.HIKVISION_HOST?.trim() || "192.168.50.64";
const REAL_USER = process.env.HIKVISION_USER?.trim() || "admin";
const REAL_PASS = process.env.HIKVISION_PASS?.trim() || "";

const FAKE_HOST = process.env.FAKE_CAM_HOST_PORT?.trim() || "127.0.0.1:8788";
const FAKE_USER = process.env.FAKE_CAM_USER?.trim() || "admin";
const FAKE_PASS = process.env.FAKE_CAM_PASS?.trim() || "FakeCamDemo1!";

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

async function main() {
  if (!REAL_PASS) {
    throw new Error(
      "Need HIKVISION_PASS available once to write the real camera row.\n" +
        "Temporarily set it, run this script, then comment HIKVISION_* out again.",
    );
  }

  const supplierId = await findUserIdByEmail(SUPPLIER_EMAIL);
  if (!supplierId) {
    throw new Error(`No user ${SUPPLIER_EMAIL} — run npm run seed:demo first`);
  }

  console.log("Resetting warehouses → exactly 2 (real + fake-cam)…\n");

  for (const key of ["hikvision_host", "hikvision_user", "hikvision_pass"]) {
    const { error } = await supabase
      .from("system_settings")
      .delete()
      .eq("key", key);
    if (error) throw error;
  }
  console.log("Cleared system_settings hikvision_host/user/pass");

  const { error: ordErr } = await supabase
    .from("buy_orders")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (ordErr) throw ordErr;

  const { error: whErr } = await supabase
    .from("warehouses")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000");
  if (whErr) throw whErr;

  const imageReal =
    "https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=1200&q=70";
  const imageFake =
    "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?auto=format&fit=crop&w=1200&q=70";

  const { data: realWh, error: realWhErr } = await supabase
    .from("warehouses")
    .insert({
      supplier_id: supplierId,
      name: "Real Hikvision Floor",
      location: `Live camera ${REAL_HOST}`,
      categories: ["Chair", "Monitor", "Table"],
      image_url: imageReal,
    })
    .select("id")
    .single();
  if (realWhErr || !realWh) throw realWhErr ?? new Error("real warehouse");

  const { data: fakeWh, error: fakeWhErr } = await supabase
    .from("warehouses")
    .insert({
      supplier_id: supplierId,
      name: "Fake Cam Demo",
      location: `Stub ISAPI ${FAKE_HOST}`,
      categories: ["Chair", "Monitor", "Table"],
      image_url: imageFake,
    })
    .select("id")
    .single();
  if (fakeWhErr || !fakeWh) throw fakeWhErr ?? new Error("fake warehouse");

  const { error: realCamErr } = await supabase.from("cameras").insert({
    warehouse_id: realWh.id,
    supplier_id: supplierId,
    label: "Real Hikvision",
    host: REAL_HOST,
    username: REAL_USER,
    password: REAL_PASS,
    enrollment_status: "pending",
    cmos_account: null,
  });
  if (realCamErr) throw realCamErr;

  const { error: fakeCamErr } = await supabase.from("cameras").insert({
    warehouse_id: fakeWh.id,
    supplier_id: supplierId,
    label: "Fake Cam (ISAPI stub)",
    host: FAKE_HOST,
    username: FAKE_USER,
    password: FAKE_PASS,
    enrollment_status: "pending",
    cmos_account: null,
  });
  if (fakeCamErr) throw fakeCamErr;

  for (const [whId, tag] of [
    [realWh.id, "real"],
    [fakeWh.id, "fake"],
  ] as const) {
    const { error: stockErr } = await supabase.from("warehouse_stock").insert([
      {
        warehouse_id: whId,
        supplier_id: supplierId,
        sku: "CHAIR",
        quantity: tag === "real" ? 10 : 99,
        shelf: "-",
      },
      {
        warehouse_id: whId,
        supplier_id: supplierId,
        sku: "MONITOR",
        quantity: tag === "real" ? 5 : 99,
        shelf: "-",
      },
      {
        warehouse_id: whId,
        supplier_id: supplierId,
        sku: "TABLE",
        quantity: tag === "real" ? 3 : 99,
        shelf: "-",
      },
    ]);
    if (stockErr) throw stockErr;
  }

  const { data: list } = await supabase
    .from("warehouses")
    .select("id, name, location")
    .order("name");

  console.log("\nWarehouses now:");
  for (const w of list ?? []) {
    console.log(`  • ${w.name}  (${w.location})`);
  }
  console.log("\nCameras (credentials on camera rows only):");
  console.log(`  Real → host=${REAL_HOST} user=${REAL_USER}`);
  console.log(`  Fake → host=${FAKE_HOST} user=${FAKE_USER} pass=${FAKE_PASS}`);
  console.log(`\nLogin: ${SUPPLIER_EMAIL} / ShelfSignDemo1!`);
  console.log(
    "\nNext: comment out HIKVISION_HOST/USER/PASS in backend/.env and restart backend\n" +
      "so env fallback does not override per-camera hosts.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
