import { Router } from 'express';
import { config } from '../config.js';

const router = Router();

// Pull the <Assertion> element out of a decoded SAML Response. Handles any
// namespace prefix (saml2:Assertion, saml:Assertion, Assertion).
function extractAssertion(xml) {
  const open = xml.match(/<(?:([\w.-]+):)?Assertion[\s>]/);
  if (!open) return null;
  const prefix = open[1] ? `${open[1]}:` : '';
  const closeTag = `</${prefix}Assertion>`;
  const start = xml.indexOf(open[0]);
  const end = xml.indexOf(closeTag);
  if (start === -1 || end === -1) return null;
  return xml.slice(start, end + closeTag.length);
}

function firstMatch(xml, re) {
  const m = xml.match(re);
  return m ? m[1].trim() : null;
}

// Best-effort parse of NameID + a couple of common attributes, for display only.
function parseSubject(xml) {
  const nameId = firstMatch(xml, /<(?:[\w.-]+:)?NameID[^>]*>([^<]+)<\/(?:[\w.-]+:)?NameID>/);
  const attr = (name) =>
    firstMatch(
      xml,
      new RegExp(
        `<(?:[\\w.-]+:)?Attribute[^>]*Name="${name}"[^>]*>\\s*<(?:[\\w.-]+:)?AttributeValue[^>]*>([^<]+)<`,
        'i'
      )
    );
  return {
    sub: nameId,
    email: attr('email') || attr('mail') || nameId,
    name: attr('displayName') || attr('firstName') || nameId,
  };
}

function acsUrl() {
  return `${config.appBaseUrl.replace(/\/$/, '')}${config.saml.acsPath}`;
}

// Build the captured T1 "SAML SSO" step for the visualization UI.
function buildSamlLoginStep(subject, assertionB64, { pasted = false } = {}) {
  const masked =
    assertionB64.length > 24 ? `${assertionB64.slice(0, 16)}…${assertionB64.slice(-8)}` : assertionB64;
  return {
    id: 'T1',
    title: pasted ? 'SAML SSO (Pasted Assertion)' : 'SAML SSO (IdP-Initiated)',
    badge: 'SAML',
    from: 'User',
    to: 'SP (Agent App)',
    ok: true,
    request: {
      method: 'POST',
      url: pasted ? `${config.appBaseUrl.replace(/\/$/, '')}/api/saml/paste` : acsUrl(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `SAMLResponse=${masked}&RelayState=`,
    },
    response: {
      status: 200,
      headers: { 'Content-Type': 'text/html' },
      body: {
        subject,
        assertion_b64: masked,
        note: pasted
          ? 'Assertion pasted into the UI for local testing; used as subject_token at T2.'
          : 'Assertion captured; used as subject_token at T2.',
      },
    },
    token: null,
    code: pasted
      ? `# Assertion pasted directly into the UI (local testing).\n# It becomes the subject_token for the T2 saml2 token-exchange.`
      : `# Okta IdP-initiated SSO auto-POSTs the SAML assertion to the SP ACS:\nPOST ${acsUrl()}\nContent-Type: application/x-www-form-urlencoded\n\nSAMLResponse=<base64 SAML response>&RelayState=<optional>`,
  };
}

// Normalize a pasted value to SAML XML: accept raw XML, standard/URL-safe base64,
// and URL-encoded base64 (a full <Response> or a bare <Assertion>).
function normalizeToXml(input) {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  if (trimmed.startsWith('<')) return trimmed; // already XML
  let b64 = trimmed.replace(/\s+/g, '');
  if (b64.includes('%')) {
    try {
      b64 = decodeURIComponent(b64);
    } catch {
      /* leave as-is */
    }
  }
  b64 = b64.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = Buffer.from(b64, 'base64').toString('utf8');
  return decoded.includes('<') ? decoded : trimmed;
}

// Turn SAML XML into the session fields the flow needs. Returns null if no assertion.
function sessionFromXml(xml, opts = {}) {
  const assertionXml = extractAssertion(xml);
  if (!assertionXml) return null;
  // subject_token for the T2 saml2 token-exchange = base64 of the assertion XML.
  const assertionB64 = Buffer.from(assertionXml, 'utf8').toString('base64');
  const subject = parseSubject(xml);
  return {
    samlUser: subject,
    samlAssertion: assertionB64,
    samlLoginStep: buildSamlLoginStep(subject, assertionB64, opts),
  };
}

// Start SAML by redirecting the browser to Okta's IdP-initiated SSO URL.
router.get('/saml/login', (req, res, next) => {
  if (!config.saml.idpInitiatedUrl) {
    return next(new Error('SAML not configured — set SAML_IDP_INITIATED_URL in .env'));
  }
  res.redirect(config.saml.idpInitiatedUrl);
});

// Assertion Consumer Service — Okta auto-POSTs SAMLResponse here after login.
// NOTE: this is a cross-site POST from okta.com, so the session cookie must be
// SameSite=None; Secure for the existing session to be preserved (set in prod).
router.post('/saml/acs', (req, res) => {
  try {
    const samlResponse = req.body.SAMLResponse;
    if (!samlResponse) return res.redirect(`${config.appBaseUrl}/?saml=error`);

    const xml = Buffer.from(samlResponse, 'base64').toString('utf8');
    const sess = sessionFromXml(xml);
    if (!sess) return res.redirect(`${config.appBaseUrl}/?saml=error`);
    Object.assign(req.session, sess);

    res.redirect(`${config.appBaseUrl}/?flow=hi-saml&saml=success`);
  } catch (err) {
    console.error('SAML ACS error:', err);
    res.redirect(`${config.appBaseUrl}/?saml=error`);
  }
});

// Local testing: paste a SAML assertion (or full base64 SAMLResponse) directly.
// This is a same-origin fetch, so the session cookie is preserved without the
// SameSite constraints of the cross-site IdP-initiated POST.
router.post('/saml/paste', (req, res) => {
  try {
    const { assertion } = req.body || {};
    const xml = normalizeToXml(assertion);
    if (!xml.includes('<')) {
      return res.status(400).json({ ok: false, error: 'Could not read the input as SAML XML or base64.' });
    }
    const sess = sessionFromXml(xml, { pasted: true });
    if (!sess) {
      return res.status(400).json({ ok: false, error: 'No <Assertion> element found in the input.' });
    }
    Object.assign(req.session, sess);
    res.json({ ok: true, samlUser: sess.samlUser, loginStep: sess.samlLoginStep });
  } catch (err) {
    console.error('SAML paste error:', err);
    res.status(400).json({ ok: false, error: err.message });
  }
});

export default router;
