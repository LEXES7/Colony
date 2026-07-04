import { useEffect, useRef, useState } from "react";
import { api } from "./../api";
import { renderMarkdown } from "./../markdown";
import { useHub } from "./../store";

export default function ChatPane() {
  const { chat, streaming, chatBusy, addUserMessage, setChatBusy, workflows, teams } = useHub();
  const gate = workflows.find((w) => w.state.startsWith("awaiting"));
  const gateTeam = gate ? teams.find((t) => t.id === gate.teamId)?.name : null;
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.length, streaming]);

  const send = async () => {
    const message = input.trim();
    if (!message || chatBusy) return;
    setInput("");
    addUserMessage(message);
    setChatBusy(true);
    try {
      // Response text arrives via WS (chat.delta / chat.done); this call just
      // kicks the query off and acts as a fallback if WS is down.
      await api.chat(message);
    } catch {
      /* chat.error event carries the message */
    } finally {
      setChatBusy(false);
    }
  };

  return (
    <section className="panel chat">
      <h2>CEO</h2>
      {gate && (
        <p className="gate-banner">
          ⏸ {gateTeam ?? gate.teamId} is waiting on you — your next message answers them
        </p>
      )}
      <div className="messages">
        {chat.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="bubble">{m.role === "assistant" ? renderMarkdown(m.text) : m.text}</div>
          </div>
        ))}
        {streaming && (
          <div className="msg assistant">
            <div className="bubble">{streaming}</div>
          </div>
        )}
        {chatBusy && !streaming && <div className="thinking">thinking…</div>}
        <div ref={bottomRef} />
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={gate ? "Reply to the waiting team…" : "Talk to your CEO — it consults project experts and runs your teams"}
          rows={2}
        />
        <button type="submit" disabled={chatBusy || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
