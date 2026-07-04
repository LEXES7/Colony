import type { ReactNode } from "react";

/**
 * Minimal, safe markdown renderer for chat bubbles. Builds React elements
 * directly (never innerHTML), so agent output can't inject markup. Supports
 * code fences, inline code, bold, and paragraphs — enough for agent answers.
 */
export function renderMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const parts = text.split(/```(\w*)\n?([\s\S]*?)```/g);
  // split() with two capture groups yields [text, lang, code, text, lang, code, ...]
  for (let i = 0; i < parts.length; i += 3) {
    const plain = parts[i];
    if (plain) nodes.push(...renderInline(plain, `t${i}`));
    const code = parts[i + 2];
    if (code !== undefined) {
      nodes.push(
        <pre key={`c${i}`} className="codeblock">
          <code>{code.replace(/\n$/, "")}</code>
        </pre>
      );
    }
  }
  return nodes;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  // bold first (bold spans may contain inline code), code nested inside
  const segments = text.split(/\*\*([^*]+)\*\*/g);
  segments.forEach((segment, i) => {
    if (i % 2 === 1) {
      out.push(<strong key={`${keyPrefix}-b${i}`}>{renderCode(segment, `${keyPrefix}-b${i}`)}</strong>);
    } else if (segment) {
      out.push(...renderCode(segment, `${keyPrefix}-s${i}`));
    }
  });
  return out;
}

function renderCode(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = [];
  const parts = text.split(/`([^`\n]+)`/g);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      out.push(
        <code key={`${keyPrefix}-c${i}`} className="inline-code">
          {part}
        </code>
      );
    } else if (part) {
      out.push(part);
    }
  });
  return out;
}
