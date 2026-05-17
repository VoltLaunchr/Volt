---
name: PR #75 release-readiness audit (v0.1.2 dev @ 8267edc)
description: Auth/OAuth/Credentials/Deep-link verification — all four hardening tracks verified shippable
type: project
---

PR #75 (release v0.1.2) audited 2026-05-03 on dev branch HEAD 8267edc. All security mitigations from the 20+ hardening commits are correctly landed.

**Why:** Confirmation that prior audit findings (load_credential renderer exposure, deep-link unauth, missing CSRF, JWT trust, multi-window token theft surface) were actually fixed before merge.

**How to apply:** When future audits reference auth.rs / oauth.rs / credentials.rs / keyring_store.rs / extension_state_sig.rs, treat the v0.1.2 baseline as known-good. Re-verify only on diffs.

**Verified properties (do not re-prove these unless changed):**
- PKCE replaces token-in-URL; verifier in process memory only; tokens via HTTPS exchange
- State nonce: uuid v4, single-use (removed on use), 5-min TTL, cap 64 with oldest-eviction
- JWT: ES256/RS256/EdDSA only, JWKS retry+force-refresh on unknown kid, alg-confusion guard at header-vs-JWK level, validate_exp/iss/aud, empty-sub rejected
- Refresh: response.user.id AND verified JWT.sub both pinned to stored user_id; expires_in capped at 24h
- Legacy implicit path still JWKS-verified — safe to keep until v0.2.0 removes it
- OAuth: host == "oauth-callback" enforced; service whitelist; state-must-match-service; 15-min TTL; cap 32; full state at trace, hint at info
- Credentials: HMAC payload = account || NUL || secret, domain-tagged "volt-credential-v1", constant-time compare via XOR-accumulator and verify_slice; legacy untagged entries accepted ONCE then upgraded
- load_credential is `pub fn`, NOT in invoke_handler — token never crosses renderer boundary
- test_credential does network round-trip server-side
- Keyring v3 platform features (apple-native, windows-native, sync-secret-service+crypto-rust) all enabled in Cargo.toml — explicit comment documents v3 mock-store footgun
- Deep-link rate-limit 5/60s sliding window with transition-only warn; queue capped at 4× limit
- Single-instance logs all volt:// argv at info with query stripped (forensic trail)

**Known accepted limitations (documented in code, not blockers):**
- HMAC key co-located with secrets in OS keyring — a peer-process attacker as same user can re-sign. Inline comment at keyring_store.rs:96-110 acknowledges and explains why this still raises the bar.
- Per-window emit_to in lib.rs:539-548 widens consideration surface but is intentional defense-in-depth for Settings window listener-timing.

**Verdict:** ship.
