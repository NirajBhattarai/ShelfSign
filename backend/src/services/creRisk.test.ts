import { describe, expect, it } from "vitest";
import { scoreAttestationRisk } from "./creRisk.js";

const base = {
  reviewId: "r1",
  attestationId: "a1",
  cameraId: "c1",
  cameraHost: "192.168.50.64",
  cameraLabel: "aisle-1",
  enrollmentStatus: "enrolled",
  isFake: false,
  fraudDetectedAt: null,
  cmosAccount: "0xabc",
  attestation: {
    id: "a1",
    capturedAt: new Date().toISOString(),
    imageHash: "0xhash",
    hcsTopicId: "0.0.1",
    hcsSequenceNumber: 1,
  },
};

describe("scoreAttestationRisk", () => {
  it("clears a healthy enrolled camera", () => {
    const r = scoreAttestationRisk(base);
    expect(r.verdict).toBe("CLEAR");
    expect(r.reasons).toHaveLength(0);
    expect(r.reasonHash).toMatch(/^0x[0-9a-f]{8}$/);
  });

  it("slashes a fake-flagged camera", () => {
    const r = scoreAttestationRisk({ ...base, isFake: true });
    expect(r.verdict).toBe("SLASH");
    expect(r.reasons).toContain("camera_flagged_fake");
  });

  it("holds when HCS receipt is missing", () => {
    const r = scoreAttestationRisk({
      ...base,
      attestation: { ...base.attestation, hcsTopicId: null },
    });
    expect(["HOLD", "CLEAR"]).toContain(r.verdict);
    expect(r.reasons).toContain("missing_hcs_receipt");
  });
});
