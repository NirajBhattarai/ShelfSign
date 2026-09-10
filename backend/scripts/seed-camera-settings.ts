/**
 * Upsert SiliconWitness / Hikvision camera defaults into system_settings.
 *
 * Reads from backend/.env (or siliconwitness-style HIKVISION_* vars) and
 * stores them in the database so enroll/attest never need frontend-supplied
 * credentials. Run after applying migration 0004_system_settings.sql:
 *
 *   cd backend && npm run seed:camera-settings
 */
import "dotenv/config";
import {
  getBuyerStockCopy,
  getBuyerTrustChecks,
  resolveHikvisionHost,
  upsertSetting,
} from "../src/services/settings.js";

async function main() {
  const host = resolveHikvisionHost();
  const user = process.env.HIKVISION_USER?.trim();
  const pass = process.env.HIKVISION_PASS?.trim();
  const vision =
    process.env.VISION_SERVICE_URL?.trim() || "http://localhost:8000";
  const publicApi =
    process.env.PUBLIC_API_URL?.trim() ||
    process.env.BACKEND_PUBLIC_URL?.trim() ||
    "http://localhost:4000";

  if (!host || !user || !pass) {
    console.error(
      "Missing HIKVISION_HOST / HIKVISION_USER / HIKVISION_PASS in backend/.env\n" +
        "On router→switch→camera, use the camera IP on that LAN (e.g. 192.168.100.64),\n" +
        "not the old direct-LAN IP (e.g. 192.168.50.64). Optional: HIKVISION_PORT=80",
    );
    process.exit(1);
  }

  await upsertSetting("hikvision_host", host);
  await upsertSetting("hikvision_user", user);
  await upsertSetting("hikvision_pass", pass);
  await upsertSetting("vision_service_url", vision);
  await upsertSetting("public_api_url", publicApi.replace(/\/$/, ""));

  const checks = await getBuyerTrustChecks();
  await upsertSetting("buyer_trust_checks", JSON.stringify(checks));
  const copy = await getBuyerStockCopy();
  await upsertSetting("buyer_stock_copy", JSON.stringify(copy));

  console.log("system_settings upserted:");
  console.log(`  hikvision_host      = ${host}`);
  console.log(`  hikvision_user      = ${user}`);
  console.log(`  hikvision_pass      = ***`);
  console.log(`  vision_service_url  = ${vision}`);
  console.log(`  public_api_url      = ${publicApi}`);
  console.log(`  buyer_trust_checks  = ${checks.length} items`);
  console.log(`  buyer_stock_copy    = ok`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
