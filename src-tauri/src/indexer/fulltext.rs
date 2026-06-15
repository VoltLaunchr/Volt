//! Full-text / relevance file index backed by [Tantivy](https://crates.io/crates/tantivy).
//!
//! **Track 1 of Pilier D** (see `REFONTE-PILIER-D-SEARCH.md`). This module is the
//! feature-flagged Tantivy backend that complements the existing in-memory
//! nucleo scan with a persistent inverted index.
//!
//! # Feature flag
//!
//! The entire module is gated behind the `tantivy-search` Cargo feature, which is
//! **OFF by default**. When the feature is off, this file is not compiled and the
//! existing [`crate::indexer::search_engine::SearchEngine`] (nucleo) remains the
//! one and only search path — behaviour is byte-for-byte unchanged.
//!
//! # Integration model
//!
//! The Tantivy index is *derived* from the same [`FileInfo`] stream the existing
//! scanner/SQLite pipeline already produces; SQLite remains the source of truth and
//! the index can always be rebuilt from it. Nothing here changes `FileInfo` or the
//! SQLite schema.

#![cfg(feature = "tantivy-search")]

use std::borrow::Cow;
use std::ops::Bound;
use std::path::Path;

use tantivy::collector::TopDocs;
use tantivy::query::{
    BooleanQuery, BoostQuery, FuzzyTermQuery, Occur, Query, RangeQuery, TermQuery,
};
use tantivy::schema::{
    FAST, Field, INDEXED, IndexRecordOption, STORED, STRING, Schema, TextFieldIndexing,
    TextOptions, Value,
};
use tantivy::tokenizer::{
    AsciiFoldingFilter, LowerCaser, RawTokenizer, SimpleTokenizer, TextAnalyzer,
};
use tantivy::{Index, IndexWriter, TantivyDocument, Term, doc};

use super::types::FileInfo;

/// Heap budget for the Tantivy `IndexWriter` arena, in bytes (50 MB).
const WRITER_HEAP_BYTES: usize = 50_000_000;
const FOLDED_TEXT_TOKENIZER: &str = "volt_folded_text";
const FOLDED_RAW_TOKENIZER: &str = "volt_folded_raw";
const RAW_EXT_TOKENIZER: &str = "volt_raw_ext";

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

/// File-search constraints applied inside Tantivy before top-k collection.
#[derive(Debug, Clone, Copy)]
pub(crate) struct FulltextQueryOptions<'a> {
    pub limit: usize,
    pub include_hidden: bool,
    pub ext_filter: Option<&'a str>,
    pub dir_filter: Option<&'a str>,
    pub size_min: Option<u64>,
    pub size_max: Option<u64>,
    pub modified_after: Option<i64>,
    pub modified_before: Option<i64>,
}

impl FulltextQueryOptions<'_> {
    fn has_invalid_range(&self) -> bool {
        self.size_min
            .zip(self.size_max)
            .is_some_and(|(min, max)| min > max)
            || self
                .modified_after
                .zip(self.modified_before)
                .is_some_and(|(after, before)| after > before)
    }
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
    /// Lowercase, untokenized name for exact and whole-filename prefix matches.
    name_exact: Field,
    /// Exact, untokenized — supports the `ext:` operator.
    ext: Field,
    /// Exact, untokenized — supports the `category` filter.
    category: Field,
    /// Fast field (u64) — file size in bytes, for `size:` filters / sorting.
    size: Field,
    /// Fast field (i64) — modification time (Unix secs), for recency sorting.
    mtime: Field,
    /// Indexed + fast bool used to exclude hidden files before top-k collection.
    hidden: Field,
}

