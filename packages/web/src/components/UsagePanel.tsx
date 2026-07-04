import { useHub } from "./../store";
import type { Usage } from "@colony/shared";

const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

function Row({ label, usage }: { label: string; usage: Usage }) {
  return (
    <tr>
      <td className="label">{label}</td>
      <td>{fmt(usage.inputTokens)}</td>
      <td>{fmt(usage.outputTokens)}</td>
      <td>{fmt(usage.cacheReadTokens)}</td>
      <td>${usage.estCostUsd.toFixed(3)}</td>
    </tr>
  );
}

export default function UsagePanel() {
  const { projects, mainUsage } = useHub();
  const withUsage = projects.filter((p) => p.usage.queries > 0);

  return (
    <section className="panel usage">
      <h2>
        Token usage <small>(cost is an estimate on subscription)</small>
      </h2>
      <table>
        <thead>
          <tr>
            <th>agent</th>
            <th>in</th>
            <th>out</th>
            <th>cached</th>
            <th>~cost</th>
          </tr>
        </thead>
        <tbody>
          {mainUsage && <Row label="main" usage={mainUsage} />}
          {withUsage.map((p) => (
            <Row key={p.name} label={p.name} usage={p.usage} />
          ))}
        </tbody>
      </table>
      {!mainUsage && withUsage.length === 0 && <p className="empty">No usage yet.</p>}
    </section>
  );
}
