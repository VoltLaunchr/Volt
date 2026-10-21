#!/usr/bin/env bash
set -euo pipefail

failed=0

tracked_private_files="$({
  git ls-files '*.key' '*.pem' '*.p12' '*.pfx'
  git ls-files '.env' '.env.*'
} | grep -Ev '(\.key\.pub$|(^|/)\.env\.example$)' || true)"

if [[ -n "$tracked_private_files" ]]; then
  echo 'Tracked private-key or environment files are forbidden:' >&2
  echo "$tracked_private_files" >&2
  failed=1
fi

secret_matches="$(git grep -IEn \
  -e 'sb_secret_[A-Za-z0-9_-]{20,}' \
  -e '-----BEGIN ([A-Z0-9 ]+ )?PRIVATE KEY-----' \
  -e 'untrusted comment: minisign secret key' \
  -- . ':(exclude)scripts/check-no-secrets.sh' || true)"

if [[ -n "$secret_matches" ]]; then
  echo 'Probable secret material is tracked:' >&2
  echo "$secret_matches" >&2
  failed=1
fi

exit "$failed"
