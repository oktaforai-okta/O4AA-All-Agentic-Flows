// Hand-authored "Architecture" tab content — a narrative explanation, a
// step-by-step breakdown, and a Mermaid sequence diagram — per flow. Only
// flows with an entry here show the Architecture tab (see Chat.jsx).
//
// Diagram convention: the agent IS the app the user signs into. It is the
// confidential OAuth client — it redirects the browser to Okta, receives the
// authorization code at its own /callback, redeems it, and holds every token
// server-side in the session. The user's browser only ever carries redirects,
// never a token. Each diagram is drawn so that whoever holds a credential is
// the same participant who uses it on the next line — no undrawn hand-offs.
export const ARCHITECTURE = {
  xaa: {
    summary:
      'The agent acts on behalf of a signed-in human. The user opens the agent app, which is itself the OIDC client: it redirects the browser to Okta, receives the authorization code back at its own /callback, and redeems it for the user’s ID token (private_key_jwt — no client secret exists anywhere). The token lands in the agent, not in the browser. The agent then exchanges that ID token for an Identity Assertion Authorization Grant (id-JAG) — a token that asserts "this agent is acting for this user" — and redeems the id-JAG for a resource-scoped access token at the resource’s own authorization server. The inventory MCP validates that access token’s signature and scope before answering.',
    steps: [
      {
        id: 'T1',
        title: 'User Login',
        from: 'Agent',
        to: 'Okta (IdP)',
        description: 'The user opens the agent app; the agent redirects the browser to /authorize with code + PKCE, and Okta redirects back to the agent’s /callback with a code. T1 is the agent’s own back-channel POST to /token exchanging that code — authenticated with a signed private_key_jwt client assertion. The resulting id_token is stored in the agent’s server-side session; the browser never sees it.',
      },
      {
        id: 'T2',
        title: 'Token Exchange → id-JAG',
        from: 'Agent',
        to: 'Okta (IdP)',
        description: 'RFC 8693 token-exchange: subject_token = the user’s id_token from T1, requested_token_type = id-JAG. Authenticated as the agent client via private_key_jwt.',
      },
      {
        id: 'T3',
        title: 'Access Token Request',
        from: 'Agent',
        to: 'Resource Auth Server',
        description: 'RFC 7523 JWT-Bearer grant: assertion = the id-JAG from T2. Authenticated as the same agent client_id, same private_key_jwt cert — the resource auth server must recognize this exact client.',
      },
      {
        id: 'T4',
        title: 'MCP Tool Call',
        from: 'Agent',
        to: 'Inventory MCP',
        description: 'The access token from T3 is presented as a Bearer token. The MCP independently verifies the token’s signature (JWKS) and required scope before running the tool.',
      },
    ],
    diagram: `sequenceDiagram
    participant U as User (browser)
    participant A as Agent (OIDC client)
    participant IdP as Okta (IdP)
    participant R as Resource Auth Server
    participant M as Inventory MCP

    U->>A: Open the agent app, start the flow
    A-->>U: Redirect to Okta /authorize (code + PKCE)
    U->>IdP: Authenticate
    IdP-->>U: Redirect to agent /callback with code
    U->>A: GET /callback with code
    A->>IdP: T1 POST /token (code + verifier + private_key_jwt)
    IdP-->>A: id_token (held in the agent session)
    A->>IdP: T2 Token Exchange (subject: id_token)
    IdP-->>A: id-JAG
    A->>R: T3 JWT-Bearer (assertion: id-JAG)
    R-->>A: Access Token
    A->>M: T4 Tool call (Bearer Access Token)
    M-->>A: Validated response
    A-->>U: Answer rendered in the agent UI`,
  },

  'xaa-webapp': {
    summary:
      'A variant of Cross-App Access where the subject of the exchange isn’t the agent’s primary login. The agent signs the user in using a *second*, separate OIDC client registration — a confidential web app authenticated with a client secret instead of private_key_jwt — and that client’s /authorize call carries a resource indicator (RFC 8707). The agent redeems the code with its web-app credentials and keeps the resulting ACCESS token (not an id_token); that access token becomes the subject_token for the id-JAG exchange, which the agent performs back under its own private_key_jwt identity. Everything downstream — id-JAG → resource access token → validated MCP call — is identical to the plain Cross-App Access flow.',
    steps: [
      {
        id: 'T1',
        title: 'User Login',
        from: 'Agent (Web App client)',
        to: 'Okta (IdP)',
        description: 'The agent runs the login with a second OIDC client registration — client_secret auth, and a resource parameter on /authorize identifying the downstream API. The agent redeems the code at its /webapp/callback and stores the resulting access_token server-side. Same running app as the agent, a different registered client identity.',
      },
      {
        id: 'T2',
        title: 'Token Exchange → id-JAG',
        from: 'Agent',
        to: 'Okta (IdP)',
        description: 'RFC 8693 token-exchange: subject_token = the web-app client’s access_token (not an id_token), requested_token_type = id-JAG. Here the agent switches back to its own client identity and authenticates with private_key_jwt.',
      },
      {
        id: 'T3',
        title: 'Access Token Request',
        from: 'Agent',
        to: 'Resource Auth Server',
        description: 'RFC 7523 JWT-Bearer grant: assertion = the id-JAG from T2 — identical mechanics to the plain Cross-App Access flow’s T3.',
      },
      {
        id: 'T4',
        title: 'MCP Tool Call',
        from: 'Agent',
        to: 'Inventory MCP',
        description: 'Same validated Bearer-token call as the plain flow — the MCP can’t tell (and doesn’t need to know) that the subject token was an access token from a web-app client instead of an id_token from the primary login.',
      },
    ],
    diagram: `sequenceDiagram
    participant U as User (browser)
    participant A as Agent (two client identities)
    participant IdP as Okta (IdP)
    participant R as Resource Auth Server
    participant M as Inventory MCP

    Note over A: Logs the user in with a second OIDC client<br/>(client_secret), then exchanges as itself (private_key_jwt)
    U->>A: Open the agent app, start the flow
    A-->>U: Redirect to Okta /authorize (web-app client + resource param)
    U->>IdP: Authenticate
    IdP-->>U: Redirect to agent /webapp/callback with code
    U->>A: GET /webapp/callback with code
    A->>IdP: T1 POST /token (code + client_secret)
    IdP-->>A: access_token (resource-scoped, held in the agent session)
    A->>IdP: T2 Token Exchange (subject: access_token, agent private_key_jwt)
    IdP-->>A: id-JAG
    A->>R: T3 JWT-Bearer (assertion: id-JAG)
    R-->>A: Access Token
    A->>M: T4 Tool call (Bearer Access Token)
    M-->>A: Validated response
    A-->>U: Answer rendered in the agent UI`,
  },

  'hi-saml': {
    summary:
      'SAML replaces the OIDC login as the source of the user’s identity. The user launches the agent from their Okta dashboard, Okta returns an auto-submitting form, and the browser POSTs a SAML assertion straight to the agent’s Assertion Consumer Service — there is no authorization code and no agent-initiated redirect at all. The assertion lands in the agent’s session, and from there the agent runs its own two-hop exchange: the SAML assertion becomes a refresh token, and the refresh token becomes an id-JAG, before falling into the same jwt-bearer redemption and MCP call as the other Cross-App Access flows. A dedicated agent client_id (separate from AGENT_CLIENT_ID, same signing cert) mints and redeems that id-JAG.',
    steps: [
      {
        id: 'T1',
        title: 'SAML SSO (IdP-Initiated)',
        from: 'User (browser)',
        to: 'Agent (SP / ACS)',
        description: 'The user clicks the agent tile in Okta; Okta returns an auto-POST form and the browser submits the SAMLResponse to the agent’s Assertion Consumer Service. The agent never initiates this leg — and the assertion is delivered to the agent, not held by the user.',
      },
      {
        id: 'T2',
        title: 'SAML → Refresh Token',
        from: 'Agent',
        to: 'Okta (IdP)',
        description: 'Token-exchange: subject_token = the SAML assertion (subject_token_type=saml2), requested_token_type = refresh_token, scope = openid offline_access.',
      },
      {
        id: 'T3',
        title: 'Refresh Token → id-JAG',
        from: 'Agent',
        to: 'Okta (IdP)',
        description: 'Token-exchange: subject_token_type = refresh_token, requested_token_type = id-JAG, audience = the resource authorization server.',
      },
      {
        id: 'T4',
        title: 'Access Token Request',
        from: 'Agent',
        to: 'Resource Auth Server',
        description: 'JWT-Bearer grant redeeming the id-JAG — authenticated as the same dedicated SAML agent client_id that minted it.',
      },
      {
        id: 'T5',
        title: 'MCP Tool Call',
        from: 'Agent',
        to: 'Inventory MCP',
        description: 'Validated Bearer-token call, identical mechanics to the other Cross-App Access flows.',
      },
    ],
    diagram: `sequenceDiagram
    participant U as User (browser)
    participant A as Agent (SAML SP)
    participant IdP as Okta (IdP)
    participant R as Resource Auth Server
    participant M as Inventory MCP

    U->>IdP: Click the agent tile in Okta (IdP-initiated SSO)
    IdP-->>U: Auto-POST form carrying the SAMLResponse
    U->>A: T1 POST SAMLResponse to the agent ACS
    A-->>U: Agent UI (assertion held in the agent session)
    A->>IdP: T2 Token Exchange (subject: saml2 assertion)
    IdP-->>A: refresh_token
    A->>IdP: T3 Token Exchange (subject: refresh_token)
    IdP-->>A: id-JAG
    A->>R: T4 JWT-Bearer (assertion: id-JAG)
    R-->>A: Access Token
    A->>M: T5 Tool call (Bearer Access Token)
    M-->>A: Validated response
    A-->>U: Answer rendered in the agent UI`,
  },

  secrets: {
    summary:
      'The user signs into the agent exactly as in Cross-App Access, so the agent again ends up holding the user’s ID token. But instead of minting an id-JAG for a resource authorization server, the agent exchanges that ID token directly for a vaulted secret stored in Okta Privileged Access — a much shorter chain, with no resource auth server and no id-JAG involved at all. The returned username/password are presented to the inventory MCP as plain HTTP Basic credentials, which the MCP checks against its own configured pair.',
    steps: [
      {
        id: 'T1',
        title: 'User Login',
        from: 'Agent',
        to: 'Okta (IdP)',
        description: 'The agent redirects the browser to /authorize (code + PKCE), receives the code at its own /callback, and POSTs it to /token with a private_key_jwt assertion. The id_token is stored in the agent’s session — identical to the plain Cross-App Access flow’s T1.',
      },
      {
        id: 'T2',
        title: 'Retrieve Vaulted Secret',
        from: 'Agent',
        to: 'Okta Org Server',
        description: 'Token-exchange: subject_token = id_token, requested_token_type = vaulted-secret, resource = the PAM secret ORN. Must hit the ORG token endpoint, never a custom auth server.',
      },
      {
        id: 'T3',
        title: 'MCP Tool Call (HTTP Basic)',
        from: 'Agent',
        to: 'Inventory MCP',
        description: 'The retrieved username/password are sent as HTTP Basic credentials — no bearer token, no signature to verify, just a direct credential match.',
      },
    ],
    diagram: `sequenceDiagram
    participant U as User (browser)
    participant A as Agent (OIDC client)
    participant IdP as Okta (IdP / Org Server)
    participant M as Inventory MCP

    U->>A: Open the agent app, start the flow
    A-->>U: Redirect to Okta /authorize (code + PKCE)
    U->>IdP: Authenticate
    IdP-->>U: Redirect to agent /callback with code
    U->>A: GET /callback with code
    A->>IdP: T1 POST /token (code + verifier + private_key_jwt)
    IdP-->>A: id_token (held in the agent session)
    A->>IdP: T2 Token Exchange (subject: id_token) for vaulted-secret
    IdP-->>A: vaulted secret (username / password)
    A->>M: T3 Tool call (HTTP Basic auth)
    M-->>A: Validated response
    A-->>U: Answer rendered in the agent UI`,
  },

  'service-account': {
    summary:
      'Structurally identical to the Secrets flow — same login into the agent, same org-token-endpoint exchange, same HTTP Basic MCP call — but the credential retrieved is a managed service-account username/password instead of an arbitrary vaulted secret. This is the pattern for giving an agent access to legacy systems that only understand username/password, without ever storing that password in the agent itself.',
    steps: [
      {
        id: 'T1',
        title: 'User Login',
        from: 'Agent',
        to: 'Okta (IdP)',
        description: 'The agent redirects the browser to /authorize (code + PKCE), receives the code at its own /callback, and POSTs it to /token with a private_key_jwt assertion. The id_token is stored in the agent’s session — identical to the plain Cross-App Access flow’s T1.',
      },
      {
        id: 'T2',
        title: 'Retrieve Service Account',
        from: 'Agent',
        to: 'Okta Org Server',
        description: 'Token-exchange: subject_token = id_token, requested_token_type = service-account, resource = the service-account ORN. Same org-token-endpoint constraint as the Secrets flow.',
      },
      {
        id: 'T3',
        title: 'MCP Tool Call (HTTP Basic)',
        from: 'Agent',
        to: 'Inventory MCP',
        description: 'The retrieved service-account username/password are sent as HTTP Basic credentials.',
      },
    ],
    diagram: `sequenceDiagram
    participant U as User (browser)
    participant A as Agent (OIDC client)
    participant IdP as Okta (IdP / Org Server)
    participant M as Inventory MCP

    U->>A: Open the agent app, start the flow
    A-->>U: Redirect to Okta /authorize (code + PKCE)
    U->>IdP: Authenticate
    IdP-->>U: Redirect to agent /callback with code
    U->>A: GET /callback with code
    A->>IdP: T1 POST /token (code + verifier + private_key_jwt)
    IdP-->>A: id_token (held in the agent session)
    A->>IdP: T2 Token Exchange (subject: id_token) for service-account
    IdP-->>A: service account credentials (username / password)
    A->>M: T3 Tool call (HTTP Basic auth)
    M-->>A: Validated response
    A-->>U: Answer rendered in the agent UI`,
  },

  'client-credentials': {
    summary:
      'The "NHI" counterpart to Cross-App Access: there is no user and no browser. A scheduled run kicks off a headless service app, which authenticates itself with client_credentials (private_key_jwt) to get its own access token. That token is handed to the agent — a separate registered client identity in the same process — which presents it as the subject of the exact same token-exchange → jwt-bearer → MCP chain used by the human-driven flow. The only difference from "HI - Cross-App Access" is what is sitting in the subject_token: a service token instead of a user’s id_token.',
    steps: [
      {
        id: 'T1',
        title: 'Client Credentials',
        from: 'Service App',
        to: 'Service Auth Server',
        description: 'private_key_jwt client_credentials grant. No user, no browser redirect — the service app authenticates purely with its own signing key, and the resulting access token is handed straight to the agent.',
      },
      {
        id: 'T2',
        title: 'Token Exchange → id-JAG',
        from: 'Agent',
        to: 'Okta (IdP)',
        description: 'subject_token = the service app’s access_token, subject_token_type = access_token, requested_token_type = id-JAG. Authenticated as the agent client — a different registered identity than the service app that obtained T1’s token.',
      },
      {
        id: 'T3',
        title: 'Access Token Request',
        from: 'Agent',
        to: 'Resource Auth Server',
        description: 'JWT-Bearer grant redeeming the id-JAG — identical mechanics to the plain Cross-App Access flow’s T3.',
      },
      {
        id: 'T4',
        title: 'MCP Tool Call',
        from: 'Agent',
        to: 'Inventory MCP',
        description: 'Validated Bearer-token call — the MCP can’t tell the subject was a service identity rather than a human.',
      },
    ],
    diagram: `sequenceDiagram
    participant Sch as Scheduler / Chat trigger
    participant S as Service App (own client_id + key)
    participant SAuth as Service Auth Server
    participant A as Agent (own client_id + key)
    participant IdP as Okta (IdP)
    participant R as Resource Auth Server
    participant M as Inventory MCP

    Note over S,A: Two registered client identities in one process —<br/>no user and no browser anywhere in this flow
    Sch->>S: Autonomous run starts
    S->>SAuth: T1 Client Credentials (private_key_jwt)
    SAuth-->>S: service access_token
    S->>A: Hand the service access_token to the agent
    A->>IdP: T2 Token Exchange (subject: service access_token)
    IdP-->>A: id-JAG
    A->>R: T3 JWT-Bearer (assertion: id-JAG)
    R-->>A: Access Token
    A->>M: T4 Tool call (Bearer Access Token)
    M-->>A: Validated response
    A-->>Sch: Result reported back to the run`,
  },

  'hi-a2a': {
    summary:
      'Two agents, two authorization servers, one chain of id-JAGs. The user signs into Agent 1, which is itself the OIDC client for this flow (its own app registration, client_secret auth, resource indicator on /authorize) — so Agent 1, not the browser, ends up holding the user’s access token. Agent 1 turns that token into an id-JAG scoped to Agent 2 (Finance) and redeems it for a token that lets it call Agent 2. It then passes that token to Agent 2, which repeats the same pattern one hop further — minting its own id-JAG for the Finance MCP and redeeming it for the access token that actually calls the resource. Every id-JAG is minted at the shared Org authorization server, but each agent redeems its own id-JAG only at its own auth server.',
    steps: [
      {
        id: 'T1',
        title: 'User Login (A2A)',
        from: 'Agent 1 (Inventory)',
        to: 'Org Auth Server',
        description: 'The A2A flow’s own OIDC client — a separate app registration from the main agent login, authenticated with a client secret. Agent 1 redirects the browser to /authorize, receives the code at /a2a/callback, and redeems it; the user’s access_token is stored in Agent 1’s session.',
      },
      {
        id: 'T2',
        title: 'id-JAG → Agent 2',
        from: 'Agent 1 (Inventory)',
        to: 'Org Auth Server',
        description: 'subject_token = the user’s A2A access_token from T1, requested_token_type = id-JAG, audience = Agent 2’s auth server. Signed as Agent 1.',
      },
      {
        id: 'T3',
        title: 'Agent 1 → Agent 2 Token',
        from: 'Agent 1 (Inventory)',
        to: 'Agent 2 Auth Server',
        description: 'JWT-Bearer grant redeeming the id-JAG from T2, authenticated as Agent 1’s own client_id. Agent 1 then hands this token to Agent 2 as its delegated credential.',
      },
      {
        id: 'T4',
        title: 'id-JAG → Finance MCP',
        from: 'Agent 2 (Finance)',
        to: 'Org Auth Server',
        description: 'subject_token = the Agent1→Agent2 token from T3, requested_token_type = id-JAG, audience = the Finance MCP. Signed as Agent 2 this time.',
      },
      {
        id: 'T5',
        title: 'Finance Access Token',
        from: 'Agent 2 (Finance)',
        to: 'Finance MCP Auth Server',
        description: 'JWT-Bearer grant redeeming the id-JAG from T4, authenticated as Agent 2’s own client_id.',
      },
      {
        id: 'T6',
        title: 'MCP Tool Call',
        from: 'Agent 2 (Finance)',
        to: 'Finance MCP',
        description: 'Validated Bearer-token call against the Finance MCP with the T5 access token.',
      },
    ],
    diagram: `sequenceDiagram
    participant U as User (browser)
    participant A1 as Agent 1 (Inventory)
    participant Org as Org Auth Server
    participant A2Auth as Agent 2 Auth Server
    participant A2 as Agent 2 (Finance)
    participant FinAuth as Finance MCP Auth Server
    participant FM as Finance MCP

    U->>A1: Open Agent 1, start the flow
    A1-->>U: Redirect to Okta /authorize (A2A client + resource param)
    U->>Org: Authenticate
    Org-->>U: Redirect to agent /a2a/callback with code
    U->>A1: GET /a2a/callback with code
    A1->>Org: T1 POST /token (code + client_secret)
    Org-->>A1: user access_token (held in Agent 1's session)
    A1->>Org: T2 id-JAG for Agent 2 (subject: user access_token)
    Org-->>A1: id-JAG
    A1->>A2Auth: T3 JWT-Bearer (assertion: id-JAG)
    A2Auth-->>A1: Agent1-to-Agent2 token
    A1->>A2: Delegate the task, passing the Agent1-to-Agent2 token
    A2->>Org: T4 id-JAG for Finance MCP (subject: Agent1-to-Agent2 token)
    Org-->>A2: id-JAG
    A2->>FinAuth: T5 JWT-Bearer (assertion: id-JAG)
    FinAuth-->>A2: Finance Access Token
    A2->>FM: T6 Tool call (Bearer Access Token)
    FM-->>A2: Validated response
    A2-->>A1: Result returned to Agent 1
    A1-->>U: Answer rendered in the agent UI`,
  },

  'nhi-a2a': {
    summary:
      'The exact same six-hop chain as "HI - A2A" — same two agents, same Org authorization server, same Finance MCP — except T1 is a service app authenticating with client_credentials instead of a human logging in. A scheduled run replaces the browser: the service app gets its own access token and hands it to Agent 1, and from there the id-JAG chain is byte-for-byte the same shape. Nothing downstream of T1 knows or cares whether the subject token originated from a person or a service identity; that’s the point of the comparison.',
    steps: [
      {
        id: 'T1',
        title: 'Client Credentials',
        from: 'A2A Service App',
        to: 'Service Auth Server',
        description: 'private_key_jwt client_credentials grant — no user, no login redirect. The resulting access token is handed straight to Agent 1 to use as the subject of T2.',
      },
      {
        id: 'T2',
        title: 'id-JAG → Agent 2',
        from: 'Agent 1 (Inventory)',
        to: 'Org Auth Server',
        description: 'subject_token = the service app’s access_token from T1, requested_token_type = id-JAG, audience = Agent 2’s auth server.',
      },
      {
        id: 'T3',
        title: 'Agent 1 → Agent 2 Token',
        from: 'Agent 1 (Inventory)',
        to: 'Agent 2 Auth Server',
        description: 'JWT-Bearer grant redeeming the id-JAG from T2 — identical to the HI - A2A flow’s T3. Agent 1 hands the resulting token to Agent 2.',
      },
      {
        id: 'T4',
        title: 'id-JAG → Finance MCP',
        from: 'Agent 2 (Finance)',
        to: 'Org Auth Server',
        description: 'subject_token = the Agent1→Agent2 token from T3, requested_token_type = id-JAG, audience = the Finance MCP.',
      },
      {
        id: 'T5',
        title: 'Finance Access Token',
        from: 'Agent 2 (Finance)',
        to: 'Finance MCP Auth Server',
        description: 'JWT-Bearer grant redeeming the id-JAG from T4.',
      },
      {
        id: 'T6',
        title: 'MCP Tool Call',
        from: 'Agent 2 (Finance)',
        to: 'Finance MCP',
        description: 'Validated Bearer-token call against the Finance MCP with the T5 access token.',
      },
    ],
    diagram: `sequenceDiagram
    participant Sch as Scheduler / Chat trigger
    participant S as A2A Service App (own client_id + key)
    participant A1 as Agent 1 (Inventory)
    participant Org as Org Auth Server
    participant A2Auth as Agent 2 Auth Server
    participant A2 as Agent 2 (Finance)
    participant FinAuth as Finance MCP Auth Server
    participant FM as Finance MCP

    Note over Sch,A1: A scheduled run replaces the human login —<br/>no browser, no user in the chain
    Sch->>S: Autonomous run starts
    S->>Org: T1 Client Credentials (private_key_jwt)
    Org-->>S: service access_token
    S->>A1: Hand the service access_token to Agent 1
    A1->>Org: T2 id-JAG for Agent 2 (subject: service access_token)
    Org-->>A1: id-JAG
    A1->>A2Auth: T3 JWT-Bearer (assertion: id-JAG)
    A2Auth-->>A1: Agent1-to-Agent2 token
    A1->>A2: Delegate the task, passing the Agent1-to-Agent2 token
    A2->>Org: T4 id-JAG for Finance MCP (subject: Agent1-to-Agent2 token)
    Org-->>A2: id-JAG
    A2->>FinAuth: T5 JWT-Bearer (assertion: id-JAG)
    FinAuth-->>A2: Finance Access Token
    A2->>FM: T6 Tool call (Bearer Access Token)
    FM-->>A2: Validated response
    A2-->>A1: Result returned to Agent 1
    A1-->>Sch: Result reported back to the run`,
  },

  'sts-github': {
    summary:
      'The user signs into the agent as in Cross-App Access, so the agent holds the user’s ID token. From there the agent brokers a GitHub access token through Okta’s Security Token Service instead of minting an id-JAG — there is no resource authorization server and no jwt-bearer redemption in this flow. The first time (or after a revoke), Okta has no stored consent and returns interaction_required with a URI; the agent surfaces that as a link, the user authorizes the connection in the browser, and the identical token-exchange request is retried. Once consent exists, the exchange returns a real GitHub access token the agent uses directly against the GitHub REST API.',
    steps: [
      {
        id: 'T1',
        title: 'User Login',
        from: 'Agent',
        to: 'Okta (IdP)',
        description: 'The agent redirects the browser to /authorize (code + PKCE), receives the code at its own /callback, and POSTs it to /token with a private_key_jwt assertion. The id_token is stored in the agent’s session — identical to the plain Cross-App Access flow’s T1.',
      },
      {
        id: 'T2',
        title: 'Resource Token Exchange (STS)',
        from: 'Agent',
        to: 'Okta Org Server',
        description: 'subject_token = id_token, requested_token_type = oauth-sts, resource = the GitHub connection. Returns HTTP 400 interaction_required + an interaction_uri the first time; the agent shows that link, the user consents in the browser, and the agent retries the same request.',
      },
      {
        id: 'T3',
        title: 'Read / Create Pull Request',
        from: 'Agent',
        to: 'GitHub',
        description: 'The brokered access token is used directly as a GitHub Bearer token — a write call (create) genuinely exercises the token’s real permissions, unlike a read.',
      },
    ],
    diagram: `sequenceDiagram
    participant U as User (browser)
    participant A as Agent (OIDC client)
    participant IdP as Okta (IdP / Org Server)
    participant GH as GitHub

    U->>A: Open the agent app, start the flow
    A-->>U: Redirect to Okta /authorize (code + PKCE)
    U->>IdP: Authenticate
    IdP-->>U: Redirect to agent /callback with code
    U->>A: GET /callback with code
    A->>IdP: T1 POST /token (code + verifier + private_key_jwt)
    IdP-->>A: id_token (held in the agent session)
    A->>IdP: T2 Resource Token Exchange (subject: id_token)
    alt consent already granted
        IdP-->>A: brokered GitHub access_token
    else first time or after revoke
        IdP-->>A: 400 interaction_required + interaction_uri
        A-->>U: Show the interaction_uri as a consent link
        U->>IdP: Authorize the GitHub connection
        U->>A: Return to the agent and retry
        A->>IdP: T2 (retry) Resource Token Exchange
        IdP-->>A: brokered GitHub access_token
    end
    A->>GH: T3 Read or Create Pull Request (Bearer access_token)
    GH-->>A: Pull request data
    A-->>U: Pull request shown in the agent UI`,
  },
};
