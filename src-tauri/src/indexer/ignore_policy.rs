//! Shared scan/watcher eligibility. Ignore syntax is delegated to `ignore`;
//! rules apply without requiring a Git repository. At a given directory,
//! .voltignore overrides .ignore, which overrides .gitignore, which overrides
//! git's `.git/info/exclude`; git's global excludes (`core.excludesFile`) are
//! the lowest git source and only apply inside a repository. Child rules
//! override parent rules, except that a pruned parent must first be re-included.
//!
//! Precedence of the independent policies, strongest first:
//! 1. manual exclusions (`excludedPaths`: absolute prefixes, component names
//!    or gitignore-style glob patterns),
//! 2. ignore files (when `respect_ignore_files`), whose `!` rules may re-include
//!    an automatically excluded directory,
//! 3. automatic churn exclusions ([`CHURN_RULES`], when `exclude_generated_dirs`).
use super::types::IndexConfig;
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use tracing::warn;

pub(super) const IGNORE_FILES: [&str; 3] = [".gitignore", ".ignore", ".voltignore"];
const MAX_IGNORE_BYTES: u64 = 256 * 1024;
/// Upper bound on directory entries inspected for an extension marker.
const MAX_MARKER_SCAN: usize = 512;

/// Rules declared by one directory.
#[derive(Debug)]
struct DirectoryRules {
    /// `.git/info/exclude`, then `.gitignore`, `.ignore`, `.voltignore`
    /// (later sources win on conflicting matches).
    local: Gitignore,
    /// git's global excludes, only for a directory holding `.git`.
    global: Option<Gitignore>,
}

#[derive(Debug, Clone)]
pub(super) struct IgnorePolicy {
    roots: Vec<PathBuf>,
    root_aliases: Vec<(PathBuf, PathBuf)>,
    excluded: Vec<(String, PathBuf)>,
    patterns: Vec<String>,
    respect_ignore_files: bool,
    exclude_generated_dirs: bool,
    matchers: Arc<Mutex<HashMap<PathBuf, Arc<DirectoryRules>>>>,
    pattern_matchers: Arc<Mutex<HashMap<PathBuf, Arc<Gitignore>>>>,
    directory_decisions: Arc<Mutex<HashMap<PathBuf, bool>>>,
}

