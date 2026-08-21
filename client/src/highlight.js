// Lightweight, dependency-free syntax highlighting for the request/response
// panels — everything here escapes HTML first, then wraps recognized tokens in
// <span> tags with fixed class names (no attacker-controlled markup ever reaches
// the DOM, even though the underlying values can be arbitrary decoded JWT claims).
export function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Form-urlencoded request bodies, one `key=value` pair per line (params.js joins
// them with '\n&'). Highlights the key distinctly from the value so long encoded
// values (tokens, assertions) don't visually blend into the param name.
export function highlightFormBody(text) {
  return String(text)
    .split('\n')
    .map((line) => {
      const leadingAmp = line.startsWith('&');
      const rest = leadingAmp ? line.slice(1) : line;
      const eq = rest.indexOf('=');
      const prefix = leadingAmp ? '&amp;' : '';
      if (eq === -1) return prefix + escapeHtml(rest);
      const key = escapeHtml(rest.slice(0, eq));
      const value = escapeHtml(rest.slice(eq + 1));
      return `${prefix}<span class="kv-key">${key}</span><span class="kv-eq">=</span><span class="kv-value">${value}</span>`;
    })
    .join('\n');
}

// JSON text (response bodies, headers, decoded JWT header/payload). Classic
// regex tokenizer: strings (keys vs. values distinguished by a trailing colon),
// numbers, booleans, null — punctuation/braces are left as plain text.
export function highlightJson(text) {
  const escaped = escapeHtml(text);
  return escaped.replace(
    /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
    (match) => {
      let cls = 'jv-number';
      if (/^"/.test(match)) {
        cls = /:\s*$/.test(match) ? 'jv-key' : 'jv-string';
      } else if (/^(true|false)$/.test(match)) {
        cls = 'jv-boolean';
      } else if (/^null$/.test(match)) {
        cls = 'jv-null';
      }
      return `<span class="${cls}">${match}</span>`;
    }
  );
}
