import { useEffect, useRef, useState } from "react";
import { api } from "./../api";
import { renderMarkdown } from "./../markdown";
import { useHub } from "./../store";

export default function ChatPane() {
  const { chat, streaming, chatBusy, addUserMessage, setChatBusy } = useHub();
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
      <h2>Main agent</h2>
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
          placeholder="Ask the main agent — it can consult your project experts"
          rows={2}
        />
        <button type="submit" disabled={chatBusy || !input.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
