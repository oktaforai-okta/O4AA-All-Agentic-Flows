import React, { useState } from 'react';
import { pasteSamlAssertion, samlLogin } from '../api.js';

// Shown when the SAML flow is opened but no assertion is loaded yet. Two ways in:
//  1) IdP-initiated SSO — Okta posts the assertion to the app's ACS (works on Render).
//  2) Paste a SAML assertion (local testing — same-origin, no SameSite issues).
export default function SamlSetup({ flow, onReady }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function submit() {
    const assertion = value.trim();
    if (!assertion || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await pasteSamlAssertion(assertion);
      if (res.ok) onReady();
      else setError(res.error || 'Could not parse the assertion.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="saml-setup">
      <div className="saml-setup-card">
        <h2>{flow.name}</h2>

        {/* Option 1 — IdP-initiated SSO; Okta posts the assertion to the ACS */}
        <div className="saml-option">
          <span className="saml-option-tag">Option 1 · Post assertion to the app</span>
          <p>
            Sign in via Okta (IdP-initiated). Okta authenticates you and POSTs the SAML assertion to the
            app’s ACS endpoint, which starts the flow automatically. Requires HTTPS — use this on the
            deployed (Render) site.
          </p>
          <div className="saml-setup-actions">
            <button className="btn-secondary" disabled={busy} onClick={() => samlLogin(flow.id)}>
              Sign in with Okta (IdP-initiated) ↗
            </button>
          </div>
        </div>

        <div className="saml-divider"><span>or</span></div>

        {/* Option 2 — paste the assertion (best for local testing) */}
        <div className="saml-option">
          <span className="saml-option-tag">Option 2 · Paste assertion</span>
          <p>
            Paste a SAML assertion — the raw <code>&lt;Assertion&gt;</code> XML, the decoded
            <code> &lt;Response&gt;</code>, or the base64 <code>SAMLResponse</code>. Best for local testing.
            The agent exchanges it for a refresh token → id-JAG → access token, then calls the inventory MCP.
          </p>
          <textarea
            className="saml-textarea"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Paste base64 SAMLResponse or SAML assertion XML here…"
            rows={9}
            disabled={busy}
            spellCheck={false}
          />
          {error && <div className="saml-error">{error}</div>}
          <div className="saml-setup-actions">
            <button className="btn-primary" disabled={busy || !value.trim()} onClick={submit}>
              {busy ? 'Validating…' : 'Use assertion'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
