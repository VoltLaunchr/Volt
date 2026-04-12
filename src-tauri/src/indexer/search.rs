use super::types::FileInfo;

/// Searches files based on a query string using simple fuzzy matching
///
/// Note: For advanced fuzzy matching with better results, use the search_engine module.
/// This function is kept for backwards compatibility.
pub fn search_files(query: &str, files: &[FileInfo]) -> Vec<FileInfo> {
    // Delegate to the advanced search engine
    super::search_engine::search_files_advanced(query, files, None)
}
