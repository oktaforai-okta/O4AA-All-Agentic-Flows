import { config } from '../config.js';
import { captureFormPost, captureGet, captureJsonPost } from './capture.js';
import { buildClientAssertion } from './clientAssertion.js';
import { decodeJwt } from '../util/jwt.js';

const GRANT_TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const TOKEN_TYPE_ID_TOKEN = 'urn:ietf:params:oauth:token-type:id_token';
const TOKEN_TYPE_OAUTH_STS = 'urn:okta:params:oauth:token-type:oauth-sts';
const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

/**
 * T2 — STS broker token exchange. Exchanges the user's id_token for a brokered
 * resource (GitHub) access token at the org token endpoint. If Okta has no stored
 * tokens yet it returns HTTP 400 interaction_required + an interaction_uri; after
 * the user consents, the agent retries the identical request and gets HTTP 200.
 */
export async function requestResourceToken(idToken) {
  const clientAssertion = await buildClientAssertion({
    clientId: config.agent.clientId,
    audience: config.sts.assertionAudience,
    kid: config.agent.kid,
    privateKeyFile: config.agent.privateKeyFile,
  });

  const bodyParams = {
    grant_type: GRANT_TOKEN_EXCHANGE,
    requested_token_type: TOKEN_TYPE_OAUTH_STS,
    subject_token: idToken,
    subject_token_type: TOKEN_TYPE_ID_TOKEN,
    resource: config.sts.resource,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: clientAssertion,
  };
  if (config.sts.scopes) bodyParams.scope = config.sts.scopes;

  const { captured, responseBody, ok } = await captureFormPost(
    { id: 'T2', title: 'Resource Token Exchange', badge: 'STS', from: 'Agent', to: 'Okta Org Server', tokenField: 'access_token' },
    config.sts.tokenUrl,
    {},
    bodyParams
  );

  // 400 interaction_required → the user must consent before the retry can succeed.
  let interactionUri = null;
  if (!ok && responseBody && typeof responseBody === 'object' && responseBody.error === 'interaction_required') {
    interactionUri = responseBody.interaction_uri || null;
  }

  return {
    step: captured,
    accessToken: ok && responseBody ? responseBody.access_token : null,
    ok,
    interactionUri,
  };
}

/**
 * T3 — Read GitHub pull requests using the brokered access token.
 */
export async function readPullRequests(accessToken) {
  const { apiBaseUrl, owner, repo } = config.github;
  const url = `${apiBaseUrl}/repos/${owner}/${repo}/pulls?state=all&per_page=5`;

  const { captured, responseBody, ok } = await captureGet(
    { id: 'T3', title: 'Read Pull Requests', badge: 'GitHub', from: 'Agent', to: 'GitHub' },
    url,
    { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' }
  );

  return { step: captured, ok, pulls: ok && Array.isArray(responseBody) ? responseBody : null };
}

/**
 * T3 (create) — Open a GitHub pull request with the brokered token. This is a
 * write call, so it genuinely exercises the token's permissions.
 */
export async function openPullRequest(accessToken) {
  const { apiBaseUrl, owner, repo, base, head, title, body } = config.github;
  const url = `${apiBaseUrl}/repos/${owner}/${repo}/pulls`;
  const prBody = { title, head, base, body };

  const { captured, responseBody, ok } = await captureJsonPost(
    { id: 'T3', title: 'Create Pull Request', badge: 'GitHub', from: 'Agent', to: 'GitHub' },
    url,
    { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json' },
    prBody
  );

  return { step: captured, ok, pr: ok ? responseBody : null };
}

// The Workflows flow keys off the Okta user id. Prefer the access token's `uid` claim;
// fall back to the id_token (uid, else sub) when no access token is on the session.
function resolveUid(accessToken, idToken) {
  const at = decodeJwt(accessToken);
  if (at?.payload?.uid) return at.payload.uid;
  const it = decodeJwt(idToken);
  return it?.payload?.uid || it?.payload?.sub || null;
}

// The invoke URL carries a clientToken query param — mask it before the captured step
// (and its curl snippet) is shipped to the browser.
function redactClientToken(captured) {
  let secret;
  try {
    secret = new URL(config.sts.revokeWorkflowUrl).searchParams.get('clientToken');
  } catch {
    return;
  }
  if (!secret) return;
  const mask = `${secret.slice(0, 6)}…${secret.slice(-4)}`;
  captured.request.url = captured.request.url.split(secret).join(mask);
  captured.code = captured.code.split(secret).join(mask);
}

/**
 * Revoke the user's brokered GitHub connection by invoking an Okta Workflows flow with
 * { id: <uid> }, so the next token exchange returns interaction_required and re-prompts
 * for consent. (An RFC 7009 token revoke leaves the stored connection in place.)
 */
export async function revokeStsToken({ accessToken, idToken } = {}) {
  if (!config.sts.revokeWorkflowUrl) {
    return { ok: false, error: 'Revoke is not configured — set STS_REVOKE_WORKFLOW_URL.' };
  }

  const uid = resolveUid(accessToken, idToken);
  if (!uid) {
    return {
      ok: false,
      error: 'Could not read a "uid" claim from the access token — sign in again, then retry the revoke.',
    };
  }

  const { captured, ok } = await captureJsonPost(
    {
      id: 'R1',
      title: 'Revoke GitHub Connection',
      badge: 'Revoke',
      from: 'Agent',
      to: 'Okta Workflows',
    },
    config.sts.revokeWorkflowUrl,
    {},
    { id: uid }
  );

  redactClientToken(captured);
  return { step: captured, ok };
}
