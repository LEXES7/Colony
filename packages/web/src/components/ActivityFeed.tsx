import { useEffect, useRef } from "react";
import { useHub } from "./../store";

const icons: Record<string, string> = {
  question: "→",
  answer: "←",
  error: "✕",
  tool: "⚙",
  summary: "≡",
};

export default function ActivityFeed() {
  const activity = useHub((s) => s.activity);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activity.length]);

  return (
    <section className="panel feed">
      <h2>Activity</h2>
      <ul>
        {activity.map((a) => (
          <li key={a.id} className={`act ${a.kind}`}>
            <span className="icon">{icons[a.kind] ?? "·"}</span>
            <span className="who">
              {a.from}
              {a.to ? ` → ${a.to}` : ""}
            </span>
            <span className="what">{a.text}</span>
          </li>
        ))}
        {activity.length === 0 && <li className="empty">Agent activity will appear here.</li>}
      </ul>
      <div ref={bottomRef} />
    </section>
  );
}
