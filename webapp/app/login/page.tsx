"use client";

import { useState } from "react";

export default function Login() {
  const [code, setCode] = useState("");
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch("/api/login", { method: "POST", body: JSON.stringify({ code }) });
    setBusy(false);
    if (!res.ok) return setError(true);
    const next = new URLSearchParams(window.location.search).get("next") ?? "/";
    window.location.assign(next.startsWith("/") ? next : "/");
  }
  return (
    <main className="login panel">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/gmt-logo.png" alt="GMT" width={93} height={40} className="gmt-logo" />
      <h1>Translation Desk</h1>
      <p className="muted small">Internal prototype for GMT Publishing. Enter the access code.</p>
      <form onSubmit={submit} className="row">
        <label className="label" htmlFor="code" style={{ width: "100%" }}>Access code</label>
        <input id="code" type="password" value={code} onChange={(e) => setCode(e.target.value)} autoFocus autoComplete="current-password" />
        <button className="btn" disabled={busy || !code}>Enter</button>
        {error && <span className="badge error">Wrong code</span>}
      </form>
    </main>
  );
}
