import { Router } from 'express';
import { config } from '../config.js';
import {
  requestIdJag,
  exchangeForAccessToken,
  TOKEN_TYPE_ID_TOKEN,
  TOKEN_TYPE_ACCESS_TOKEN,
} from '../xaa/tokenExchange.js';
import { requestVaultedSecret, requestServiceAccount } from '../xaa/credentialExchange.js';
import { requestServiceToken, requestServiceIdJag, exchangeServiceIdJag } from '../xaa/serviceFlow.js';
import { exchangeSamlForRefreshToken, exchangeRefreshForIdJag } from '../xaa/samlFlow.js';
import { requestResourceToken, readPullRequests, openPullRequest, revokeStsToken } from '../xaa/stsBroker.js';
import {
  requestIdJagForInventory,
  exchangeForInventoryToken,
  requestIdJagForFinance,
  exchangeForFinanceToken,
} from '../xaa/a2aFlow.js';
import { callMcpTool } from '../mcp/inventoryServer.js';
import { validateAccessToken } from '../util/verifyToken.js';
import { decodeJwt } from '../util/jwt.js';

const router = Router();

// Deterministic routing of a question to an MCP tool.
function routeTool(question) {
  const q = (question || '').toLowerCase();
  if (q.includes('shipment') || q.includes('shipping') || q.includes('delivery')) {
    return 'get_last_5_shipments';
  }
  // inventory / stock / default
  return 'get_inventory_details';
}

// Finance (A2A) tool routing.
function routeFinanceTool(question) {
  const q = (question || '').toLowerCase();
  if (q.includes('payment') || q.includes('invoice') || q.includes('billing')) {
    return 'get_customer_payment_details';
  }
  return 'get_customer_arr';
}

function maskToken(t) {
  if (!t || t.length < 24) return t;
  return `${t.slice(0, 12)}…${t.slice(-8)}`;
}

