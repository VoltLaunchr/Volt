---
name: Auth/OAuth/Credentials/Deep-link Audit
description: Token-theft surface — deep link source unauth, OAuth code-flow design, JWT trust, token logging risks (2026-05-03)
type: project
---

Audit of `commands/{auth,oauth,credentials,keyring_store}.rs`, lib.rs deep-link dispatcher, capabilities, and IntegrationsPanel/credentialsService/useAuth on dev branch as of 2026-05-03.

**Why:** Token theft from auth/OAuth flows = full account takeover; deep-link `volt://` URLs are renderer-trustable yet attacker-spawnable, so this surface is the highest-value desktop attack target.

**How to apply:** When reviewing changes touching `tauri-plugin-deep-link`, `volt://` URL dispatch in lib.rs, OAuth state in oauth.rs, Supabase tokens in auth.rs, or the keyring abstraction, re-check the items below before approving.

Key findings (most still open at audit time):

1. **Deep-link source is unauthenticated by design.** Any local app or website link click (`<a href="volt://oauth-callback?service=github&token=...&state=...">`) reaches `commands::oauth::handle_oauth_deep_link` via the single-instance forwarder. The `state` HashMap check in oauth.rs is the ONLY mitigation; if an attacker can read the `state` UUID (via referrer leak, MITM on the legit OAuth start URL, or an extension with HTTP egress), token injection is trivial. Treat ALL deep-link payloads as untrusted.

2. **Auth deep link has NO state/CSRF check.** `commands::auth::handle_auth_deep_link` (auth.rs:234-275) accepts `volt://auth/callback?access_token=...&refresh_token=...&user_id=...&expires_at=...` and writes directly to keyring. No state, no signature, no nonce. An attacker can force-login a victim into the attacker's Supabase account (account confusion / data injection), or, if the redirect endpoint is compromised, plant attacker-controlled tokens that the desktop app blindly trusts.

3. **Tokens passed via query string in deep links.** Tokens land in OS process arg lists, browser history (the `volt://` href row in `chrome://history`), event-tracing/Sysmon logs, and any OS-level URL handler logs. Use a one-time exchange code via the website backend instead.

4. **No JWT signature/audience verification.** `auth_get_session` returns the keyring blob unconditionally; downstream code trusts `user_id` and `expires_at` solely from the deep-link query. If keyring tampering is possible (or another Volt-namespaced app writes to the same `com.volt.launcher` service on Windows where DPAPI is per-user but multiple apps share user scope), the app trusts forged sessions.

5. **`deep-link:default` permission grants scheme registration to all windows including the renderer.** Audit `node_modules/@tauri-apps/plugin-deep-link/permissions/*` to confirm whether `register`/`unregister` are exposed; if so, an extension or compromised renderer can add/replace scheme registrations on Windows/Linux.

6. **CSP allows Supabase origin in `connect-src`** which is correct, but the renderer can also call `fetch('https://api.github.com', { headers: { Authorization: ... } })` — IntegrationsPanel.testToken does exactly this. Means token is exfiltrable via any XSS in the settings webview because there is no `connect-src` restriction beyond Supabase+GitHub releases. Consider routing token-test through the Rust backend.

7. **Hardcoded SUPABASE_ANON_KEY is shipped in the binary.** auth.rs:19 — `env!("SUPABASE_ANON_KEY")`. This is by Supabase design (anon keys are public-by-policy, RLS enforces auth). Confirm RLS is on for the `profiles` table or any table the desktop reaches. The Supabase project URL is also baked: `https://crmykhdztiyvfnjxrelx.supabase.co` (csp).

Good patterns already present:
- OS keyring (DPAPI/Keychain/Secret-Service) used for tokens; legacy plaintext credentials.json migrated and deleted.
- Service+token validated to allow-list (`["github","notion"]`) before save.
- OAuth state UUIDs are v4 (122-bit entropy, sufficient).
- Deep-link logger redacts query params (lib.rs:401).
- Tracing calls in oauth.rs/auth.rs/credentials.rs do NOT log token values.
- `volt://oauth-callback` prefix dispatch in lib.rs prevents the OAuth handler from being misrouted to other paths.
- Refresh-token rotation is implemented (auth.rs:175-220) including upstream-issued new refresh_token.

Hotspots to re-check on every PR:
- `src-tauri/src/lib.rs:396-441` (deep-link dispatcher).
- `src-tauri/src/commands/auth.rs:234-275` (auth deep-link parser — add state).
- `src-tauri/src/commands/oauth.rs:130-183` (state verification logic).
- `src-tauri/capabilities/default.json` (deep-link permission scope).
