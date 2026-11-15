# Passwordless Lyfta MCP connector for ChatGPT

ChatGPT supports the **No authentication** setting for a remote MCP connection.
This implementation uses a private, unguessable 256-bit capability URL rather than
a public `/mcp` route or OAuth password prompt.

**Security:** Anyone who obtains the complete URL can read the owner's private
fitness history and invoke program creation. The main Worker remains protected by
its internal independent `MCP_ACCESS_TOKEN`, but the link itself grants access.
Treat the complete URL like a password. Never publish it, share screenshots, include
it in issue reports or GitHub, or paste it into a chat transcript.

## Enable (one time, owner's authorized Windows computer)

```powershell
cd C:\Users\k.laghaei\Projects\lyfta-mcp\oauth-gateway
powershell -NoProfile -File scripts\enable-noauth-link.ps1
```

The script generates a secret random URL component, uploads the
`MCP_LINK_SLUG` Cloudflare Secret, and stores a current-user DPAPI-protected
backup in `%APPDATA%\LyftaMCP\owner-secrets.dpapi.clixml`.

## Copy your server URL

```powershell
powershell -NoProfile -File scripts\copy-noauth-link.ps1
```

This places the complete link in the owner's clipboard without displaying it.
In ChatGPT, add a custom MCP server from Plugins, paste the URL,
select **No authentication**, create the private plugin and install it.
The URL path is `/connect/<secret>/mcp` rather than plain `/mcp`.
If you already had a connection using OAuth, create a new connection with
No authentication; changing the server settings does not automatically
change an existing installed plugin.

The existing OAuth route `/mcp` remains available as a fallback; it is
not needed by the passwordless connection.

## What still prevents accidental writes?

The Lyfta Worker enforces a validated preview and a `confirm:true` creation
flag. This guards unintended writes, **not malicious callers** with the URL.
The vendor API has no documented idempotency or rollback.

## Disable access immediately

Delete the `MCP_LINK_SLUG` Secret from the gateway Worker in Cloudflare
Variables and Secrets. This makes the capability URL unavailable. To
rotate, update both that Secret and the locally encrypted backup together.

## Testing

Start the main Worker locally on port 8788, using dummy Lyfta and MCP keys,
then the gateway on port 8789 with the same dummy MCP key and
`MCP_LINK_SLUG=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`.
Run `node scripts/noauth-smoke.mjs`.
No actual Lyfta data is accessed by the smoke test.
