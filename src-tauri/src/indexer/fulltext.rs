//! Full-text / relevance file index backed by [Tantivy](https://crates.io/crates/tantivy).
//!
//! **Track 1 of Pilier D** (see `REFONTE-PILIER-D-SEARCH.md`). This module is the
//! feature-flagged scaffolding for a next-generation file-search backend that
//! replaces the O(N)-per-keystroke in-memory nucleo scan with an inverted index.
//!
//! # Feature flag
//!
//! The entire module is gated behind the `tantivy-search` Cargo feature, which is
//! **OFF by default**. When the feature is off, this file is not compiled and the
//! existing [`crate::indexer::search_engine::SearchEngine`] (nucleo) remains the
//! one and only search path — behaviour is byte-for-byte unchanged.
//!
//! # Integration point (documented, not yet wired)
//!
//! The default search path in `commands/files.rs::search_files` is intentionally
//! left untouched. When this feature graduates from scaffolding to production, the
//! integration is a single `#[cfg]` branch at the top of `search_files`:
//!
//! ```ignore
//! #[cfg(feature = "tantivy-search")]
//! if let Some(ft) = state.fulltext.as_ref() {
//!     return ft.query(&query, &opts).map(/* -> FileSearchResult */ ...);
//! }
//! // default (no feature, or index unavailable): existing nucleo path below
//! ```
//!
//! The Tantivy index is *derived* from the same [`FileInfo`] stream the existing
//! scanner/SQLite pipeline already produces; SQLite remains the source of truth and
//! the index can always be rebuilt from it. Nothing here changes `FileInfo` or the
//! SQLite schema.

#![cfg(feature = "tantivy-search")]
// Scaffolding: the public API below is exercised by the cfg(test) suite but is
// not yet called from the non-test lib build — the integration point in
// `commands/files.rs::search_files` is documented (see module docs) but
// intentionally left unwired so the default search path is untouched until this
// backend is promoted. The dead-code allow is scoped to this feature-gated
// module only; the default build (no features) is unaffected.
#![allow(dead_code)]

use std::path::Path;

use tantivy::collector::TopDocs;
use tantivy::query::QueryParser;
use tantivy::schema::{Field, STORED, STRING, Schema, TEXT, Value};
use tantivy::{Index, IndexWriter, TantivyDocument, Term, doc};

use super::types::FileInfo;

/// Heap budget for the Tantivy `IndexWriter` arena, in bytes (50 MB).
const WRITER_HEAP_BYTES: usize = 50_000_000;

/// A single search hit returned by the full-text backend.
///
/// `camelCase` so it can be serialized straight to the frontend if/when this
/// backend is wired into a Tauri command (mirrors `FileSearchResult`).
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileHit {
    /// Absolute path of the matched file (the document's unique key).
    pub path: String,
    /// File name (basename).
    pub name: String,
    /// BM25 relevance score from Tantivy.
    pub score: f32,
}

/// The set of Tantivy [`Field`] handles for our schema.
///
/// Kept together so query construction and document building share one source of
/// truth for field identity.
#[derive(Debug, Clone, Copy)]
struct Fields {
    /// Exact, untokenized, stored — the unique document key (`STRING | STORED`).
    path: Field,
    /// Tokenized + stored — the primary BM25 relevance field.
    name: Field,
    /// Exact, untokenized — supports the `ext:` operator.
    ext: Field,
    /// Exact, untokenized — supports the `category` filter.
    category: Field,
    /// Fast field (u64) — file size in bytes, for `size:` filters / sorting.
    size: Field,
    /// Fast field (i64) — modification time (Unix secs), for recency sorting.
    mtime: Field,
}

/// Build the file-search schema.
///
/// See `REFONTE-PILIER-D-SEARCH.md` §2.3 for the rationale behind each field's
/// indexing options. `FAST` fields enable sort/filter without document loads.
fn build_schema() -> (Schema, Fields) {
    use tantivy::schema::{FAST, SchemaBuilder};

    let mut sb: SchemaBuilder = Schema::builder();
    let path = sb.add_text_field("path", STRING | STORED);
    let name = sb.add_text_field("name", TEXT | STORED);
    let ext = sb.add_text_field("ext", STRING);
    let category = sb.add_text_field("category", STRING);
    let size = sb.add_u64_field("size", FAST);
    let mtime = sb.add_i64_field("mtime", FAST);
    let schema = sb.build();

    (
        schema,
        Fields {
            path,
            name,
            ext,
            category,
            size,
            mtime,
        },
    )
}

