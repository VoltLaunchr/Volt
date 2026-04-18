/**
 * Volt commit message policy.
 * Enforced locally via scripts/hooks/commit-msg (bun run setup-hooks)
 * and in CI via the PR title lint workflow.
 *
 * Rules follow Conventional Commits (extends @commitlint/config-conventional).
 * The allowed `type` set matches the groups consumed by cliff.toml so every
 * merged commit flows into a changelog section.
 */
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',      // new feature                   → Features
        'fix',       // bug fix                       → Bug Fixes
        'perf',      // performance improvement       → Performance
        'refactor',  // internal cleanup              → Refactoring
        'docs',      // documentation only            → Documentation
        'test',      // tests only                    → Testing
        'style',     // formatting, no code change    → Styling
        'ci',        // CI pipeline                   → CI
        'build',     // build system / bundler        → Other
        'chore',     // misc housekeeping             → Other
        'revert',    // reverts a previous commit
      ],
    ],
    // Allow long bodies (useful for release PRs with generated changelogs)
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    // Subject: no period at end, lowercase is preferred but not enforced
    'subject-full-stop': [2, 'never', '.'],
    'subject-empty': [2, 'never'],
    'type-empty': [2, 'never'],
  },
};