/// Build the file-search schema.
///
/// See `REFONTE-PILIER-D-SEARCH.md` §2.3 for the rationale behind each field's
/// indexing options. `FAST` fields enable sort/filter without document loads.
fn build_schema() -> (Schema, Fields) {
    use tantivy::schema::SchemaBuilder;

    let mut sb: SchemaBuilder = Schema::builder();
    let path = sb.add_text_field("path", STRING | STORED);
    let name_indexing = TextFieldIndexing::default()
        .set_tokenizer(FOLDED_TEXT_TOKENIZER)
        .set_index_option(IndexRecordOption::WithFreqsAndPositions);
    let name = sb.add_text_field(
        "name",
        TextOptions::default()
            .set_indexing_options(name_indexing)
            .set_stored(),
    );
    let exact_indexing = TextFieldIndexing::default()
        .set_tokenizer(FOLDED_RAW_TOKENIZER)
        .set_index_option(IndexRecordOption::Basic);
    let name_exact = sb.add_text_field(
        "name_exact",
        TextOptions::default().set_indexing_options(exact_indexing),
    );
    let ext_indexing = TextFieldIndexing::default()
        .set_tokenizer(RAW_EXT_TOKENIZER)
        .set_index_option(IndexRecordOption::Basic);
    let ext = sb.add_text_field(
        "ext",
        TextOptions::default().set_indexing_options(ext_indexing),
    );
    let category = sb.add_text_field("category", STRING);
    let size = sb.add_u64_field("size", FAST);
    let mtime = sb.add_i64_field("mtime", FAST);
    let hidden = sb.add_bool_field("hidden", FAST | INDEXED);
    let schema = sb.build();

    (
        schema,
        Fields {
            path,
            name,
            name_exact,
            ext,
            category,
            size,
            mtime,
            hidden,
        },
    )
}

fn register_tokenizers(index: &Index) {
    let folded_text = TextAnalyzer::builder(SimpleTokenizer::default())
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .build();
    index
        .tokenizers()
        .register(FOLDED_TEXT_TOKENIZER, folded_text);

    let folded_raw = TextAnalyzer::builder(RawTokenizer::default())
        .filter(LowerCaser)
        .filter(AsciiFoldingFilter)
        .build();
    index
        .tokenizers()
        .register(FOLDED_RAW_TOKENIZER, folded_raw);

    index.tokenizers().register(
        RAW_EXT_TOKENIZER,
        TextAnalyzer::from(RawTokenizer::default()),
    );
}

fn is_hidden(file: &FileInfo) -> bool {
    file.name.starts_with('.')
}

fn fuzzy_distance(token: &str) -> Option<u8> {
    match token.chars().count() {
        0..=3 => None,
        4..=7 => Some(1),
        _ => Some(2),
    }
}

