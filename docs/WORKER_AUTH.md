# Authentication and client connection

Verified against [OpenAI authentication documentation](https://developers.openai.com/plugins/build/auth)
and [custom MCP server guidance](https://developers.openai.com/api/docs/guides/custom-mcp-server)
on 2026-11-15. Authentication availability and account permissions can change.

## Implemented: personal Bearer endpoint

`/mcp` requires `Authorization: Bearer <MCP_ACCESS_TOKEN>` and a separately configured
`LYFTA_API_KEY`. The Lyfta key is sent only to the official API. No caller-supplied
upstream key or client/coach ID is accepted. Missing secrets fail closed; cross-origin
browser requests are refused; credentials are never put into URLs. The access token
also signs short-lived preview receipts; rotating it invalidates outstanding receipts.
There is no application request/body logging. Platform traces must remain free of
custom secret or workout fields.

For a Codex client, securely expose the MCP token as `LYFTA_MCP_TOKEN` to its process.
In the client's private configuration (not this repository):

```toml
[mcp_servers.lyfta_personal]
url = "https://<worker-host>/mcp"
bearer_token_env_var = "LYFTA_MCP_TOKEN"
```

Restart the client after configuring its environment; verify initialize and tools/list,
then a deliberate read. See [official Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli).
This run validates the HTTP protocol in local workerd, not a production Codex account session.
Other Streamable HTTP clients must provide the same header securely and support the
SDK's advertised protocol revision or 2025 stateless fallback.

## Direct ChatGPT linking: OAuth required, not implemented here

ChatGPT supports OAuth/no-auth selection but cannot present an arbitrary custom API key.
No-auth is unsuitable for this private, write-capable service. A fixed Bearer token is
not an OAuth implementation. Do not enter the Lyfta API key into ChatGPT's connector
settings, disable auth, or put tokens in query strings. **The current Worker cannot
be linked directly as a private ChatGPT custom connector.** No ChatGPT compatibility
claim is made.

The smallest secure extension is a dedicated OAuth 2.1 gateway in front of this Worker,
restricted to the owner's identity. This is a documented deployment option, not shipped
or tested code; configuring it is a separate prerequisite for direct ChatGPT use:

1. Choose an existing owner-controlled OAuth authorization service/gateway with an
   authorization-code flow and PKCE S256, exact registered ChatGPT callback URIs,
   owner-only login/consent and no open user registration. Prefer an existing issuer
   over adding authentication infrastructure solely for this personal project.
2. Gateway serves protected-resource metadata for its canonical HTTPS MCP resource,
   advertises its authorization server on 401, and provides OAuth discovery. Support
   a pre-registered ChatGPT client or documented CIMD/DCR. Bind every authorization code
   and token to client, redirect URI, resource audience, scopes and expiration. Codes
   must be single-use; a purely stateless signed code is insufficient. The chosen
   gateway owns secure code/token state and revocation; do not bolt homemade OAuth
   onto this Worker with only an HMAC and claim replay prevention.
3. Validate access-token signature/issuer/audience/expiry and owner subject before
   forwarding. Translate successful authorization into the private Worker Bearer header
   server-side. Keep `MCP_ACCESS_TOKEN` exclusively in gateway secrets. Gateway must
   enforce consent/scope for writes and preserve the explicit preview/confirmation flow.
   If the origin remains publicly addressable, it must still require that independent token.
4. After owner authorization to provision/deploy the gateway, configure its exact issuer,
   resource URL and registered callback in ChatGPT's custom MCP setup, select OAuth,
   complete owner consent, and verify discovery, linking, refresh/revocation, bad tokens,
   wrong subject/audience, reads, and a separately approved write/readback.
5. Record actual successful client evidence before calling the ChatGPT path ready.

This design deliberately avoids shipping an unreviewed OAuth server, adding Auth0,
storage bindings or a paid service. Exact gateway-specific commands cannot be supplied
until an issuer/product is selected. Direct ChatGPT linking remains a clearly identified
external integration gate; Bearer-capable Codex/other clients do not need this gateway.
