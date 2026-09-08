import { Router } from "express";
import { supabase } from "../services/supabase.js";
import { verifyAttestation } from "../services/verify.js";

export const attestationRouter = Router();

interface AttestationBody {
  cameraId: string;
  nonce: string;
  imageHash: string;
  claimedImageHash?: string;
  model: string;
  modelHash: string;
  items: unknown;
  capturedAt: string;
  cmosFingerprintMatch: boolean;
  signatureValid: boolean;
}

// Called by a warehouse agent after it captures a nonce-bound frame,
// runs CMOS matching and vision detection. Writes only on a full pass
// of the README's verification checklist.
attestationRouter.post("/", async (req, res) => {
  const body = req.body as Partial<AttestationBody>;
  const { cameraId, nonce, imageHash, model, modelHash, items, capturedAt } =
    body;

  if (
    !cameraId ||
    !nonce ||
    !imageHash ||
    !model ||
    !modelHash ||
    !items ||
    !capturedAt
  ) {
    res.status(400).json({ error: "missing_fields" });
    return;
  }

  const result = verifyAttestation({
    nonce,
    imageHash,
    claimedImageHash: body.claimedImageHash ?? imageHash,
    cmosFingerprintMatch: !!body.cmosFingerprintMatch,
    signatureValid: !!body.signatureValid,
  });

  if (!result.ok) {
    res
      .status(422)
      .json({ error: "verification_failed", reasons: result.reasons });
    return;
  }

  const { data: camera, error: cameraError } = await supabase
    .from("cameras")
    .select("id, supplier_id, cmos_account")
    .eq("id", cameraId)
    .single();

  if (cameraError || !camera) {
    res.status(404).json({ error: "camera_not_found" });
    return;
  }

  const { data, error } = await supabase
    .from("attestations")
    .insert({
      camera_id: camera.id,
      supplier_id: camera.supplier_id,
      camera_account: camera.cmos_account,
      nonce,
      image_hash: imageHash,
      model,
      model_hash: modelHash,
      items,
      captured_at: capturedAt,
    })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: "insert_failed", details: error.message });
    return;
  }

  res.status(201).json(data);
});

attestationRouter.get("/:id", async (req, res) => {
  const { data, error } = await supabase
    .from("attestations")
    .select("*")
    .eq("id", req.params.id)
    .single();
  if (error || !data) {
    res.status(404).json({ error: "not_found" });
    return;
  }
  res.json(data);
});