fn expand_dir_prefix(dir: &str) -> Cow<'_, str> {
    if let Some(rest) = dir.strip_prefix("~/")
        && let Some(home) = dirs::home_dir()
    {
        return Cow::Owned(home.join(rest).to_string_lossy().into_owned());
    }

    Cow::Borrowed(dir)
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
        let index = match Index::open_or_create(mmap, schema.clone()) {
            Ok(index) => index,
            Err(tantivy::TantivyError::SchemaError(_)) => {
                std::fs::remove_dir_all(dir)
                    .map_err(|e| format!("Failed to replace incompatible index: {e}"))?;
                std::fs::create_dir_all(dir)
                    .map_err(|e| format!("Failed to recreate index dir {dir:?}: {e}"))?;
                let mmap = tantivy::directory::MmapDirectory::open(dir)
                    .map_err(|e| format!("Failed to reopen mmap directory: {e}"))?;
                Index::open_or_create(mmap, schema)
                    .map_err(|e| format!("Failed to recreate index: {e}"))?
            }
            Err(e) => return Err(format!("Failed to open/create index: {e}")),
        };

        register_tokenizers(&index);
        Ok(Self { index, fields })
    }

    /// Create a transient in-RAM index. Used by tests and by callers that do not
    /// need persistence.
    pub fn create_in_ram() -> Self {
        let (schema, fields) = build_schema();
        let index = Index::create_in_ram(schema);
        register_tokenizers(&index);
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
                f.name_exact => file.name.clone(),
                f.ext      => file.extension.to_ascii_lowercase(),
                f.category => category_tag(file),
                f.size     => file.size,
                f.mtime    => file.modified,
                f.hidden   => is_hidden(file),
            ))
            .map_err(|e| format!("Failed to add document '{}': {e}", file.path))?;
        Ok(())
    }

    /// Build (or rebuild) the index from a slice of [`FileInfo`].
    ///
    /// This is the cold-build path: it clears the index, streams the same
    /// `Vec<FileInfo>` the scanner already produced into the writer and commits
    /// once. Rebuilds therefore remove stale documents as well as refreshing
    /// existing ones.
    pub fn build_from_files(&self, files: &[FileInfo]) -> Result<(), String> {
        let mut writer = self.writer()?;
        writer
            .delete_all_documents()
            .map_err(|e| format!("Failed to clear index: {e}"))?;
        for file in files {
            self.add_document(&writer, file)?;
        }
        writer
            .commit()
            .map_err(|e| format!("Failed to commit index: {e}"))?;
        Ok(())
    }

    /// Apply a batch of incremental changes from the watcher.
    ///
    /// Removals are applied first, then upserts. The batch is committed once so
    /// a watcher flush stays atomic from the searcher's perspective.
    pub fn apply_batch(&self, upserts: &[FileInfo], removals: &[String]) -> Result<(), String> {
        let mut writer = self.writer()?;

        for path in removals {
            writer.delete_term(Term::from_field_text(self.fields.path, path));
        }

        for file in upserts {
            let term = Term::from_field_text(self.fields.path, &file.path);
            writer.delete_term(term);
            self.add_document(&writer, file)?;
        }

        writer
            .commit()
            .map_err(|e| format!("Failed to commit batch update: {e}"))?;
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

    /// Return the number of live documents currently visible in the index.
    pub fn document_count(&self) -> Result<u64, String> {
        let reader = self
            .index
            .reader()
            .map_err(|e| format!("Failed to create reader: {e}"))?;
        Ok(reader.searcher().num_docs())
    }

    fn tokenized_terms(&self, query_text: &str) -> Result<Vec<String>, String> {
        let mut analyzer = self
            .index
            .tokenizer_for_field(self.fields.name)
            .map_err(|e| format!("Failed to load name tokenizer: {e}"))?;
        let mut terms = Vec::new();
        analyzer
            .token_stream(query_text)
            .process(&mut |token| terms.push(token.text.clone()));
        Ok(terms)
    }

    fn launcher_query(&self, query_text: &str) -> Result<Box<dyn Query>, String> {
        let normalized = self
            .tokenized_exact(query_text.trim())?
            .unwrap_or_else(|| query_text.trim().to_lowercase());
        let mut alternatives: Vec<(Occur, Box<dyn Query>)> = Vec::new();

        let exact_term = Term::from_field_text(self.fields.name_exact, &normalized);
        alternatives.push((
            Occur::Should,
            Box::new(BoostQuery::new(
                Box::new(TermQuery::new(exact_term.clone(), IndexRecordOption::Basic)),
                12.0,
            )),
        ));
        alternatives.push((
            Occur::Should,
            Box::new(BoostQuery::new(
                Box::new(FuzzyTermQuery::new_prefix(exact_term, 0, true)),
                6.0,
            )),
        ));

        let token_groups = self
            .tokenized_terms(&normalized)?
            .into_iter()
            .map(|token| {
                let term = Term::from_field_text(self.fields.name, &token);
                let mut token_alternatives: Vec<(Occur, Box<dyn Query>)> = vec![
                    (
                        Occur::Should,
                        Box::new(BoostQuery::new(
                            Box::new(TermQuery::new(term.clone(), IndexRecordOption::WithFreqs)),
                            3.0,
                        )),
                    ),
                    (
                        Occur::Should,
                        Box::new(BoostQuery::new(
                            Box::new(FuzzyTermQuery::new_prefix(term.clone(), 0, true)),
                            2.0,
                        )),
                    ),
                ];

                if let Some(distance) = fuzzy_distance(&token) {
                    token_alternatives.push((
                        Occur::Should,
                        Box::new(FuzzyTermQuery::new_prefix(term, distance, true)),
                    ));
                }

                Box::new(BooleanQuery::new(token_alternatives)) as Box<dyn Query>
            })
            .collect::<Vec<_>>();

        if !token_groups.is_empty() {
            alternatives.push((
                Occur::Should,
                Box::new(BooleanQuery::intersection(token_groups)),
            ));
        }

        Ok(Box::new(BooleanQuery::new(alternatives)))
    }

    fn tokenized_exact(&self, query_text: &str) -> Result<Option<String>, String> {
        let mut analyzer = self
            .index
            .tokenizer_for_field(self.fields.name_exact)
            .map_err(|e| format!("Failed to load exact-name tokenizer: {e}"))?;
        let mut normalized = None;
        analyzer
            .token_stream(query_text)
            .process(&mut |token| normalized = Some(token.text.clone()));
        Ok(normalized)
    }

    fn filtered_launcher_query(
        &self,
        query_text: &str,
        options: &FulltextQueryOptions<'_>,
    ) -> Result<Box<dyn Query>, String> {
        let mut clauses: Vec<(Occur, Box<dyn Query>)> =
            vec![(Occur::Must, self.launcher_query(query_text)?)];

        if !options.include_hidden {
            clauses.push((
                Occur::MustNot,
                Box::new(TermQuery::new(
                    Term::from_field_bool(self.fields.hidden, true),
                    IndexRecordOption::Basic,
                )),
            ));
        }

        if let Some(ext) = options.ext_filter {
            clauses.push((
                Occur::Must,
                Box::new(TermQuery::new(
                    Term::from_field_text(self.fields.ext, &ext.to_ascii_lowercase()),
                    IndexRecordOption::Basic,
                )),
            ));
        }

        if let Some(dir) = options.dir_filter {
            let expanded = expand_dir_prefix(dir);
            if !expanded.is_empty() {
                clauses.push((
                    Occur::Must,
                    Box::new(FuzzyTermQuery::new_prefix(
                        Term::from_field_text(self.fields.path, expanded.as_ref()),
                        0,
                        true,
                    )),
                ));
            }
        }

        if options.size_min.is_some() || options.size_max.is_some() {
            clauses.push((
                Occur::Must,
                Box::new(RangeQuery::new(
                    options
                        .size_min
                        .map(|value| Bound::Included(Term::from_field_u64(self.fields.size, value)))
                        .unwrap_or(Bound::Unbounded),
                    options
                        .size_max
                        .map(|value| Bound::Included(Term::from_field_u64(self.fields.size, value)))
                        .unwrap_or(Bound::Unbounded),
                )),
            ));
        }

        if options.modified_after.is_some() || options.modified_before.is_some() {
            clauses.push((
                Occur::Must,
                Box::new(RangeQuery::new(
                    options
                        .modified_after
                        .map(|value| {
                            Bound::Included(Term::from_field_i64(self.fields.mtime, value))
                        })
                        .unwrap_or(Bound::Unbounded),
                    options
                        .modified_before
                        .map(|value| {
                            Bound::Included(Term::from_field_i64(self.fields.mtime, value))
                        })
                        .unwrap_or(Bound::Unbounded),
                )),
            ));
        }

        Ok(Box::new(BooleanQuery::new(clauses)))
    }

    /// Query the index and return up to `limit` hits ordered by relevance.
    ///
    /// Exact filename and prefix clauses are combined with BM25 token clauses and
    /// lower-weight fuzzy prefixes. Dot-prefixed files are excluded inside the
    /// Tantivy query so collection still respects the requested top-k limit.
    pub fn query(
        &self,
        query_text: &str,
        limit: usize,
        include_hidden: bool,
    ) -> Result<Vec<FileHit>, String> {
        self.query_filtered(
            query_text,
            &FulltextQueryOptions {
                limit,
                include_hidden,
                ext_filter: None,
                dir_filter: None,
                size_min: None,
                size_max: None,
                modified_after: None,
                modified_before: None,
            },
        )
    }

    /// Query with file metadata constraints enforced before top-k collection.
    pub(crate) fn query_filtered(
        &self,
        query_text: &str,
        options: &FulltextQueryOptions<'_>,
    ) -> Result<Vec<FileHit>, String> {
        if query_text.trim().is_empty() || options.limit == 0 || options.has_invalid_range() {
            return Ok(Vec::new());
        }

        let reader = self
            .index
            .reader()
            .map_err(|e| format!("Failed to create reader: {e}"))?;
        let searcher = reader.searcher();

        let query = self.filtered_launcher_query(query_text, options)?;

        let top = searcher
            .search(
                query.as_ref(),
                &TopDocs::with_limit(options.limit).order_by_score(),
            )
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

    fn query_options(limit: usize) -> FulltextQueryOptions<'static> {
        FulltextQueryOptions {
            limit,
            include_hidden: false,
            ext_filter: None,
            dir_filter: None,
            size_min: None,
            size_max: None,
            modified_after: None,
            modified_before: None,
        }
    }

    #[test]
    fn schema_has_expected_fields() {
        let (schema, _fields) = build_schema();
        assert!(schema.get_field("path").is_ok());
        assert!(schema.get_field("name").is_ok());
        assert!(schema.get_field("name_exact").is_ok());
        assert!(schema.get_field("ext").is_ok());
        assert!(schema.get_field("category").is_ok());
        assert!(schema.get_field("size").is_ok());
        assert!(schema.get_field("mtime").is_ok());
        assert!(schema.get_field("hidden").is_ok());
    }

    #[test]
    fn build_and_query_finds_document() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[
            make_file("firefox.exe", "C:/apps/firefox.exe", "exe"),
            make_file("report.pdf", "C:/docs/report.pdf", "pdf"),
        ])
        .unwrap();

        let hits = idx.query("firefox", 10, false).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "firefox.exe");
        assert_eq!(hits[0].path, "C:/apps/firefox.exe");
    }

    #[test]
    fn prefix_query_matches_while_typing() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[
            make_file("firefox.exe", "C:/apps/firefox.exe", "exe"),
            make_file("report.pdf", "C:/docs/report.pdf", "pdf"),
        ])
        .unwrap();

        let hits = idx.query("fir", 10, false).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "firefox.exe");
    }

    #[test]
    fn fuzzy_query_handles_transposition() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[make_file("firefox.exe", "C:/apps/firefox.exe", "exe")])
            .unwrap();

        let hits = idx.query("friefox", 10, false).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "firefox.exe");
    }

    #[test]
    fn unaccented_query_matches_accented_filename() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[
            make_file(
                "R\u{e9}sum\u{e9} de r\u{e9}union.pdf",
                "/docs/resume-accentue.pdf",
                "pdf",
            ),
            make_file("Resume de reunion.pdf", "/docs/plain-resume.pdf", "pdf"),
        ])
        .unwrap();

        let hits = idx.query("resume reunion", 10, false).unwrap();
        assert_eq!(hits.len(), 2);
    }

    #[test]
    fn accented_query_matches_unaccented_filename() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[make_file(
            "Cafe Montreal.txt",
            "/docs/Cafe Montreal.txt",
            "txt",
        )])
        .unwrap();

        let hits = idx.query("caf\u{e9} montr\u{e9}al", 10, false).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "Cafe Montreal.txt");
    }

    #[test]
    fn exact_filename_ranks_before_partial_matches() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[
            make_file("firefox.exe", "C:/apps/firefox.exe", "exe"),
            make_file(
                "firefox-portable.exe",
                "C:/apps/firefox-portable.exe",
                "exe",
            ),
        ])
        .unwrap();

        let hits = idx.query("firefox.exe", 10, false).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].name, "firefox.exe");
    }

    #[test]
    fn special_characters_are_queried_literally() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[
            make_file("C++ Guide (2026).pdf", "/docs/cpp-guide.pdf", "pdf"),
            make_file("C Guide.pdf", "/docs/c-guide.pdf", "pdf"),
        ])
        .unwrap();

        let hits = idx.query("C++ Guide (2026).pdf", 10, false).unwrap();
        assert!(!hits.is_empty());
        assert_eq!(hits[0].name, "C++ Guide (2026).pdf");
    }

    #[test]
    fn empty_query_returns_no_hits() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[make_file("a.txt", "/tmp/a.txt", "txt")])
            .unwrap();
        assert!(idx.query("", 10, false).unwrap().is_empty());
        assert!(idx.query("   ", 10, false).unwrap().is_empty());
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

        let hits = idx.query("note", 5, false).unwrap();
        assert_eq!(hits.len(), 5);
    }

    #[test]
    fn hidden_files_are_filtered_inside_tantivy() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[
            make_file("settings.json", "/config/settings.json", "json"),
            make_file(".settings.json", "/config/.settings.json", "json"),
        ])
        .unwrap();

        let visible = idx.query(".settings.json", 1, false).unwrap();
        assert_eq!(visible.len(), 1);
        assert_eq!(visible[0].name, "settings.json");

        let all = idx.query("settings", 10, true).unwrap();
        assert_eq!(all.len(), 2);
    }

    #[test]
    fn extension_filter_is_ascii_case_insensitive() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[
            make_file("report-final.pdf", "/docs/report-final.pdf", "PDF"),
            make_file("report-draft.txt", "/docs/report-draft.txt", "txt"),
        ])
        .unwrap();

        let mut options = query_options(10);
        options.ext_filter = Some("pDf");
        let hits = idx.query_filtered("report", &options).unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "report-final.pdf");
    }

    #[test]
    fn directory_filter_expands_home_and_matches_path_prefix() {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let idx = FulltextIndex::create_in_ram();
        let home_report = home.join("Documents/report-home.pdf");
        idx.build_from_files(&[
            make_file("report-home.pdf", &home_report.to_string_lossy(), "pdf"),
            make_file("report-other.pdf", "/other/report-other.pdf", "pdf"),
        ])
        .unwrap();

        let mut options = query_options(10);
        options.dir_filter = Some("~/Documents");
        let hits = idx.query_filtered("report", &options).unwrap();

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "report-home.pdf");
    }

    #[test]
    fn size_and_modified_bounds_are_inclusive() {
        let idx = FulltextIndex::create_in_ram();
        let mut lower = make_file("report-lower.pdf", "/docs/report-lower.pdf", "pdf");
        lower.size = 100;
        lower.modified = 1_000;
        let mut upper = make_file("report-upper.pdf", "/docs/report-upper.pdf", "pdf");
        upper.size = 200;
        upper.modified = 2_000;
        let mut too_small = make_file("report-small.pdf", "/docs/report-small.pdf", "pdf");
        too_small.size = 99;
        too_small.modified = 1_500;
        let mut too_new = make_file("report-new.pdf", "/docs/report-new.pdf", "pdf");
        too_new.size = 150;
        too_new.modified = 2_001;
        idx.build_from_files(&[lower, upper, too_small, too_new])
            .unwrap();

        let mut options = query_options(10);
        options.size_min = Some(100);
        options.size_max = Some(200);
        options.modified_after = Some(1_000);
        options.modified_before = Some(2_000);
        let hits = idx.query_filtered("report", &options).unwrap();
        let names = hits.into_iter().map(|hit| hit.name).collect::<Vec<_>>();

        assert_eq!(names.len(), 2);
        assert!(names.contains(&"report-lower.pdf".to_string()));
        assert!(names.contains(&"report-upper.pdf".to_string()));
    }

    #[test]
    fn inverted_filter_bounds_return_no_hits_without_error() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[make_file("report.pdf", "/docs/report.pdf", "pdf")])
            .unwrap();

        let mut options = query_options(10);
        options.size_min = Some(200);
        options.size_max = Some(100);

        assert!(idx.query_filtered("report", &options).unwrap().is_empty());
    }

    #[test]
    fn document_count_tracks_live_documents() {
        let idx = FulltextIndex::create_in_ram();
        assert_eq!(idx.document_count().unwrap(), 0);

        idx.build_from_files(&[
            make_file("alpha.txt", "/x/alpha.txt", "txt"),
            make_file("beta.txt", "/x/beta.txt", "txt"),
        ])
        .unwrap();
        assert_eq!(idx.document_count().unwrap(), 2);

        idx.remove_path("/x/beta.txt").unwrap();
        assert_eq!(idx.document_count().unwrap(), 1);
    }

    #[test]
    fn upsert_then_remove_round_trip() {
        let idx = FulltextIndex::create_in_ram();
        idx.upsert_file(&make_file("doc.md", "/x/doc.md", "md"))
            .unwrap();
        assert_eq!(idx.query("doc", 10, false).unwrap().len(), 1);

        // Re-upsert same path must not duplicate.
        idx.upsert_file(&make_file("doc.md", "/x/doc.md", "md"))
            .unwrap();
        assert_eq!(idx.query("doc", 10, false).unwrap().len(), 1);

        idx.remove_path("/x/doc.md").unwrap();
        assert!(idx.query("doc", 10, false).unwrap().is_empty());
    }

    #[test]
    fn rebuild_from_files_clears_stale_documents() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[
            make_file("alpha.txt", "/x/alpha.txt", "txt"),
            make_file("beta.txt", "/x/beta.txt", "txt"),
        ])
        .unwrap();
        idx.build_from_files(&[make_file("alpha.txt", "/x/alpha.txt", "txt")])
            .unwrap();

        assert_eq!(idx.query("beta", 10, false).unwrap().len(), 0);
        assert_eq!(idx.query("alpha", 10, false).unwrap().len(), 1);
    }

    #[test]
    fn apply_batch_updates_in_place() {
        let idx = FulltextIndex::create_in_ram();
        idx.build_from_files(&[
            make_file("alpha.txt", "/x/alpha.txt", "txt"),
            make_file("beta.txt", "/x/beta.txt", "txt"),
        ])
        .unwrap();

        idx.apply_batch(
            &[make_file("gamma.txt", "/x/gamma.txt", "txt")],
            &[String::from("/x/beta.txt")],
        )
        .unwrap();

        assert_eq!(idx.query("beta", 10, false).unwrap().len(), 0);
        assert_eq!(idx.query("gamma", 10, false).unwrap().len(), 1);
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
        let hits = idx2.query("persist", 10, false).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "persist.txt");
    }

    #[test]
    fn open_or_create_replaces_an_incompatible_derived_index() {
        let dir = tempfile::tempdir().unwrap();
        let mut legacy_schema = Schema::builder();
        legacy_schema.add_text_field("path", STRING | STORED);
        legacy_schema.add_text_field("name", tantivy::schema::TEXT | STORED);
        let legacy_index = Index::open_or_create(
            tantivy::directory::MmapDirectory::open(dir.path()).unwrap(),
            legacy_schema.build(),
        )
        .unwrap();
        drop(legacy_index);

        let idx = FulltextIndex::open_or_create(dir.path()).unwrap();
        assert_eq!(idx.document_count().unwrap(), 0);
        assert!(idx.index.schema().get_field("hidden").is_ok());
    }
}
