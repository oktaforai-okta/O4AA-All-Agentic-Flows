import React, { useState } from 'react';
import SequenceView from './SequenceView.jsx';
import ArchitectureView from './ArchitectureView.jsx';
import { ARCHITECTURE } from '../architecture.js';

export default function SequencePane({ flow, steps }) {
  const [tab, setTab] = useState('sequence');
  const hasArchitecture = !!ARCHITECTURE[flow.id];

  return (
    <section className="sequence-pane">
      {hasArchitecture && (
        <div className="pane-tabs">
          <button className={`pane-tab ${tab === 'sequence' ? 'active' : ''}`} onClick={() => setTab('sequence')}>
            Sequence
          </button>
          <button className={`pane-tab ${tab === 'architecture' ? 'active' : ''}`} onClick={() => setTab('architecture')}>
            Architecture
          </button>
        </div>
      )}
      {tab === 'architecture' && hasArchitecture ? <ArchitectureView flow={flow} /> : <SequenceView steps={steps} />}
    </section>
  );
}
