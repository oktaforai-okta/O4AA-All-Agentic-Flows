import React, { useState } from 'react';
import { highlightFormBody, highlightJson } from '../highlight.js';

// mode: undefined (plain text, e.g. the cURL "Code" tab) | 'form' (key=value
// request bodies) | 'json' (JSON request bodies). Copying always copies the
// original raw `text`, regardless of how it's highlighted for display.
export default function CodeBlock({ text, label, mode }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable */
    }
  }

  const html = mode === 'form' ? highlightFormBody(text) : mode === 'json' ? highlightJson(text) : null;

  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        {label && <span className="codeblock-label">{label}</span>}
        <button className="copy-btn" onClick={copy}>
          {copied ? '✓ Copied' : '⧉ Copy'}
        </button>
      </div>
      <pre>{html ? <code dangerouslySetInnerHTML={{ __html: html }} /> : <code>{text}</code>}</pre>
    </div>
  );
}
