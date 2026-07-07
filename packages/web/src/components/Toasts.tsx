import { useEffect, useRef } from "react";
import { useHub } from "./../store";

const TOAST_MS = 6000;

/** Bottom-right slide-in notifications for moments that need the user. */
export default function Toasts() {
  const { toasts, dismissToast } = useHub();
  const timers = useRef(new Map<number, number>());

  useEffect(() => {
    for (const t of toasts) {
      if (!timers.current.has(t.id)) {
        timers.current.set(
          t.id,
          window.setTimeout(() => {
            dismissToast(t.id);
            timers.current.delete(t.id);
          }, TOAST_MS)
        );
      }
    }
  }, [toasts, dismissToast]);

  if (toasts.length === 0) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
