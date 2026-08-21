import React, { useEffect, useRef, useState } from 'react';

let mermaidPromise = null;
// Lazy-load mermaid (~500KB) only when an Architecture tab is actually opened,
// and only once per session.
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        theme: 'base',
        themeVariables: {
          primaryColor: '#eaf7f0',
          primaryBorderColor: '#16c784',
          primaryTextColor: '#0b1220',
          lineColor: '#8b93a7',
          actorBkg: '#0d1424',
          actorBorder: '#16c784',
          actorTextColor: '#e6edf3',
          signalColor: '#374151',
          signalTextColor: '#0b1220',
          fontFamily: 'inherit',
        },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

let idCounter = 0;

export default function MermaidDiagram({ source }) {
  const containerRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadMermaid()
      .then((mermaid) => mermaid.render(`mermaid-${idCounter++}`, source))
      .then(({ svg }) => {
        if (!cancelled && containerRef.current) containerRef.current.innerHTML = svg;
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  if (error) return <div className="tab-empty">Diagram failed to render: {error}</div>;
  return <div className="mermaid-diagram" ref={containerRef} />;
}