// Build the MCP tool-call step manually — it's an in-process call, not HTTP, but we
// render it with the same shape and show the bearer access token in use.
function buildMcpStep(toolName, accessToken, result, validation, opts = {}) {
  const { id = 'T4', from = 'Agent', to = 'Inventory MCP' } = opts;
  const status = validation.ok ? 200 : validation.verified ? 403 : 401;
  const body = validation.ok
    ? { tokenValidation: validation, data: result }
    : {
        error: validation.verified ? 'insufficient_scope' : 'invalid_token',
        error_description: validation.verified
          ? `Token is missing required scope(s): ${validation.requiredScopes.join(', ')}`
          : `Access token failed validation${validation.error ? ` (${validation.error})` : ''}`,
        tokenValidation: validation,
      };
  return {
    id,
    title: `MCP Tool Call · ${toolName}`,
    badge: 'MCP',
    from,
    to,
    ok: validation.ok,
    request: {
      method: 'POST',
      url: `${config.agent.resource || 'mcp://inventory/'}tools/call`,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${maskToken(accessToken)}`,
      },
      body: JSON.stringify({ method: 'tools/call', params: { name: toolName, arguments: {} } }, null, 2),
    },
    response: { status, headers: { 'Content-Type': 'application/json' }, body },
    token: decodeJwt(accessToken),
    code: `# MCP tools/call with the resource access token\ncurl -X POST '<mcp-endpoint>/tools/call' \\\n  -H 'Authorization: Bearer ${maskToken(accessToken)}' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify({ name: toolName, arguments: {} })}'`,
  };
}

// T3 of the Secrets / Service Account flows: call the MCP with HTTP Basic auth
// using the retrieved credentials. The MCP validates them against config.mcpBasic.
function validateBasic(creds) {
  return !!(
    config.mcpBasic.username &&
    config.mcpBasic.password &&
    creds &&
    creds.username === config.mcpBasic.username &&
    creds.password === config.mcpBasic.password
  );
}

function buildBasicMcpStep(toolName, creds, result, ok) {
  const masked = '•'.repeat(Math.max(4, (creds?.password || '').length));
  const encoded = Buffer.from(`${creds?.username || ''}:${masked}`).toString('base64');
  const status = ok ? 200 : 401;
  const body = ok
    ? { basicAuth: { username: creds.username, validated: true }, data: result }
    : {
        error: 'invalid_credentials',
        error_description: 'The presented Basic credentials did not match the MCP server configuration.',
        basicAuth: { username: creds?.username, validated: false },
      };
  return {
    id: 'T3',
    title: `MCP Tool Call · ${toolName}`,
    badge: 'MCP',
    from: 'Agent',
    to: 'Inventory MCP',
    ok,
    request: {
      method: 'POST',
      url: 'mcp://inventory/tools/call',
      headers: { 'Content-Type': 'application/json', Authorization: `Basic ${encoded}` },
      body: JSON.stringify({ method: 'tools/call', params: { name: toolName, arguments: {} } }, null, 2),
    },
    response: { status, headers: { 'Content-Type': 'application/json' }, body },
    token: null,
    code: `# MCP tools/call with HTTP Basic auth (creds from the secret/service account)\ncurl -X POST '<mcp-endpoint>/tools/call' \\\n  -u '${creds?.username || '<username>'}:<password>' \\\n  -H 'Content-Type: application/json' \\\n  -d '${JSON.stringify({ name: toolName, arguments: {} })}'`,
  };
}

function summarize(toolName, result) {
  if (toolName === 'get_inventory_details') {
    const low = result.items.filter((i) => i.quantity <= i.reorderLevel);
    const lines = result.items.map((i) => `• ${i.name} (${i.sku}) — ${i.quantity} in stock @ ${i.location}`);
    let answer = `Here are the current inventory details (${result.count} SKUs):\n\n${lines.join('\n')}`;
    if (low.length) {
      answer += `\n\n⚠️ ${low.length} item(s) at or below reorder level: ${low.map((i) => i.sku).join(', ')}.`;
    }
    return answer;
  }
  if (toolName === 'get_last_5_shipments') {
    const lines = result.shipments.map(
      (s) => `• ${s.id} — ${s.status} via ${s.carrier} → ${s.destination} (${s.items} items, ${s.date})`
    );
    return `Here are the last ${result.count} shipments:\n\n${lines.join('\n')}`;
  }
  if (toolName === 'get_customer_arr') {
    const lines = result.customers.map(
      (c) => `• ${c.customer} (${c.segment}) — $${c.arr.toLocaleString()} ARR, renews ${c.renewalDate} [${c.health}]`
    );
    return `Customer ARR (${result.count}):\n\n${lines.join('\n')}`;
  }
  if (toolName === 'get_customer_payment_details') {
    const lines = result.payments.map(
      (p) => `• ${p.customer} — ${p.invoice}: $${p.amount.toLocaleString()} ${p.status} via ${p.method} (${p.date})`
    );
    return `Customer payment details (${result.count}):\n\n${lines.join('\n')}`;
  }
  return JSON.stringify(result, null, 2);
}

// Cross-App Access: id-JAG → access token → token-validated MCP call.
// subjectToken/subjectTokenType feed T2 — the user's id_token for 'xaa', or the
// separate web app's access_token for 'xaa-webapp'.
async function runXaaFlow(subjectToken, subjectTokenType, toolName, steps) {
  const t2 = await requestIdJag(subjectToken, subjectTokenType);
  steps.push(t2.step);
  if (!t2.ok) return 'The token exchange (id-JAG) request failed — see step T2 for the error response.';

  const t3 = await exchangeForAccessToken(t2.idJag);
  steps.push(t3.step);
  if (!t3.ok) return 'The access token request failed — see step T3 for the error response.';

  const requiredScopes = (config.resource.scopes || '').split(' ').filter(Boolean);
  const validation = await validateAccessToken(t3.accessToken, requiredScopes);
  if (!validation.ok) {
    steps.push(buildMcpStep(toolName, t3.accessToken, null, validation));
    return validation.verified
      ? `Access denied: the token is missing the required scope(s) ${requiredScopes.join(', ')}. See step T4.`
      : `Access denied: the access token failed validation${validation.error ? ` (${validation.error})` : ''}. See step T4.`;
  }

  const result = await callMcpTool(toolName);
  steps.push(buildMcpStep(toolName, t3.accessToken, result, validation));
  return summarize(toolName, result);
}

// HI - SAML - Cross-App Access: SAML assertion → refresh token → id-JAG → access token → MCP.
async function runSamlFlow(samlAssertion, toolName, steps) {
  const t2 = await exchangeSamlForRefreshToken(samlAssertion);
  steps.push(t2.step);
  if (!t2.ok) return 'The SAML → refresh token exchange failed — see step T2 for the error response.';

  const t3 = await exchangeRefreshForIdJag(t2.refreshToken);
  steps.push(t3.step);
  if (!t3.ok) return 'The refresh token → id-JAG exchange failed — see step T3 for the error response.';

  // T4 is the same jwt-bearer id-JAG → access token step as XAA; relabel its id.
  // Redeem as the SAML flow's own agent client_id — the id-JAG was minted under it.
  const t4 = await exchangeForAccessToken(t3.idJag, config.saml.clientId);
  t4.step.id = 'T4';
  steps.push(t4.step);
  if (!t4.ok) return 'The access token request failed — see step T4 for the error response.';

  const requiredScopes = (config.resource.scopes || '').split(' ').filter(Boolean);
  const validation = await validateAccessToken(t4.accessToken, requiredScopes);
  if (!validation.ok) {
    steps.push(buildMcpStep(toolName, t4.accessToken, null, validation, { id: 'T5' }));
    return validation.verified
      ? `Access denied: the token is missing the required scope(s) ${requiredScopes.join(', ')}. See step T5.`
      : `Access denied: the access token failed validation${validation.error ? ` (${validation.error})` : ''}. See step T5.`;
  }

  const result = await callMcpTool(toolName);
  steps.push(buildMcpStep(toolName, t4.accessToken, result, validation, { id: 'T5' }));
  return summarize(toolName, result);
}

// Agent-to-Agent: user/service → Inventory Agent → (via Org) → Finance Agent → Finance MCP.
// All id-JAG requests (T2, T4) go to the Org auth server; each agent redeems at its own server.
// subjectToken/subjectTokenType feed T2 (user id_token for HI, service token for NHI).
async function runA2aChain(subjectToken, subjectTokenType, financeTool, steps) {
  const t2 = await requestIdJagForInventory(subjectToken, subjectTokenType);
  steps.push(t2.step);
  if (!t2.ok) return 'The id-JAG request for the Inventory Agent failed — see step T2.';

  const t3 = await exchangeForInventoryToken(t2.idJag);
  steps.push(t3.step);
  if (!t3.ok) return 'The Inventory Agent token exchange failed — see step T3.';

  const t4 = await requestIdJagForFinance(t3.accessToken);
  steps.push(t4.step);
  if (!t4.ok) return 'The id-JAG request for the Finance Agent failed — see step T4.';

  const t5 = await exchangeForFinanceToken(t4.idJag);
  steps.push(t5.step);
  if (!t5.ok) return 'The Finance access token request failed — see step T5.';

  const requiredScopes = (config.a2a.financeMcp.scopes || '').split(' ').filter(Boolean);
  const validation = await validateAccessToken(t5.accessToken, requiredScopes, {
    issuer: config.a2a.financeMcp.issuer,
    jwksUri: config.a2a.financeMcp.jwksUri,
  });
  const mcpOpts = { id: 'T6', from: 'Finance Agent', to: 'Finance MCP' };
  if (!validation.ok) {
    steps.push(buildMcpStep(financeTool, t5.accessToken, null, validation, mcpOpts));
    return validation.verified
      ? `Access denied: the Finance token is missing the required scope(s) ${requiredScopes.join(', ')}. See step T6.`
      : `Access denied: the Finance access token failed validation${validation.error ? ` (${validation.error})` : ''}. See step T6.`;
  }

  const result = await callMcpTool(financeTool);
  steps.push(buildMcpStep(financeTool, t5.accessToken, result, validation, mcpOpts));
  return summarize(financeTool, result);
}

// HI - A2A: T1 = user login (prepended client-side) → chain with the user ACCESS token.
async function runHiA2aFlow(userAccessToken, financeTool, steps) {
  return runA2aChain(userAccessToken, 'urn:ietf:params:oauth:token-type:access_token', financeTool, steps);
}

// NHI - A2A: T1 = A2A service app client_credentials → chain with the service access token.
async function runNhiA2aFlow(financeTool, steps) {
  if (!config.a2a.service.clientId || !config.a2a.service.privateKeyFile) {
    return 'NHI - A2A flow is not configured — set A2A_SERVICE_CLIENT_ID and A2A_SERVICE_PRIVATE_KEY_FILE in .env.a2a.';
  }
  const t1 = await requestServiceToken(config.a2a.service);
  steps.push(t1.step);
  if (!t1.ok) return 'The client_credentials request failed — see step T1.';
  return runA2aChain(t1.token, 'urn:ietf:params:oauth:token-type:access_token', financeTool, steps);
}

// Secrets / Service Account: retrieve vaulted creds, then call the MCP with HTTP Basic auth.
async function runCredentialFlow(flow, idToken, toolName, steps) {
  const isSecret = flow === 'secrets';
  const label = isSecret ? 'vaulted secret' : 'service account';

  const t2 = isSecret ? await requestVaultedSecret(idToken) : await requestServiceAccount(idToken);
  steps.push(t2.step);
  if (!t2.ok) return `The ${label} request failed — see step T2 for the error response.`;

  const basicOk = validateBasic(t2.creds);
  if (!basicOk) {
    steps.push(buildBasicMcpStep(toolName, t2.creds, null, false));
    return 'Access denied: the retrieved credentials did not match the MCP server (HTTP 401). See step T3.';
  }

  const result = await callMcpTool(toolName);
  steps.push(buildBasicMcpStep(toolName, t2.creds, result, true));
  return summarize(toolName, result);
}

// Service App: client_credentials → id-JAG → access token → token-validated MCP call.
async function runServiceFlow(toolName, steps) {
  if (!config.service.clientId || !config.service.privateKeyFile) {
    return 'Service App flow is not configured — set SERVICE_CLIENT_ID and SERVICE_PRIVATE_KEY_FILE.';
  }

  const t1 = await requestServiceToken();
  steps.push(t1.step);
  if (!t1.ok) return 'The client_credentials request failed — see step T1 for the error response.';

  const t2 = await requestServiceIdJag(t1.token);
  steps.push(t2.step);
  if (!t2.ok) return 'The token exchange (id-JAG) request failed — see step T2 for the error response.';

  const t3 = await exchangeServiceIdJag(t2.idJag);
  steps.push(t3.step);
  if (!t3.ok) return 'The access token request failed — see step T3 for the error response.';

  const requiredScopes = (config.resource.scopes || '').split(' ').filter(Boolean);
  const validation = await validateAccessToken(t3.accessToken, requiredScopes);
  if (!validation.ok) {
    steps.push(buildMcpStep(toolName, t3.accessToken, null, validation));
    return validation.verified
      ? `Access denied: the token is missing the required scope(s) ${requiredScopes.join(', ')}. See step T4.`
      : `Access denied: the access token failed validation${validation.error ? ` (${validation.error})` : ''}. See step T4.`;
  }

  const result = await callMcpTool(toolName);
  steps.push(buildMcpStep(toolName, t3.accessToken, result, validation));
  return summarize(toolName, result);
}

// STS broker (GitHub): resource token exchange (with consent loop) → read/create PR.
async function runStsGithubFlow(idToken, steps, action) {
  if (!config.sts.resource) {
    return { answer: 'STS GitHub flow is not configured — set GITHUB_RESOURCE.' };
  }

  const t2 = await requestResourceToken(idToken);
  steps.push(t2.step);
  if (!t2.ok) {
    if (t2.interactionUri) {
      return {
        answer:
          'Consent required: authorize the GitHub connection, then click Retry to re-run the request.',
        interaction: { uri: t2.interactionUri },
      };
    }
    return { answer: 'The resource token request failed — see step T2 for the error response.' };
  }

  const stsAccessToken = t2.accessToken;

  if (action === 'create') {
    const t3 = await openPullRequest(stsAccessToken);
    steps.push(t3.step);
    if (!t3.ok) {
      return {
        answer: `The GitHub create-pull-request call failed (HTTP ${t3.step.response.status}) — see step T3. A write call like this is what actually exercises the brokered token's permissions.`,
        stsAccessToken,
      };
    }
    const pr = t3.pr;
    return {
      answer: pr?.html_url
        ? `Pull request opened: #${pr.number} → ${pr.html_url}`
        : 'Create pull request completed — see step T3 for the GitHub response.',
      stsAccessToken,
    };
  }

  const t3 = await readPullRequests(stsAccessToken);
  steps.push(t3.step);
  if (!t3.ok) {
    return { answer: 'The GitHub pull request read failed — see step T3 for the response.', stsAccessToken };
  }

  const pulls = t3.pulls || [];
  return {
    answer: pulls.length
      ? `Found ${pulls.length} pull request(s):\n\n` +
        pulls.map((p) => `• #${p.number} ${p.title} (${p.state}) — ${p.user?.login ?? 'unknown'}`).join('\n')
      : 'No pull requests found in the repository.',
    stsAccessToken,
  };
}

router.post('/ask', async (req, res) => {
  const { question, flow = 'xaa' } = req.body;

  // A2A flows use the A2A login context; other user flows use the regular login.
  if (flow === 'hi-a2a') {
    if (!req.session.a2aAccessToken) return res.status(401).json({ error: 'not_authenticated' });
  } else if (flow === 'nhi-a2a') {
    if (!req.session.user && !req.session.a2aUser) return res.status(401).json({ error: 'not_authenticated' });
  } else if (flow === 'hi-saml') {
    if (!req.session.samlAssertion) return res.status(401).json({ error: 'not_authenticated' });
  } else if (flow === 'xaa-webapp') {
    if (!req.session.webappAccessToken) return res.status(401).json({ error: 'not_authenticated' });
  } else if (!req.session.user) {
    return res.status(401).json({ error: 'not_authenticated' });
  }

  const toolName = routeTool(question);
  const steps = [];

  try {
    let answer;
    let interaction;
    if (flow === 'secrets' || flow === 'service-account') {
      answer = await runCredentialFlow(flow, req.session.idToken, toolName, steps);
    } else if (flow === 'client-credentials') {
      answer = await runServiceFlow(toolName, steps);
    } else if (flow === 'sts-github') {
      const action = /\b(create|open|new|raise)\b/i.test(question || '') ? 'create' : 'read';
      const r = await runStsGithubFlow(req.session.idToken, steps, action);
      answer = r.answer;
      interaction = r.interaction;
      if (r.stsAccessToken) req.session.stsAccessToken = r.stsAccessToken;
    } else if (flow === 'hi-saml') {
      answer = await runSamlFlow(req.session.samlAssertion, toolName, steps);
    } else if (flow === 'hi-a2a') {
      answer = await runHiA2aFlow(req.session.a2aAccessToken, routeFinanceTool(question), steps);
    } else if (flow === 'nhi-a2a') {
      answer = await runNhiA2aFlow(routeFinanceTool(question), steps);
    } else if (flow === 'xaa-webapp') {
      answer = await runXaaFlow(req.session.webappAccessToken, TOKEN_TYPE_ACCESS_TOKEN, toolName, steps);
    } else {
      answer = await runXaaFlow(req.session.idToken, TOKEN_TYPE_ID_TOKEN, toolName, steps);
    }
    res.json({ answer, toolName, flow, steps, interaction });
  } catch (err) {
    console.error('[ask] unexpected error:', err);
    res.json({
      answer: `Unexpected error while running the chain: ${err.message}`,
      toolName,
      flow,
      steps,
    });
  }
});

// Revoke the user's stored GitHub connection (via an Okta Workflows flow keyed on the
// access token's `uid`) so the next exchange returns interaction_required.
router.post('/sts/revoke', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: 'not_authenticated' });
  }
  try {
    const r = await revokeStsToken({
      accessToken: req.session.accessToken,
      idToken: req.session.idToken,
    });
    if (r.error) {
      return res.json({ answer: r.error, steps: [] });
    }
    if (r.ok) req.session.stsAccessToken = undefined;
    res.json({
      answer: r.ok
        ? 'Revoke flow invoked — the stored GitHub connection was cleared. Run “Read pull requests” again; the next exchange should return interaction_required and re-prompt for consent.'
        : 'The revoke flow returned an error — see step R1 for the response.',
      steps: [r.step],
    });
  } catch (err) {
    console.error('[sts/revoke] error:', err);
    res.json({ answer: `Revoke error: ${err.message}`, steps: [] });
  }
});

// Reused by the unauthenticated scheduler routes — both flows already run on a
// pure service identity, so calling them outside of a user session is legitimate.
export { runServiceFlow, runNhiA2aFlow };

export default router;
