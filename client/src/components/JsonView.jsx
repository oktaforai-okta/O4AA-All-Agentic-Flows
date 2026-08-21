import React from 'react';
import { highlightJson } from '../highlight.js';

export default function JsonView({ value }) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <pre className="jsonview">
      <code dangerouslySetInnerHTML={{ __html: highlightJson(text) }} />
    </pre>
  );
}
