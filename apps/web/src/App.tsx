import { useCallback, useEffect, useState } from "react";
import { changePassword, getSession, loadContext, login, logout, sync, type Context, type Session } from "./api";
import { pending, queue } from "./outbox";

const TYPES = [
  ["dispense", "Dispensed / consumed"], ["receipt", "Received"], ["loss", "Loss"],
  ["adjustment", "Adjustment (+/-)"], ["count", "Physical count"],
] as const;
const REASONS = ["expiry", "theft", "damage", "other"];
const deviceId = (() => { const k = "scsp.device"; return localStorage.getItem(k) ?? (localStorage.setItem(k, crypto.randomUUID()), localStorage.getItem(k)!); })();
const box = { fontFamily: "system-ui, sans-serif", maxWidth: 520, margin: "1.5rem auto", padding: "0 1rem", display: "grid", gap: ".6rem" } as const;

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(""), [pw, setPw] = useState(""), [msg, setMsg] = useState("");
  return (
    <main style={box}>
      <h1>SCSP sign in</h1>
      <input placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <input placeholder="Password" type="password" value={pw} onChange={(e) => setPw(e.target.value)} />
      <button onClick={async () => ((await login(email, pw)) ? onDone() : setMsg("Sign-in failed. Check your details or try again later."))}>Sign in</button>
      <p role="alert">{msg}</p>
    </main>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const [o, setO] = useState(""), [n, setN] = useState(""), [msg, setMsg] = useState("");
  return (
    <main style={box}>
      <h1>Set a new password</h1>
      <input placeholder="Temporary password" type="password" value={o} onChange={(e) => setO(e.target.value)} />
      <input placeholder="New password (10+ characters)" type="password" value={n} onChange={(e) => setN(e.target.value)} />
      <button onClick={async () => {
        const r = await changePassword(o, n);
        if (r.status === 200) { const s = getSession()!; localStorage.setItem("scsp.session", JSON.stringify({ ...s, mustChangePassword: false })); onDone(); }
        else setMsg("Could not change password. Check the temporary password and length.");
      }}>Save</button>
      <p role="alert">{msg}</p>
    </main>
  );
}

function Capture({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [n, setN] = useState(0), [msg, setMsg] = useState("");
  const [f, setF] = useState({ type: "dispense", productId: "", quantity: "", reasonCode: "", occurredOn: new Date().toISOString().slice(0, 10), batchNo: "", expiryDate: "" });
  const refresh = useCallback(async () => setN((await pending()).length), []);
  const doSync = useCallback(async () => {
    const r = await sync(); await refresh();
    setMsg(r.error ?? (r.sent ? `Sent ${r.sent} entries.` : "Nothing to send."));
    if (!getSession()) onLogout();
  }, [refresh, onLogout]);

  useEffect(() => { loadContext().then(setCtx); refresh(); doSync(); window.addEventListener("online", doSync); return () => window.removeEventListener("online", doSync); }, [doSync, refresh]);

  const facility = ctx?.facilities.find((x) => x.id === session.scope) ?? ctx?.facilities[0];
  if (!ctx || !facility) return <main style={box}><p>Loading facility data. The first load needs a connection.</p></main>;
  const needsReason = f.type === "loss" || f.type === "adjustment";

  return (
    <main style={box}>
      <h1>{facility.name}</h1>
      <p>{n} entries waiting to send <button onClick={doSync}>Sync now</button></p>
      <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value, reasonCode: "" })}>{TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      <select value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })}>
        <option value="">Select product</option>{ctx.products.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.unit})</option>)}
      </select>
      <input placeholder="Quantity" inputMode="numeric" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
      {needsReason && (f.type === "loss"
        ? <select value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })}><option value="">Reason</option>{REASONS.map((r) => <option key={r}>{r}</option>)}</select>
        : <input placeholder="Reason for adjustment" value={f.reasonCode} onChange={(e) => setF({ ...f, reasonCode: e.target.value })} />)}
      <input type="date" value={f.occurredOn} onChange={(e) => setF({ ...f, occurredOn: e.target.value })} />
      {(f.type === "receipt" || f.type === "count") && <>
        <input placeholder="Batch number (optional)" value={f.batchNo} onChange={(e) => setF({ ...f, batchNo: e.target.value })} />
        <input type="date" aria-label="Expiry date" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} />
      </>}
      <button onClick={async () => {
        const err = !f.productId ? "Select a product." : f.quantity.trim() === "" || !/^-?\d+$/.test(f.quantity.trim()) ? "Enter a whole number." :
          await queue({ clientId: crypto.randomUUID(), facilityId: facility.id, productId: f.productId, type: f.type as never, quantity: Number(f.quantity),
            reasonCode: f.reasonCode || undefined, batchNo: f.batchNo || undefined, expiryDate: f.expiryDate || undefined, occurredOn: f.occurredOn, deviceId });
        if (err) return setMsg(err);
        setF({ ...f, quantity: "", reasonCode: "", batchNo: "", expiryDate: "" }); await refresh(); setMsg("Saved on this device."); doSync();
      }}>Save entry</button>
      <p role="status">{msg}</p>
      <button onClick={() => { logout(); onLogout(); }}>Sign out</button>
    </main>
  );
}

export function App() {
  const [session, setSession] = useState<Session | null>(getSession());
  const refresh = () => setSession(getSession());
  if (!session) return <Login onDone={refresh} />;
  if (session.mustChangePassword) return <ChangePassword onDone={refresh} />;
  return <Capture session={session} onLogout={refresh} />;
}
