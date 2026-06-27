//! AI profiles, quick actions, generated assets, and local embeddings.

pub mod custom_emojis;
pub mod embeddings;
pub mod profile;
pub mod proxy;
pub mod quick_actions;

pub use custom_emojis::*;
pub use embeddings::*;
pub use profile as ai_profile;
pub use profile::*;
pub use proxy::*;
pub use quick_actions as ai_quick_actions;
pub use quick_actions::*;