impl IgnorePolicy {
    pub(super) fn new(config: &IndexConfig) -> Self {
        let (patterns, plain): (Vec<&String>, Vec<&String>) = config
            .excluded_paths
            .iter()
            .partition(|raw| is_exclusion_pattern(raw));
        Self {
            roots: config
                .folders
                .iter()
                .map(|p| canonical(Path::new(p)))
                .collect(),
            root_aliases: config
                .folders
                .iter()
                .map(|p| (PathBuf::from(p), canonical(Path::new(p))))
                .collect(),
            excluded: plain
                .into_iter()
                .map(|p| {
                    let path = Path::new(p);
                    (
                        p.clone(),
                        if path.is_absolute() {
                            canonical(path)
                        } else {
                            path.to_path_buf()
                        },
                    )
                })
                .collect(),
            patterns: patterns
                .into_iter()
                .map(|p| p.trim().replace('\\', "/"))
                .collect(),
            respect_ignore_files: config.respect_ignore_files,
            exclude_generated_dirs: config.exclude_generated_dirs,
            matchers: Arc::new(Mutex::new(HashMap::new())),
            pattern_matchers: Arc::new(Mutex::new(HashMap::new())),
            directory_decisions: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// Same configuration with empty caches, so ignore-file edits made since
    /// the last scan are observed (used for one-shot external filtering).
    #[cfg(any(target_os = "windows", test))]
    fn detached(&self) -> Self {
        Self {
            matchers: Arc::new(Mutex::new(HashMap::new())),
            pattern_matchers: Arc::new(Mutex::new(HashMap::new())),
            directory_decisions: Arc::new(Mutex::new(HashMap::new())),
            ..self.clone()
        }
    }

    pub(super) fn invalidate(&self) {
        self.matchers
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clear();
        self.directory_decisions
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .clear();
    }

    pub(super) fn respects_ignore_files(&self) -> bool {
        self.respect_ignore_files
    }

    pub(super) fn allows(&self, path: &Path, is_dir: bool) -> bool {
        let path = self.normalize_path(path);
        if self.is_explicitly_excluded(&path) {
            return false;
        }
        self.allows_normalized(&path, is_dir)
    }

    /// Eligibility of a path that may live outside every indexed root (e.g. a
    /// Windows Search hit). Inside a root this is exactly [`Self::allows`];
    /// outside, the same exclusions, ignore files and churn rules apply with
    /// the volume root as the anchor.
    #[cfg(any(target_os = "windows", test))]
    pub(super) fn allows_external(&self, path: &Path, is_dir: bool) -> bool {
        let path = self.normalize_path(path);
        if self.is_explicitly_excluded(&path) {
            return false;
        }
        if self.roots.iter().any(|root| path.starts_with(root)) {
            return self.allows_normalized(&path, is_dir);
        }
        let Some(anchor) = path.ancestors().last().map(Path::to_path_buf) else {
            return true;
        };
        if path == anchor {
            return true;
        }
        self.allows_under(&path, &anchor, is_dir)
    }

    fn is_explicitly_excluded(&self, path: &Path) -> bool {
        self.excluded.iter().any(|(raw, excluded)| {
            if excluded.is_absolute() {
                path.starts_with(excluded)
            } else {
                path.components()
                    .any(|c| c.as_os_str().to_str() == Some(raw.as_str()))
            }
        })
    }

    pub(super) fn normalize_path(&self, path: &Path) -> PathBuf {
        // DirEntry/notify paths already sit under a known root. Normalize its
        // prefix once, avoiding a canonicalize syscall for every visited file.
        self.root_aliases
            .iter()
            .filter_map(|(alias, root)| {
                path.strip_prefix(alias)
                    .ok()
                    .map(|relative| (alias, root.join(relative)))
            })
            .max_by_key(|(alias, _)| alias.components().count())
            .map(|(_, path)| path)
            .unwrap_or_else(|| canonical(path))
    }

    fn allows_normalized(&self, path: &Path, is_dir: bool) -> bool {
        let Some(root) = self
            .roots
            .iter()
            .filter(|root| path.starts_with(root))
            .max_by_key(|root| root.components().count())
        else {
            return false;
        };
        // A user-selected root remains traversable even if named target/node_modules.
        if path == root {
            return true;
        }
        self.allows_under(path, root, is_dir)
    }

    /// Decide `path` (strictly below `root`) by deciding each ancestor up to
    /// `root` first: a pruned directory prunes its whole subtree.
    fn allows_under(&self, path: &Path, root: &Path, is_dir: bool) -> bool {
        if is_dir
            && let Some(allowed) = self
                .directory_decisions
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .get(path)
                .copied()
        {
            return allowed;
        }
        // Check every parent too: notify can emit a child of an ignored tree
        // without emitting its parent, unlike a recursive scanner.
        let mut candidates = Vec::new();
        let mut current = path;
        while current != root {
            candidates.push(current);
            let Some(parent) = current.parent() else {
                return false;
            };
            if let Some(allowed) = self
                .directory_decisions
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .get(parent)
                .copied()
            {
                if !allowed {
                    return false;
                }
                break;
            }
            current = parent;
        }
        let patterns = (!self.patterns.is_empty()).then(|| self.pattern_matcher(root));
        for candidate in candidates.into_iter().rev() {
            let candidate_is_dir = candidate != path || is_dir;
            let allowed = if patterns
                .as_ref()
                .is_some_and(|p| p.matched(candidate, candidate_is_dir).is_ignore())
            {
                false
            } else {
                self.ignore_file_decision(candidate, candidate_is_dir)
                    .unwrap_or_else(|| {
                        !(candidate_is_dir
                            && self.exclude_generated_dirs
                            && is_generated_directory(candidate))
                    })
            };
            if candidate_is_dir {
                self.directory_decisions
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .insert(candidate.to_path_buf(), allowed);
            }
            if !allowed {
                return false;
            }
        }
        true
    }

    /// Most local matching rule wins. Parsing is cached for one scan or watcher
    /// flush; invalid/partial files keep their valid rules.
    fn ignore_file_decision(&self, candidate: &Path, is_dir: bool) -> Option<bool> {
        if !self.respect_ignore_files {
            return None;
        }
        for parent in candidate.parent().into_iter().flat_map(Path::ancestors) {
            let rules = self.rules(parent);
            let mut matched = rules.local.matched(candidate, is_dir);
            if matched.is_none()
                && let Some(global) = rules.global.as_ref()
            {
                matched = global.matched(candidate, is_dir);
            }
            if matched.is_ignore() {
                return Some(false);
            }
            if matched.is_whitelist() {
                return Some(true);
            }
        }
        None
    }

    fn pattern_matcher(&self, root: &Path) -> Arc<Gitignore> {
        let mut cache = self
            .pattern_matchers
            .lock()
            .unwrap_or_else(|p| p.into_inner());
        cache
            .entry(root.to_path_buf())
            .or_insert_with(|| {
                let mut builder = GitignoreBuilder::new(root);
                for pattern in &self.patterns {
                    if let Err(error) = builder.add_line(None, pattern) {
                        warn!("Skipped invalid exclusion pattern {:?}: {}", pattern, error);
                    }
                }
                Arc::new(builder.build().unwrap_or_else(|error| {
                    warn!("Cannot compile exclusion patterns: {}", error);
                    Gitignore::empty()
                }))
            })
            .clone()
    }

    fn rules(&self, directory: &Path) -> Arc<DirectoryRules> {
        let mut cache = self.matchers.lock().unwrap_or_else(|p| p.into_inner());
        cache
            .entry(directory.to_path_buf())
            .or_insert_with(|| {
                let mut builder = GitignoreBuilder::new(directory);
                // `.git` is a directory in a repository, a file in a worktree or
                // submodule; never follow a symlinked one.
                let git = directory.join(".git");
                let git_meta = std::fs::symlink_metadata(&git)
                    .ok()
                    .filter(|m| !m.file_type().is_symlink());
                if git_meta.as_ref().is_some_and(std::fs::Metadata::is_dir) {
                    add_rules_file(&mut builder, &git.join("info").join("exclude"));
                }
                for name in IGNORE_FILES {
                    add_rules_file(&mut builder, &directory.join(name));
                }
                let local = builder.build().unwrap_or_else(|error| {
                    warn!("Cannot compile ignore rules in {:?}: {}", directory, error);
                    Gitignore::empty()
                });
                let global = git_meta.and_then(|_| {
                    let (global, error) = GitignoreBuilder::new(directory).build_global();
                    if let Some(error) = error {
                        warn!("Partial git global excludes for {:?}: {}", directory, error);
                    }
                    (!global.is_empty()).then_some(global)
                });
                Arc::new(DirectoryRules { local, global })
            })
            .clone()
    }
}

/// Append one ignore file's rules. Size-bounded, never through a symlink;
/// invalid lines are skipped so the remaining rules still apply.
fn add_rules_file(builder: &mut GitignoreBuilder, file: &Path) {
    if !std::fs::symlink_metadata(file).is_ok_and(|m| m.is_file() && !m.file_type().is_symlink()) {
        return;
    }
    let Ok(handle) = std::fs::File::open(file) else {
        return;
    };
    let mut contents = String::new();
    if handle
        .take(MAX_IGNORE_BYTES + 1)
        .read_to_string(&mut contents)
        .is_err()
        || contents.len() as u64 > MAX_IGNORE_BYTES
    {
        warn!("Ignore file unreadable or larger than 256 KiB: {:?}", file);
        return;
    }
    let mut invalid_rules = 0;
    for line in contents
        .strip_prefix('\u{feff}')
        .unwrap_or(&contents)
        .lines()
    {
        if builder.add_line(Some(file.to_path_buf()), line).is_err() {
            invalid_rules += 1;
        }
    }
    if invalid_rules > 0 {
        warn!(
            "Skipped {} invalid ignore rules in {:?}",
            invalid_rules, file
        );
    }
}

fn canonical(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }
    // Windows canonicalizes existing paths with a verbatim prefix. A stale
    // Windows Search hit (or a pending watcher delete) may no longer exist:
    // keep its prefix consistent with existing excluded directories anyway.
    for ancestor in path.ancestors().skip(1) {
        if let Ok(canonical) = ancestor.canonicalize()
            && let Ok(relative) = path.strip_prefix(ancestor)
        {
            return canonical.join(relative);
        }
    }
    path.to_path_buf()
}

/// A relative `excludedPaths` entry holding glob syntax or a separator is a
/// gitignore-style pattern evaluated against every indexed root
/// (`*.iso`, `**/logs/*.txt`, `/scratch`). Plain names keep component matching.
fn is_exclusion_pattern(raw: &str) -> bool {
    let trimmed = raw.trim();
    !trimmed.is_empty()
        && !Path::new(trimmed).is_absolute()
        && trimmed.contains(['*', '?', '[', '/', '\\'])
}

// ---------------------------------------------------------------------------
// Automatic churn exclusion
// ---------------------------------------------------------------------------

/// Evidence required before a directory name is treated as churn.
#[derive(Debug, Clone, Copy)]
pub(super) enum ChurnMarker {
    /// The name alone is unambiguous.
    Always,
    /// One of these files sits next to the directory.
    SiblingFile(&'static [&'static str]),
    /// One of these files sits inside the directory.
    ChildFile(&'static [&'static str]),
    /// A sibling file has one of these extensions.
    SiblingExtension(&'static [&'static str]),
}