/// Convert our [`super::types::FileCategory`] to its lowercase serde tag, matching
/// what SQLite stores. Falls back to `"other"` on serialization failure.
fn category_tag(file: &FileInfo) -> String {
    serde_json::to_string(&file.category)
        .unwrap_or_else(|_| "\"other\"".to_string())
        .trim_matches('"')
        .to_string()
}

/// A full-text file index. Wraps a Tantivy [`Index`] plus our field handles.
///
/// The reader is created on demand (cheap) rather than held, so the struct stays
/// `Send + Sync` without extra synchronization around a long-lived reader.
pub struct FulltextIndex {
    index: Index,
    fields: Fields,
}

impl FulltextIndex {
    /// Open (or create) a persistent index at `dir`.
    ///
    /// The directory is created if missing. If a Tantivy index already exists
    /// there it is opened (mmap); otherwise a fresh one is created with our schema.
    pub fn open_or_create(dir: impl AsRef<Path>) -> Result<Self, String> {
        let dir = dir.as_ref();
        std::fs::create_dir_all(dir)
            .map_err(|e| format!("Failed to create index dir {dir:?}: {e}"))?;

        let (schema, fields) = build_schema();

        let mmap = tantivy::directory::MmapDirectory::open(dir)
            .map_err(|e| format!("Failed to open mmap directory: {e}"))?;
        let index = Index::open_or_create(mmap, schema)
            .map_err(|e| format!("Failed to open/create index: {e}"))?;

        Ok(Self { index, fields })
    }

    /// Create a transient in-RAM index. Used by tests and by callers that do not
    /// need persistence.
    pub fn create_in_ram() -> Self {
        let (schema, fields) = build_schema();
        let index = Index::create_in_ram(schema);
        Self { index, fields }
    }

    /// Acquire a writer with the standard heap budget.
    fn writer(&self) -> Result<IndexWriter, String> {
        self.index
            .writer(WRITER_HEAP_BYTES)
            .map_err(|e| format!("Failed to create index writer: {e}"))
    }

    /// Add a single document to `writer` from a [`FileInfo`].
    ///
    /// Caller is responsible for committing (batch many adds, then one commit).
    fn add_document(&self, writer: &IndexWriter, file: &FileInfo) -> Result<(), String> {
        let f = &self.fields;
        writer
            .add_document(doc!(
                f.path     => file.path.clone(),
                f.name     => file.name.clone(),
                f.ext      => file.extension.clone(),
                f.category => category_tag(file),
                f.size     => file.size,
                f.mtime    => file.modified,
            ))
            .map_err(|e| format!("Failed to add document '{}': {e}", file.path))?;
        Ok(())
    }

    /// Build (or rebuild) the index from a slice of [`FileInfo`].
    ///
    /// This is the cold-build path: it streams the same `Vec<FileInfo>` the
    /// scanner already produced into the writer and commits once. Existing
    /// documents for the same paths are replaced (delete-by-term then add) so the
    /// call is idempotent.
    pub fn build_from_files(&self, files: &[FileInfo]) -> Result<(), String> {
        let mut writer = self.writer()?;
        for file in files {
            let term = Term::from_field_text(self.fields.path, &file.path);
            writer.delete_term(term);
            self.add_document(&writer, file)?;
        }
        writer
            .commit()
            .map_err(|e| format!("Failed to commit index: {e}"))?;
        Ok(())
    }

    /// Upsert a single file (delete-by-path then add), committing immediately.
    ///
    /// Intended for the incremental watcher sink. Production code should batch
    /// these and commit on a debounce; this convenience method commits per call.
    pub fn upsert_file(&self, file: &FileInfo) -> Result<(), String> {
        let mut writer = self.writer()?;
        let term = Term::from_field_text(self.fields.path, &file.path);
        writer.delete_term(term);
        self.add_document(&writer, file)?;
        writer
            .commit()
            .map_err(|e| format!("Failed to commit upsert: {e}"))?;
        Ok(())
    }

    /// Remove a file from the index by path, committing immediately.
    pub fn remove_path(&self, path: &str) -> Result<(), String> {
        let mut writer = self.writer()?;
        let term = Term::from_field_text(self.fields.path, path);
        writer.delete_term(term);
        writer
            .commit()
            .map_err(|e| format!("Failed to commit removal: {e}"))?;
        Ok(())
    }

