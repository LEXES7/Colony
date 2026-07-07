import { useEffect, useRef, useState } from "react";
import { api } from "./../api";
import { renderMarkdown } from "./../markdown";
import { useHub } from "./../store";

const SUGGESTIONS = [
  "What projects do I have and what state are they in?",
  "Let's build an online store",
  "How did I implement auth in my last project?",
];

function Avatar({ role }: { role: string }) {
  if (role === "user") return <span className="avatar you">You</span>;
  return (
    <span className="avatar agent" aria-hidden>
      <svg viewBox="0 0 256 256" width="16" height="16">
        <circle cx="128" cy="128" r="78" stroke="#e8a33d" strokeWidth="36" strokeLinecap="round" fill="none" strokeDasharray="368 122" transform="rotate(38 128 128)" />
      </svg>
    </span>
  );
}

export default function ChatPane() {
  const { chat, streaming, chatBusy, addUserMessage, setChatBusy, workflows, teams } = useHub();
  const gate = workflows.find((w) => w.state.startsWith("awaiting"));
  const gateTeam = gate ? teams.find((t) => t.id === gate.teamId)?.name : null;
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chat.length, streaming]);

  const send = async (text?: string) => {
    const message = (text ?? input).trim();
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
      inputRef.current?.focus();
    }
  };

  return (
    <section className="panel chat">
      <h2>Chat</h2>
      {gate && (
        <p className="gate-banner">
          {gateTeam ?? gate.teamId} is waiting on you — your next message answers them
        </p>
      )}
      <div className="messages">
        {chat.length === 0 && !streaming && (
          <div className="welcome">
            <p className="welcome-title">This is your company.</p>
            <p className="welcome-sub">
              Ask anything, or hand a team a mission. Some ideas:
            </p>
            {SUGGESTIONS.map((s) => (
              <button key={s} className="suggestion" onClick={() => void send(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        {chat.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role !== "user" && <Avatar role={m.role} />}
            <div className="bubble">{m.role === "assistant" ? renderMarkdown(m.text) : m.text}</div>
          </div>
        ))}
        {streaming && (
          <div className="msg assistant">
            <Avatar role="assistant" />
            <div className="bubble">{streaming}</div>
          </div>
        )}
        {chatBusy && !streaming && (
          <div className="thinking" aria-label="thinking">
            <i /><i /><i />
          </div>
        )}
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
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          placeholder={gate ? "The team asked you something — just answer here" : 'Ask anything — try "let\'s build an online store"'}
          rows={2}
          autoFocus
        />
        <button type="submit" disabled={chatBusy || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
