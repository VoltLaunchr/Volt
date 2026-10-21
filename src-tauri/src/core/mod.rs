pub mod constants;
/// Encrypted-at-rest SQLite support (Pilier C). Feature-aware DB open helper +
/// keyring-backed key provisioning. No-op over plain SQLite unless the
/// `sqlcipher` Cargo feature is enabled. See `REFONTE-PILIER-C-SQLCIPHER.md`.
pub mod encrypted_db;
pub mod error;
pub mod service_config;
/// Core module - Shared traits, constants, and error types
///
/// This module contains fundamental traits and definitions used across the application.
/// It serves as the foundation for other modules.
pub mod traits;
