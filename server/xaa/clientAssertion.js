import { SignJWT } from 'jose';
import { config } from '../config.js';
import { loadPrivateKey } from '../util/privateKey.js';

/**
 * Build a signed private_key_jwt client assertion (RFC 7523 §2.2):
 * iss=sub=clientId, aud=the token endpoint it is sent to.
 */
export async function buildClientAssertion({ clientId, audience, kid, privateKeyFile }) {
  const key = loadPrivateKey(privateKeyFile || config.agent.privateKeyFile);
  const now = Math.floor(Date.now() / 1000);
  const jti = `${now}-${Math.random().toString(36).slice(2)}-xaa`;
  return new SignJWT({})
    .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
    .setIssuer(clientId)
    .setSubject(clientId)
    .setAudience(audience)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setJti(jti)
    .sign(key);
}

/** T2 — assertion for the agent client at the IdP token endpoint. */
export function buildAgentClientAssertion() {
  return buildClientAssertion({
    clientId: config.agent.clientId,
    audience: config.agent.assertionAudience,
    kid: config.agent.kid,
    privateKeyFile: config.agent.privateKeyFile,
  });
}

/** T2/T3 — assertion for the SAML flow's agent client at the IdP token endpoint (dedicated client_id, same agent cert). */
export function buildSamlAgentClientAssertion() {
  return buildClientAssertion({
    clientId: config.saml.clientId,
    audience: config.agent.assertionAudience,
    kid: config.agent.kid,
    privateKeyFile: config.agent.privateKeyFile,
  });
}

/**
 * T3 — assertion for the resource client at the resource token endpoint (same agent
 * cert). `clientIdOverride` lets a flow whose id-JAG was minted under a different
 * agent client_id (e.g. hi-saml's AGENT_CLIENT_ID_SAML) redeem it as that same client.
 */
export function buildResourceClientAssertion(clientIdOverride) {
  return buildClientAssertion({
    clientId: clientIdOverride || config.resource.clientId,
    audience: config.resource.assertionAudience,
    kid: config.resource.kid,
    privateKeyFile: config.agent.privateKeyFile,
  });
}

/** Service App (client credentials) flow — assertion signed with the SERVICE cert. */
export function buildServiceClientAssertion(audience) {
  return buildClientAssertion({
    clientId: config.service.clientId,
    audience,
    kid: config.service.kid,
    privateKeyFile: config.service.privateKeyFile,
  });
}
