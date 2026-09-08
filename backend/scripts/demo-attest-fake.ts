/**
 * Local demo: attest fake-cam and print whether CMOS rejects it as fake.
 * Usage: npx tsx scripts/demo-attest-fake.ts [phase]
 *   phase enroll — enroll+attest while streaming video A
 *   phase swap   — attest after frames swapped to video B (expect fake)
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import { runFullAttestation } from "../src/services/attestCamera.js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function main() {
  const phase = process.argv[2] ?? "attest";
  const { data: cameras, error } = await supabase
    .from("cameras")
    .select(
      "id, supplier_id, warehouse_id, label, host, username, password, cmos_account, enrollment_status",
    )
    .or("host.eq.127.0.0.1:8788,host.ilike.%8788%")
    .limit(5);

  if (error) throw error;
  const camera = cameras?.[0];
  if (!camera) {
    console.error("No fake-cam camera row found (host 127.0.0.1:8788)");
    process.exit(1);
  }

  console.log("phase", phase);
  console.log("camera", {
    id: camera.id,
    label: camera.label,
    host: camera.host,
    enrollment_status: camera.enrollment_status,
    cmos_account: camera.cmos_account,
  });

  if (phase === "reset") {
    await supabase
      .from("cameras")
      .update({ enrollment_status: "pending", cmos_account: null })
      .eq("id", camera.id);
    const fs = await import("node:fs");
    const candidates = [
      `/Users/auditor/Library/Application Support/ShelfSign/vision-service/data/enrollments/${camera.id}.json`,
      `/Users/auditor/Desktop/ShelfSign/vision-service/data/enrollments/${camera.id}.json`,
    ];
    for (const p of candidates) {
      try {
        fs.unlinkSync(p);
        console.log("removed enrollment file", p);
      } catch {
        /* missing */
      }
    }
    console.log("reset done");
    return;
  }

  try {
    const result = await runFullAttestation(camera as never);
    console.log("RESULT: ATTESTATION ACCEPTED (unexpected for fake after swap)");
    console.log(
      JSON.stringify(
        {
          attestationId: (result.attestation as { id?: string })?.id,
          cmosScore: result.cmosScore,
          steps: result.steps,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    const e = err as {
      message?: string;
      status?: number;
      reasons?: unknown;
      detail?: unknown;
      steps?: unknown;
    };
    console.log("RESULT: REJECTED AS FAKE / FAILED");
    console.log(
      JSON.stringify(
        {
          error: e.message,
          status: e.status,
          reasons: e.reasons,
          detail: e.detail,
          steps: e.steps,
        },
        null,
        2,
      ),
    );
    process.exitCode = e.message === "verification_failed" ? 0 : 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
