import { useEffect, useState } from "react";
import { averageMonthlyConsumption, monthsOfStock, stockStatus } from "@scsp/rules";

// Placeholder shell. Facility capture, offline outbox and dashboards are built on this next.
export function App() {
  const [api, setApi] = useState("checking");
  useEffect(() => {
    fetch("/api/health").then((r) => setApi(r.ok ? "online" : "degraded")).catch(() => setApi("unreachable"));
  }, []);

  const amc = averageMonthlyConsumption([
    { month: "2026-07", consumption: 90, stockedOut: false },
    { month: "2026-08", consumption: 96, stockedOut: false },
    { month: "2026-09", consumption: 102, stockedOut: false },
  ]);
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 560, margin: "2rem auto", padding: "0 1rem" }}>
      <h1>Supply Chain Strengthening Platform</h1>
      <p>Server: {api}</p>
      <p>
        Shared rules check: AMC {amc}, {monthsOfStock(322, amc)} months of stock, status {stockStatus(322, amc)}.
      </p>
    </main>
  );
}
