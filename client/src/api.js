export async function getMe() {
  const res = await fetch('/api/me', { credentials: 'include' });
  return res.json();
}

export async function ask(question, flow = 'xaa') {
  const res = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ question, flow }),
  });
  if (!res.ok && res.status === 401) throw new Error('not_authenticated');
  return res.json();
}

export async function revokeSts() {
  const res = await fetch('/api/sts/revoke', {
    method: 'POST',
    credentials: 'include',
  });
  return res.json();
}

export async function logout() {
  await fetch('/api/logout', { method: 'POST', credentials: 'include' });
}

export function login(flowId) {
  window.location.href = `/api/login${flowId ? `?flow=${encodeURIComponent(flowId)}` : ''}`;
}

export function a2aLogin(flowId) {
  window.location.href = `/api/a2a/login${flowId ? `?flow=${encodeURIComponent(flowId)}` : ''}`;
}

export function samlLogin(flowId) {
  window.location.href = `/api/saml/login${flowId ? `?flow=${encodeURIComponent(flowId)}` : ''}`;
}

export function webappLogin(flowId) {
  window.location.href = `/api/webapp/login${flowId ? `?flow=${encodeURIComponent(flowId)}` : ''}`;
}

// Unauthenticated — same endpoint an external cron/scheduler would hit directly.
export async function runScheduled(flow, tool) {
  const res = await fetch('/api/scheduler/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flow, tool }),
  });
  return res.json();
}

// Local testing: submit a pasted SAML assertion (or base64 SAMLResponse) to the server.
export async function pasteSamlAssertion(assertion) {
  const res = await fetch('/api/saml/paste', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ assertion }),
  });
  return res.json();
}