#[derive(Debug, Clone, Copy)]
pub(super) struct ChurnRule {
    pub(super) name: &'static str,
    pub(super) marker: ChurnMarker,
}

const PACKAGE_JSON: &[&str] = &["package.json"];
const GRADLE: &[&str] = &[
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
];
const PYVENV: &[&str] = &["pyvenv.cfg"];

const fn always(name: &'static str) -> ChurnRule {
    ChurnRule {
        name,
        marker: ChurnMarker::Always,
    }
}

const fn next_to(name: &'static str, files: &'static [&'static str]) -> ChurnRule {
    ChurnRule {
        name,
        marker: ChurnMarker::SiblingFile(files),
    }
}

/// High-churn, regenerable directories excluded automatically. Only names that
/// are unambiguous, or corroborated by their project/runtime marker; generic
/// names (`build`, `dist`, `cache`, `temp`) stay in the user-editable default
/// `excludedPaths` list instead of being duplicated here.
pub(super) const CHURN_RULES: &[ChurnRule] = &[
    // VCS and language tooling caches.
    always(".git"),
    always("node_modules"),
    always("__pycache__"),
    always(".pytest_cache"),
    always(".mypy_cache"),
    always(".ruff_cache"),
    always(".tox"),
    always(".nox"),
    always(".turbo"),
    always(".parcel-cache"),
    always(".vs"),
    always(".terraform"),
    // Build outputs corroborated by their project file.
    next_to("target", &["Cargo.toml"]),
    next_to(".next", PACKAGE_JSON),
    next_to(".nuxt", PACKAGE_JSON),
    next_to(".svelte-kit", PACKAGE_JSON),
    next_to(".angular", PACKAGE_JSON),
    next_to(".expo", PACKAGE_JSON),
    next_to(".docusaurus", PACKAGE_JSON),
    next_to(".dart_tool", &["pubspec.yaml"]),
    next_to("CMakeFiles", &["CMakeLists.txt"]),
    next_to(".gradle", GRADLE),
    ChurnRule {
        name: "obj",
        marker: ChurnMarker::SiblingExtension(&["csproj", "fsproj", "vbproj"]),
    },
    ChurnRule {
        name: ".venv",
        marker: ChurnMarker::ChildFile(PYVENV),
    },
    ChurnRule {
        name: "venv",
        marker: ChurnMarker::ChildFile(PYVENV),
    },
    // Browser / Electron / OS caches.
    always("Code Cache"),
    always("GPUCache"),
    always("GrShaderCache"),
    always("ShaderCache"),
    always("DawnCache"),
    always("DawnGraphiteCache"),
    always("DawnWebGPUCache"),
    always("cache2"),
    always("INetCache"),
    always("D3DSCache"),
    always("CrashDumps"),
];

fn churn_name_matches(rule: &str, name: &str) -> bool {
    if cfg!(target_os = "windows") {
        rule.eq_ignore_ascii_case(name)
    } else {
        rule == name
    }
}

fn is_generated_directory(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let Some(parent) = path.parent() else {
        return false;
    };
    CHURN_RULES
        .iter()
        .filter(|rule| churn_name_matches(rule.name, name))
        .any(|rule| match rule.marker {
            ChurnMarker::Always => true,
            ChurnMarker::SiblingFile(files) => files.iter().any(|f| parent.join(f).is_file()),
            ChurnMarker::ChildFile(files) => files.iter().any(|f| path.join(f).is_file()),
            ChurnMarker::SiblingExtension(extensions) => std::fs::read_dir(parent)
                .map(|entries| {
                    entries.flatten().take(MAX_MARKER_SCAN).any(|entry| {
                        entry
                            .path()
                            .extension()
                            .and_then(|e| e.to_str())
                            .is_some_and(|e| extensions.iter().any(|x| e.eq_ignore_ascii_case(x)))
                    })
                })
                .unwrap_or(false),
        })
}

// ---------------------------------------------------------------------------
// External results (Windows Search)
// ---------------------------------------------------------------------------

static EXTERNAL_POLICY: RwLock<Option<IgnorePolicy>> = RwLock::new(None);

/// Publish the current indexing configuration so results that do not come
/// from Volt's own walk (Windows Search) honour the same exclusions.
pub(crate) fn set_external_policy(config: &IndexConfig) {
    *EXTERNAL_POLICY.write().unwrap_or_else(|p| p.into_inner()) = Some(IgnorePolicy::new(config));
}

/// Fresh-cache copy of the published policy, if indexing was configured.
#[cfg(any(target_os = "windows", test))]
pub(super) fn external_policy() -> Option<IgnorePolicy> {
    EXTERNAL_POLICY
        .read()
        .unwrap_or_else(|p| p.into_inner())
        .as_ref()
        .map(IgnorePolicy::detached)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn policy(root: &Path) -> IgnorePolicy {
        IgnorePolicy::new(&IndexConfig {
            folders: vec![root.to_string_lossy().into_owned()],
            ..IndexConfig::default()
        })
    }

    #[test]
    fn external_settings_policy_applies_without_startup_indexing() {
        use crate::commands::system::settings::IndexingSettings;

        let root = tempfile::tempdir().unwrap();
        let excluded = root.path().join("private.txt");
        let ignored = root.path().join("ignored.txt");
        let allowed = root.path().join("visible.txt");
        for path in [&excluded, &ignored, &allowed] {
            fs::write(path, b"x").unwrap();
        }
        fs::write(root.path().join(".voltignore"), "ignored.txt\n").unwrap();
        let settings = IndexingSettings {
            // No indexed roots and no startup scan: Windows Search still uses
            // manual exclusions and hierarchical ignore rules outside roots.
            folders: Vec::new(),
            index_on_startup: false,
            excluded_paths: vec![excluded.to_string_lossy().into_owned()],
            ..IndexingSettings::default()
        };
        let config = IndexConfig::from(&settings);
        let policy = IgnorePolicy::new(&config);
        assert!(!policy.allows_external(&excluded, false));
        assert!(!policy.allows_external(&ignored, false));
        assert!(policy.allows_external(&allowed, false));
        assert_eq!(config.max_depth, 3);
        assert!(!config.diagnostics_enabled);
    }

    #[test]
    fn hierarchical_rules_negation_anchoring_and_source_precedence() {
        let root = tempfile::tempdir().unwrap();
        let sub = root.path().join("sub");
        fs::create_dir(&sub).unwrap();
        fs::write(
            root.path().join(".gitignore"),
            "*.log\n/root-only.txt\nblocked/\n",
        )
        .unwrap();
        fs::write(root.path().join(".ignore"), "!keep.log\n").unwrap();
        fs::write(root.path().join(".voltignore"), "keep.log\n!volt.log\n").unwrap();
        fs::write(sub.join(".voltignore"), "!child.log\n").unwrap();
        for path in [
            root.path().join("keep.log"),
            root.path().join("volt.log"),
            root.path().join("root-only.txt"),
            sub.join("root-only.txt"),
            sub.join("child.log"),
        ] {
            fs::write(path, b"x").unwrap();
        }
        let policy = policy(root.path());
        assert!(!policy.allows(&root.path().join("keep.log"), false));
        assert!(policy.allows(&root.path().join("volt.log"), false));
        assert!(!policy.allows(&root.path().join("root-only.txt"), false));
        assert!(policy.allows(&sub.join("root-only.txt"), false));
        assert!(policy.allows(&sub.join("child.log"), false));
        fs::create_dir(root.path().join("blocked")).unwrap();
        fs::write(root.path().join("blocked/.voltignore"), "!visible.txt\n").unwrap();
        fs::write(root.path().join("blocked/visible.txt"), b"x").unwrap();
        assert!(!policy.allows(&root.path().join("blocked/visible.txt"), false));
    }

    #[test]
    fn generated_names_need_evidence_and_explicit_roots_remain_accessible() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        for name in ["target", "build", "dist", "cache", "node_modules"] {
            fs::create_dir(root.join(name)).unwrap();
        }
        let policy = policy(root);
        for name in ["target", "build", "dist", "cache"] {
            assert!(policy.allows(&root.join(name), true));
        }
        assert!(!policy.allows(&root.join("node_modules"), true));
        fs::write(root.join("Cargo.toml"), "[package]").unwrap();
        policy.invalidate();
        assert!(!policy.allows(&root.join("target"), true));
        let explicit = IgnorePolicy::new(&IndexConfig {
            folders: vec![root.join("target").to_string_lossy().into_owned()],
            ..IndexConfig::default()
        });
        fs::write(root.join("target/keep.txt"), b"x").unwrap();
        assert!(explicit.allows(&root.join("target"), true));
        assert!(explicit.allows(&root.join("target/keep.txt"), false));
    }

    #[test]
    fn disabled_policies_and_explicit_exclusions_remain_independent() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        fs::create_dir(root.join("node_modules")).unwrap();
        fs::create_dir(root.join("node_modules-old")).unwrap();
        fs::write(root.join(".voltignore"), "*.txt\n").unwrap();
        fs::write(root.join("keep.txt"), b"x").unwrap();
        let policy = IgnorePolicy::new(&IndexConfig {
            folders: vec![root.to_string_lossy().into_owned()],
            respect_ignore_files: false,
            exclude_generated_dirs: false,
            excluded_paths: vec!["node_modules".into()],
            ..IndexConfig::default()
        });
        assert!(policy.allows(&root.join("keep.txt"), false));
        assert!(!policy.allows(&root.join("node_modules"), true));
        assert!(policy.allows(&root.join("node_modules-old"), true));
    }

    #[test]
    fn ignore_files_are_size_bounded_and_invalid_rules_do_not_erase_valid_rules() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join(".gitignore"), "*.log\ninvalid/***/glob\n").unwrap();
        fs::write(
            root.path().join(".voltignore"),
            vec![b'x'; MAX_IGNORE_BYTES as usize + 1],
        )
        .unwrap();
        let policy = policy(root.path());
        assert!(!policy.allows(&root.path().join("a.log"), false));
        assert!(policy.allows(&root.path().join("a.txt"), false));
    }

    #[test]
    fn explicit_whitelist_can_reenable_generated_directory() {
        let root = tempfile::tempdir().unwrap();
        fs::write(root.path().join(".voltignore"), "!node_modules/\n").unwrap();
        fs::create_dir(root.path().join("node_modules")).unwrap();
        assert!(policy(root.path()).allows(&root.path().join("node_modules/example.txt"), false));
    }

    #[test]
    fn relative_exclusion_remains_a_component_even_when_it_exists_in_cwd() {
        assert!(Path::new("src").is_dir(), "crate fixture has src");
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("src")).unwrap();
        let policy = IgnorePolicy::new(&IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            excluded_paths: vec!["src".into()],
            exclude_generated_dirs: false,
            respect_ignore_files: false,
            ..IndexConfig::default()
        });
        assert!(!policy.excluded[0].1.is_absolute());
        assert!(!policy.allows(&root.path().join("src"), true));
    }

    #[cfg(unix)]
    #[test]
    fn ignore_file_symlink_is_not_read() {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let rules = other.path().join("rules");
        fs::write(&rules, "*.txt\n").unwrap();
        std::os::unix::fs::symlink(&rules, root.path().join(".voltignore")).unwrap();
        assert!(policy(root.path()).allows(&root.path().join("keep.txt"), false));
    }

    #[test]
    fn git_info_exclude_applies_inside_repository_below_gitignore() {
        let root = tempfile::tempdir().unwrap();
        let repo = root.path().join("repo");
        let nested = repo.join("nested");
        fs::create_dir_all(repo.join(".git/info")).unwrap();
        fs::create_dir_all(&nested).unwrap();
        fs::write(
            repo.join(".git/info/exclude"),
            "*.volt-local\nreinclude.volt-local-b\n",
        )
        .unwrap();
        // .gitignore wins over info/exclude in the same directory.
        fs::write(repo.join(".gitignore"), "!keep.volt-local\n").unwrap();
        // Nested patterns are relative to their own directory.
        fs::write(nested.join(".gitignore"), "/anchored.txt\n").unwrap();
        // Without a `.git` directory, `info/exclude` is not a rule source.
        let plain = root.path().join("plain/.git-lookalike/info");
        fs::create_dir_all(&plain).unwrap();
        fs::write(plain.join("exclude"), "*.volt-local\n").unwrap();
        let policy = policy(root.path());
        assert!(!policy.allows(&repo.join("drop.volt-local"), false));
        assert!(!policy.allows(&nested.join("drop.volt-local"), false));
        assert!(policy.allows(&repo.join("keep.volt-local"), false));
        assert!(!policy.allows(&nested.join("anchored.txt"), false));
        assert!(policy.allows(&repo.join("anchored.txt"), false));
        assert!(policy.allows(&root.path().join("plain/x.volt-local"), false));
    }

    #[test]
    fn excluded_glob_patterns_apply_per_root_and_beat_ignore_file_whitelists() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("a/logs")).unwrap();
        fs::create_dir_all(root.path().join("scratch")).unwrap();
        fs::create_dir_all(root.path().join("a/scratch")).unwrap();
        fs::write(root.path().join(".voltignore"), "!*.iso\n").unwrap();
        let policy = IgnorePolicy::new(&IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            excluded_paths: vec![
                "*.iso".into(),
                "scratch/**".into(),
                "**\\logs\\*.txt".into(),
                "plain".into(),
            ],
            respect_ignore_files: true,
            ..IndexConfig::default()
        });
        assert_eq!(policy.patterns.len(), 3);
        assert_eq!(policy.excluded.len(), 1);
        assert!(!policy.allows(&root.path().join("a/disk.iso"), false));
        // A middle slash anchors the pattern to each indexed root.
        assert!(!policy.allows(&root.path().join("scratch/x.txt"), false));
        assert!(policy.allows(&root.path().join("a/scratch/x.txt"), false));
        assert!(!policy.allows(&root.path().join("a/logs/x.txt"), false));
        assert!(policy.allows(&root.path().join("a/logs/x.md"), false));
        // Patterns are manual exclusions: they hold with ignore files disabled.
        let no_files = IgnorePolicy::new(&IndexConfig {
            respect_ignore_files: false,
            exclude_generated_dirs: false,
            ..IndexConfig {
                folders: vec![root.path().to_string_lossy().into_owned()],
                excluded_paths: vec!["*.iso".into()],
                ..IndexConfig::default()
            }
        });
        assert!(!no_files.allows(&root.path().join("disk.iso"), false));
    }

    #[test]
    fn churn_rules_cover_caches_and_require_markers_where_ambiguous() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        for name in [
            "Code Cache",
            "GPUCache",
            ".turbo",
            "obj",
            ".dart_tool",
            "cache2",
        ] {
            fs::create_dir(root.join(name)).unwrap();
        }
        let policy = policy(root);
        assert!(!policy.allows(&root.join("Code Cache/data_0"), false));
        assert!(!policy.allows(&root.join("GPUCache"), true));
        assert!(!policy.allows(&root.join(".turbo"), true));
        assert!(!policy.allows(&root.join("cache2"), true));
        // Marker-gated names stay indexed until their project file appears.
        assert!(policy.allows(&root.join("obj"), true));
        assert!(policy.allows(&root.join(".dart_tool"), true));
        fs::write(root.join("App.csproj"), "<Project/>").unwrap();
        fs::write(root.join("pubspec.yaml"), "name: x").unwrap();
        policy.invalidate();
        assert!(!policy.allows(&root.join("obj"), true));
        assert!(!policy.allows(&root.join(".dart_tool"), true));
        // A file named like a churn directory is not pruned.
        fs::write(root.join("node_modules"), b"x").unwrap();
        assert!(policy.allows(&root.join("node_modules"), false));
        // The toggle turns every automatic rule off.
        let off = IgnorePolicy::new(&IndexConfig {
            folders: vec![root.to_string_lossy().into_owned()],
            exclude_generated_dirs: false,
            ..IndexConfig::default()
        });
        assert!(off.allows(&root.join("GPUCache"), true));
        assert!(off.allows(&root.join("obj"), true));
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn churn_names_are_case_insensitive_on_windows() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("gpucache")).unwrap();
        assert!(!policy(root.path()).allows(&root.path().join("gpucache"), true));
    }

    #[test]
    fn churn_rules_are_unique_and_do_not_duplicate_generic_default_exclusions() {
        let mut names: Vec<&str> = CHURN_RULES.iter().map(|rule| rule.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), CHURN_RULES.len());
        let defaults = crate::commands::system::settings::default_excluded_paths();
        // Specific names such as node_modules remain automatic even when a
        // user removes their manual exclusion. Generic names must stay solely
        // in the editable defaults, where they can be removed without a marker.
        for generic in [
            "build", "dist", "tmp", "temp", "Temp", "Cache", "cache", "Caches", "caches", ".cache",
        ] {
            assert!(defaults.iter().any(|d| d == generic));
            assert!(
                !CHURN_RULES.iter().any(|rule| rule.name == generic),
                "{generic} duplicates a generic default exclusion"
            );
        }
    }

    #[test]
    fn external_paths_outside_roots_use_the_same_exclusions() {
        let indexed = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let project = outside.path().join("project");
        fs::create_dir_all(project.join("node_modules/pkg")).unwrap();
        fs::create_dir_all(project.join("private")).unwrap();
        fs::write(project.join(".voltignore"), "*.secret\n").unwrap();
        let policy = IgnorePolicy::new(&IndexConfig {
            folders: vec![indexed.path().to_string_lossy().into_owned()],
            excluded_paths: vec![project.join("private").to_string_lossy().into_owned()],
            ..IndexConfig::default()
        });
        // `allows` only accepts indexed roots; `allows_external` filters others.
        assert!(!policy.allows(&project.join("notes.md"), false));
        assert!(policy.allows_external(&project.join("notes.md"), false));
        assert!(!policy.allows_external(&project.join("node_modules/pkg/a.md"), false));
        assert!(!policy.allows_external(&project.join("key.secret"), false));
        assert!(!policy.allows_external(&project.join("private/a.md"), false));
        fs::write(indexed.path().join("in-root.md"), b"x").unwrap();
        assert!(policy.allows_external(&indexed.path().join("in-root.md"), false));
    }

    #[test]
    fn published_external_policy_is_detached_from_scan_caches() {
        let root = tempfile::tempdir().unwrap();
        let config = IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            ..IndexConfig::default()
        };
        set_external_policy(&config);
        let first = external_policy().expect("policy published");
        assert!(first.allows_external(&root.path().join("a.tmpx"), false));
        // A rule written after the first lookup is seen by the next copy.
        fs::write(root.path().join(".voltignore"), "*.tmpx\n").unwrap();
        let second = external_policy().expect("policy published");
        assert!(!second.allows_external(&root.path().join("a.tmpx"), false));
    }

    /// Regenerates `autoExcludedDirs.ts` so Settings lists exactly the rules
    /// Rust applies (same mechanism as ts-rs: `cargo test` writes it).
    #[test]
    fn export_auto_excluded_dirs() {
        let rows = CHURN_RULES
            .iter()
            .map(|rule| {
                let (condition, markers): (&str, &[&str]) = match rule.marker {
                    ChurnMarker::Always => ("always", &[]),
                    ChurnMarker::SiblingFile(m) => ("siblingFile", m),
                    ChurnMarker::ChildFile(m) => ("childFile", m),
                    ChurnMarker::SiblingExtension(m) => ("siblingExtension", m),
                };
                let markers = markers
                    .iter()
                    .map(|m| format!("{m:?}"))
                    .collect::<Vec<_>>()
                    .join(", ");
                format!(
                    "  {{ name: {:?}, condition: \"{condition}\", markers: [{markers}] }},",
                    rule.name
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        let content = format!(
            "// This file was generated by `cargo test` from src-tauri/src/indexer/ignore_policy.rs. Do not edit this file manually.\n\
             \n\
             export type AutoExcludedDirCondition = \"always\" | \"siblingFile\" | \"childFile\" | \"siblingExtension\";\n\
             \n\
             export type AutoExcludedDir = {{ name: string, condition: AutoExcludedDirCondition, markers: readonly string[] }};\n\
             \n\
             /**\n * Directories the indexer skips automatically when `excludeGeneratedDirs` is on.\n */\n\
             export const AUTO_EXCLUDED_DIRS: readonly AutoExcludedDir[] = [\n{rows}\n];\n"
        );
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src/shared/types/generated/autoExcludedDirs.ts");
        let current = fs::read_to_string(&path).unwrap_or_default();
        if current != content {
            fs::write(&path, content).expect("write autoExcludedDirs.ts");
        }
    }

    /// Run with `cargo test --lib indexer::ignore_policy::tests::policy_fixture_measurement -- --ignored --nocapture`.
    /// Measures pruning/eligibility only, with no platform icon extraction.
    #[test]
    #[ignore = "manual reproducible timing fixture; no timing assertion"]
    fn policy_fixture_measurement() {
        let root = tempfile::tempdir().unwrap();
        fs::create_dir(root.path().join("node_modules")).unwrap();
        fs::create_dir(root.path().join("src")).unwrap();
        let config = IndexConfig {
            folders: vec![root.path().to_string_lossy().into_owned()],
            respect_ignore_files: false,
            ..IndexConfig::default()
        };
        let paths: Vec<PathBuf> = (0..20_000)
            .map(|i| {
                root.path()
                    .join(if i < 18_000 { "node_modules" } else { "src" })
                    .join(format!("{i}.txt"))
            })
            .collect();
        for exclude_generated_dirs in [false, true] {
            let policy = IgnorePolicy::new(&IndexConfig {
                exclude_generated_dirs,
                ..config.clone()
            });
            let started = std::time::Instant::now();
            let kept = paths
                .iter()
                .filter(|path| policy.allows(path, false))
                .count();
            println!(
                "generated exclusions={exclude_generated_dirs}: visited={} kept={kept} elapsed={:?}",
                paths.len(),
                started.elapsed()
            );
            assert_eq!(
                kept,
                if exclude_generated_dirs {
                    2_000
                } else {
                    20_000
                }
            );
        }
    }
}
