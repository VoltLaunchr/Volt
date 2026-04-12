use std::fmt;

/// Main application error type
///
/// Serializes as `{ "kind": "<variant>", "message": "<msg>" }` so the TS frontend
/// can discriminate error types without parsing opaque strings.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", content = "message", rename_all = "camelCase")]
pub enum VoltError {
    /// File system error
    FileSystem(String),

    /// Application not found
    NotFound(String),

    /// Permission denied
    PermissionDenied(String),

    /// Invalid configuration
    InvalidConfig(String),

    /// Plugin error
    Plugin(String),

    /// Search error
    Search(String),

    /// Launch error
    Launch(String),

    /// Serialization error
    Serialization(String),

    /// Unknown error
    Unknown(String),
}

impl fmt::Display for VoltError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FileSystem(msg) => write!(f, "File system error: {}", msg),
            Self::NotFound(msg) => write!(f, "Not found: {}", msg),
            Self::PermissionDenied(msg) => write!(f, "Permission denied: {}", msg),
            Self::InvalidConfig(msg) => write!(f, "Invalid configuration: {}", msg),
            Self::Plugin(msg) => write!(f, "Plugin error: {}", msg),
            Self::Search(msg) => write!(f, "Search error: {}", msg),
            Self::Launch(msg) => write!(f, "Launch error: {}", msg),
            Self::Serialization(msg) => write!(f, "Serialization error: {}", msg),
            Self::Unknown(msg) => write!(f, "Unknown error: {}", msg),
        }
    }
}

impl std::error::Error for VoltError {}

/// Result type alias for Volt operations
pub type VoltResult<T> = Result<T, VoltError>;

/// Convert VoltError to String (legacy compatibility for code paths still using `Result<T, String>`)
impl From<VoltError> for String {
    fn from(error: VoltError) -> Self {
        error.to_string()
    }
}

/// Convert a bare `String` error into a `VoltError::Unknown`. This makes `?`
/// work on internal `Result<_, String>` APIs during the gradual migration.
impl From<String> for VoltError {
    fn from(msg: String) -> Self {
        VoltError::Unknown(msg)
    }
}

impl From<&str> for VoltError {
    fn from(msg: &str) -> Self {
        VoltError::Unknown(msg.to_string())
    }
}

impl From<std::io::Error> for VoltError {
    fn from(err: std::io::Error) -> Self {
        use std::io::ErrorKind;
        match err.kind() {
            ErrorKind::NotFound => VoltError::NotFound(err.to_string()),
            ErrorKind::PermissionDenied => VoltError::PermissionDenied(err.to_string()),
            _ => VoltError::FileSystem(err.to_string()),
        }
    }
}

impl From<serde_json::Error> for VoltError {
    fn from(err: serde_json::Error) -> Self {
        VoltError::Serialization(err.to_string())
    }
}

impl From<tauri::Error> for VoltError {
    fn from(err: tauri::Error) -> Self {
        VoltError::Unknown(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_volt_error_display() {
        let error = VoltError::FileSystem("test error".to_string());
        assert_eq!(error.to_string(), "File system error: test error");

        let error = VoltError::NotFound("resource".to_string());
        assert_eq!(error.to_string(), "Not found: resource");
    }

    #[test]
    fn test_string_conversion() {
        let error = VoltError::Plugin("test".to_string());
        let s: String = error.into();
        assert!(s.contains("Plugin error"));
    }

    #[test]
    fn test_serialize_not_found() {
        let err = VoltError::NotFound("app.exe".to_string());
        let json = serde_json::to_string(&err).expect("serializes");
        assert_eq!(json, r#"{"kind":"notFound","message":"app.exe"}"#);
    }

    #[test]
    fn test_serialize_all_variants_camel_case() {
        let cases = [
            (VoltError::FileSystem("a".into()), "fileSystem"),
            (VoltError::NotFound("a".into()), "notFound"),
            (VoltError::PermissionDenied("a".into()), "permissionDenied"),
            (VoltError::InvalidConfig("a".into()), "invalidConfig"),
            (VoltError::Plugin("a".into()), "plugin"),
            (VoltError::Search("a".into()), "search"),
            (VoltError::Launch("a".into()), "launch"),
            (VoltError::Serialization("a".into()), "serialization"),
            (VoltError::Unknown("a".into()), "unknown"),
        ];
        for (err, expected_kind) in cases {
            let v: serde_json::Value = serde_json::to_value(&err).unwrap();
            assert_eq!(v["kind"], expected_kind);
            assert_eq!(v["message"], "a");
        }
    }

    #[test]
    fn test_from_io_error() {
        let io_err = std::io::Error::new(std::io::ErrorKind::NotFound, "missing");
        let volt: VoltError = io_err.into();
        assert!(matches!(volt, VoltError::NotFound(_)));

        let io_err = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "nope");
        let volt: VoltError = io_err.into();
        assert!(matches!(volt, VoltError::PermissionDenied(_)));

        let io_err = std::io::Error::other("something");
        let volt: VoltError = io_err.into();
        assert!(matches!(volt, VoltError::FileSystem(_)));
    }

    #[test]
    fn test_from_serde_json_error() {
        let parse_err = serde_json::from_str::<serde_json::Value>("{bad").unwrap_err();
        let volt: VoltError = parse_err.into();
        assert!(matches!(volt, VoltError::Serialization(_)));
    }
}
