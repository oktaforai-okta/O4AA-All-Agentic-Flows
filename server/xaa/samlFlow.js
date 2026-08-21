import { config } from '../config.js';
import { captureFormPost } from './capture.js';
import { buildSamlAgentClientAssertion } from './clientAssertion.js';

const GRANT_TOKEN_EXCHANGE = 'urn:ietf:params:oauth:grant-type:token-exchange';
const TOKEN_TYPE_SAML2 = 'urn:ietf:params:oauth:token-type:saml2';
const TOKEN_TYPE_REFRESH = 'urn:ietf:params:oauth:token-type:refresh_token';
const TOKEN_TYPE_ID_JAG = 'urn:ietf:params:oauth:token-type:id-jag';
const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';

// Signing the client_assertion can throw (key not found, wrong alg, …). Surface it
// as a failed step rather than crashing the request, mirroring tokenExchange.js.
function assertionErrorStep(id, title, badge, url, err) {
  return {
    step: {
      id,
      title,
      badge,
      from: 'Agent',
      to: 'IdP',
      ok: false,
      request: { method: 'POST', url, headers: {}, body: '(request not sent — client_assertion could not be built)' },
      response: { status: 0, headers: {}, body: { error: 'client_assertion_error', error_description: err.message } },
      token: null,
      code: '',
    },
    ok: false,
  };
}

/**
 * T2 — SAML assertion → refresh_token.
 * Token exchange with subject_token_type=saml2, requested_token_type=refresh_token.
 * The agent authenticates with its private_key_jwt client assertion (same cert as XAA).
 * scope = openid offline_access.
 */
export async function exchangeSamlForRefreshToken(samlAssertion) {
  let clientAssertion;
  try {
    clientAssertion = await buildSamlAgentClientAssertion();
  } catch (err) {
    console.error('[SAML T2] client_assertion signing failed:', err);
    return { ...assertionErrorStep('T2', 'SAML → Refresh Token', 'Refresh Token', config.saml.tokenUrl, err), refreshToken: null };
  }

  const scope = 'openid offline_access';
  const bodyParams = {
    grant_type: GRANT_TOKEN_EXCHANGE,
    subject_token: samlAssertion,
    subject_token_type: TOKEN_TYPE_SAML2,
    requested_token_type: TOKEN_TYPE_REFRESH,
    scope,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: clientAssertion,
  };

  const { captured, responseBody, ok } = await captureFormPost(
    { id: 'T2', title: 'SAML → Refresh Token', badge: 'Refresh Token', from: 'Agent', to: 'IdP' },
    config.saml.tokenUrl,
    {},
    bodyParams
  );

  // RFC 8693: the exchanged token (here the refresh token) is returned in
  // `access_token`, with issued_token_type marking it as a refresh_token. Prefer an
  // explicit `refresh_token` field if the IdP also sends one.
  const refreshToken = ok ? responseBody.refresh_token || responseBody.access_token : null;
  return { step: captured, refreshToken, ok };
}

/**
 * T3 — refresh_token → id-JAG.
 * Token exchange with subject_token_type=refresh_token, requested_token_type=id-jag.
 * audience = the resource authorization server; scope = the resource scope(s).
 */
export async function exchangeRefreshForIdJag(refreshToken) {
  let clientAssertion;
  try {
    clientAssertion = await buildSamlAgentClientAssertion();
  } catch (err) {
    console.error('[SAML T3] client_assertion signing failed:', err);
    return { ...assertionErrorStep('T3', 'Token Exchange', 'ID-JAG', config.saml.tokenUrl, err), idJag: null };
  }

  const bodyParams = {
    grant_type: GRANT_TOKEN_EXCHANGE,
    subject_token: refreshToken,
    subject_token_type: TOKEN_TYPE_REFRESH,
    requested_token_type: TOKEN_TYPE_ID_JAG,
    audience: config.agent.audience,
    scope: config.resource.scopes,
    client_assertion_type: CLIENT_ASSERTION_TYPE,
    client_assertion: clientAssertion,
  };
  if (config.agent.resource) bodyParams.resource = config.agent.resource;

  const { captured, responseBody, ok } = await captureFormPost(
    { id: 'T3', title: 'Token Exchange', badge: 'ID-JAG', from: 'Agent', to: 'IdP', tokenField: 'access_token' },
    config.saml.tokenUrl,
    {},
    bodyParams
  );

  return { step: captured, idJag: ok ? responseBody.access_token : null, ok };
}
