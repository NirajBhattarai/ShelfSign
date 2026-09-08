"use client";

/** Shown when a camera has failed hardware identity verification. */
export function FraudFlag() {
  return (
    <div className="fraud-flag" role="alert">
      <div className="fraud-flag-eyebrow">Verification alert</div>
      <div className="fraud-flag-title">Camera authenticity could not be confirmed</div>
      <p className="fraud-flag-body">
        The live feed did not match this warehouse’s enrolled camera identity.
        Stock counts from this proof should not be trusted until the supplier
        restores a verified camera connection.
      </p>
    </div>
  );
}