    /// Query the index and return up to `limit` hits ordered by BM25 score.
    ///
    /// This is the minimal skeleton: it parses `query_text` against the `name`
    /// field. The production version (phase 2, §2.7 of the blueprint) will add an
    /// edge-ngram prefix clause, operator filters (`ext`/`category`/`size`/`mtime`)
    /// and frecency-fast-field ordering. The signature is stable so wiring it into
    /// the command layer later is mechanical.
    pub fn query(&self, query_text: &str, limit: usize) -> Result<Vec<FileHit>, String> {
        if query_text.trim().is_empty() {
            return Ok(Vec::new());
        }

        let reader = self
            .index
            .reader()
            .map_err(|e| format!("Failed to create reader: {e}"))?;
        let searcher = reader.searcher();

        let parser = QueryParser::for_index(&self.index, vec![self.fields.name]);
        let query = parser
            .parse_query(query_text)
            .map_err(|e| format!("Failed to parse query '{query_text}': {e}"))?;

        let top = searcher
            .search(&query, &TopDocs::with_limit(limit).order_by_score())
            .map_err(|e| format!("Search failed: {e}"))?;

        let mut hits = Vec::with_capacity(top.len());
        for (score, addr) in top {
            let doc: TantivyDocument = searcher
                .doc(addr)
                .map_err(|e| format!("Failed to load doc: {e}"))?;
            let path = doc
                .get_first(self.fields.path)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            let name = doc
                .get_first(self.fields.name)
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string();
            hits.push(FileHit { path, name, score });
        }
        Ok(hits)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::indexer::types::FileCategory;

    fn make_file(name: &str, path: &str, ext: &str) -> FileInfo {
        FileInfo {
            id: crate::utils::hash_id(path),
            name: name.to_string(),
            path: path.to_string(),
            extension: ext.to_string(),
            size: 1234,
            modified: 1_700_000_000,
            created: None,
            accessed: None,
            icon: None,
            category: FileCategory::Document,
        }
    }

    #[test]
    fn schema_has_expected_fields() {
        let (schema, _fields) = build_schema();
        assert!(schema.get_field("path").is_ok());
        assert!(schema.get_field("name").is_ok());
        assert!(schema.get_field("ext").is_ok());
        assert!(schema.get_field("category").is_ok());
        assert!(schema.get_field("size").is_ok());
        assert!(schema.get_field("mtime").is_ok());
    }

    #[test]
    fn build_and_query_finds_document() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[
            make_file("firefox.exe", "C:/apps/firefox.exe", "exe"),
            make_file("report.pdf", "C:/docs/report.pdf", "pdf"),
        ])
        .unwrap();

        let hits = idx.query("firefox", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "firefox.exe");
        assert_eq!(hits[0].path, "C:/apps/firefox.exe");
    }

    #[test]
    fn empty_query_returns_no_hits() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[make_file("a.txt", "/tmp/a.txt", "txt")])
            .unwrap();
        assert!(idx.query("", 10).unwrap().is_empty());
        assert!(idx.query("   ", 10).unwrap().is_empty());
    }

    #[test]
    fn query_respects_limit() {
        let idx = FulltextIndex::create_in_ram();
        let files: Vec<FileInfo> = (0..20)
            .map(|i| {
                make_file(
                    &format!("note{i}.txt"),
                    &format!("/notes/note{i}.txt"),
                    "txt",
                )
            })
            .collect();
        idx.build_from_files(&files).unwrap();

        let hits = idx.query("note", 5).unwrap();
        assert!(hits.len() <= 5);
    }

    #[test]
    fn upsert_then_remove_round_trip() {
        let idx = FulltextIndex::create_in_ram();
        idx.upsert_file(&make_file("doc.md", "/x/doc.md", "md"))
            .unwrap();
        assert_eq!(idx.query("doc", 10).unwrap().len(), 1);

        // Re-upsert same path must not duplicate.
        idx.upsert_file(&make_file("doc.md", "/x/doc.md", "md"))
            .unwrap();
        assert_eq!(idx.query("doc", 10).unwrap().len(), 1);

        idx.remove_path("/x/doc.md").unwrap();
        assert!(idx.query("doc", 10).unwrap().is_empty());
    }

    #[test]
    fn open_or_create_persists_to_disk() {
        let dir = tempfile::tempdir().unwrap();
        {
            let idx = FulltextIndex::open_or_create(dir.path()).unwrap();
            idx.build_from_files(&[make_file("persist.txt", "/p/persist.txt", "txt")])
                .unwrap();
        }
        // Re-open the same directory; data must still be queryable.
        let idx2 = FulltextIndex::open_or_create(dir.path()).unwrap();
        let hits = idx2.query("persist", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "persist.txt");
    }
}
