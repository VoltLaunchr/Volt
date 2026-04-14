/// Fast, non-cryptographic hash for generating stable IDs from strings.
///
/// Uses `std::hash::DefaultHasher` (SipHash-1-3) which is fast and has good
/// collision resistance for ID generation. This replaces MD5 which was
/// unnecessarily slow (cryptographic) for a non-security use case.
use std::hash::{DefaultHasher, Hash, Hasher};

/// Generate a hex-encoded hash ID from a string (e.g., a file path).
///
/// Returns a 16-character hex string (64-bit hash).
pub fn hash_id(input: &str) -> String {
    let mut hasher = DefaultHasher::new();
    input.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hash_id_deterministic() {
        let id1 = hash_id("C:\\Program Files\\App\\app.exe");
        let id2 = hash_id("C:\\Program Files\\App\\app.exe");
        assert_eq!(id1, id2);
    }

    #[test]
    fn test_hash_id_different_inputs() {
        let id1 = hash_id("path_a");
        let id2 = hash_id("path_b");
        assert_ne!(id1, id2);
    }

    #[test]
    fn test_hash_id_length() {
        let id = hash_id("test");
        assert_eq!(id.len(), 16);
    }
}
