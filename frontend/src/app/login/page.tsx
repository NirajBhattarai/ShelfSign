"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Brand } from "@/components/ui";
import { CmosFingerprint } from "@/components/CmosFingerprint";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    const { data, error: signInError } = await supabase.auth.signInWithPassword(
      { email, password },
    );
    if (signInError || !data.user) {
      setError(
        signInError?.message ??
          "That email and password don't match an account.",
      );
      setSubmitting(false);
      return;
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .single();
    router.push(profile?.role === "supplier" ? "/supplier" : "/buyer");
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
          <span>Live enrollment readout, camera cam_cmos_0x4f2a</span>
          <span className="mono">nonce 0x9e11c4… issued 4s ago</span>
        </div>
      </aside>

      <main className="auth-main">
        <form className="auth-form" onSubmit={handleSubmit}>
          <h1>Log in to ShelfSign</h1>
          <p className="auth-sub">
            Check attested stock and manage your orders.
          </p>

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
              required
            />
          </div>

          {error && <div className="field-error">{error}</div>}

          <button
            type="submit"
            disabled={submitting}
            className="btn btn-primary btn-block"
          >
            {submitting ? "Logging in…" : "Log in"}
          </button>

          <p className="auth-switch">
            New here? <a href="/signup">Create an account</a>
          </p>
        </form>
      </main>
    </div>
  );
}
