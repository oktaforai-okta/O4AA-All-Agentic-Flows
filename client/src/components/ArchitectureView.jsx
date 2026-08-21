import React from 'react';
import MermaidDiagram from './MermaidDiagram.jsx';
import { ARCHITECTURE } from '../architecture.js';

export default function ArchitectureView({ flow }) {
  const arch = ARCHITECTURE[flow.id];
  if (!arch) {
    return <div className="tab-empty">No architecture write-up for this flow yet.</div>;
  }

  return (
    <div className="architecture-view">
      <h2>{flow.name}</h2>
      <p className="architecture-summary">{arch.summary}</p>

      <h3>Sequence</h3>
      <div className="architecture-steps">
        {arch.steps.map((s) => (
          <div key={s.id} className="architecture-step">
            <div className="architecture-step-head">
              <span className="architecture-step-id">{s.id}</span>
              <span className="architecture-step-title">{s.title}</span>
              <span className="architecture-step-route">
                {s.from} <span className="arrow">›</span> {s.to}
              </span>
            </div>
            <p>{s.description}</p>
          </div>
        ))}
      </div>

      <h3>Diagram</h3>
      <MermaidDiagram source={arch.diagram} />
    </div>
  );
}
