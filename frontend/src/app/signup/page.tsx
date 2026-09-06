"use client";

import { useState } from "react";
import type { Role } from "@/lib/supabase";
import { Brand } from "@/components/ui";
import { CmosFingerprint } from "@/components/CmosFingerprint";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Step = "account" | "company" | "done";

export default function SignupPage() {
  const [step, setStep] = useState<Step>("account");
  const [role, setRole] = useState<Role | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const canSubmitAccount =
    !!role && email.trim() && password.length >= 6 && !submitting;
  const canSubmitCompany = !!companyName.trim() && !submitting;

  async function handleCreateAccount(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmitAccount) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.details ?? "Couldn't create that account.");
        return;
      }
      setUserId(data.userId);
      setStep("company");
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCompleteProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmitCompany || !userId || !role) return;

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/auth/complete-profile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, role, companyName: companyName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.details ?? "Couldn't save your company name.");
        return;
      }
      setStep("done");
    } catch {
      setError("Couldn't reach the server — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="auth-shell">
      <aside className="auth-aside">
        <div className="auth-aside-top">
          <Brand />
          <p className="auth-tagline">
            Camera-backed stock, signed from the silicon.
          </p>
        </div>

        <div className="auth-fingerprint-wrap">
          <CmosFingerprint />
        </div>

        <div className="auth-readout">
          <span>
            Every enrolled camera gets an account derived from its own sensor
            noise.
          </span>
          <span className="mono">cam_cmos_0x4f2a… matched 99.97%</span>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-form">
          {step === "account" && (
            <form onSubmit={handleCreateAccount}>
              <h1>Create your account</h1>
              <p className="auth-sub">
                Register cameras and publish attested stock, or browse it and
                order.
              </p>

              <div className="role-grid">
                <button
                  type="button"
                  className="role-card"
                  data-active={role === "supplier"}
                  onClick={() => setRole("supplier")}
                >
                  <div className="role-card-label">Supplier</div>
                  <div className="role-card-desc">
                    Register cameras, publish attested stock.
                  </div>
                </button>
                <button
                  type="button"
                  className="role-card"
                  data-active={role === "buyer"}
                  onClick={() => setRole("buyer")}
                >
                  <div className="role-card-label">Buyer</div>
                  <div className="role-card-desc">
                    Browse attested stock, place buy orders.
                  </div>
                </button>
              </div>

              <div className="field">
                <label htmlFor="email">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={6}
                  required
                />
              </div>

              {error && <div className="field-error">{error}</div>}

              <button
                type="submit"
                disabled={!canSubmitAccount}
                className="btn btn-primary btn-block"
              >
                {submitting ? "Creating account…" : "Continue"}
              </button>

              <p className="auth-switch">
                Already have an account? <a href="/login">Log in</a>
              </p>
            </form>
          )}

          {step === "company" && (
            <form onSubmit={handleCompleteProfile}>
              <h1>What's your company called?</h1>
              <p className="auth-sub">
                Last step — buyers and suppliers will see this name.
              </p>

              <div className="field">
                <label htmlFor="company">Company name</label>
                <input
                  id="company"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Himalayan Traders"
                  autoFocus
                  required
                />
              </div>

              {error && <div className="field-error">{error}</div>}

              <button
                type="submit"
                disabled={!canSubmitCompany}
                className="btn btn-primary btn-block"
              >
                {submitting ? "Saving…" : "Finish"}
              </button>
            </form>
          )}

          {step === "done" && (
            <div>
              <h1>Account created</h1>
              <p className="auth-sub">Log in to start using ShelfSign.</p>
              <a
                href="/login"
                className="btn btn-primary btn-block"
                style={{
                  display: "block",
                  textAlign: "center",
                  textDecoration: "none",
                }}
              >
                Log in
              </a>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
