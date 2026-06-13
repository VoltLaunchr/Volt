# Tauri command layout

`commands` is the IPC boundary between the React frontend and the Rust backend.
Commands are grouped by product domain so related state, handlers, and tests are
discoverable together:

| Domain | Responsibility |
| --- | --- |
| `ai` | AI profile, quick actions, generated emojis, local embeddings |
| `auth` | Session, OAuth, credentials, keyring, account sync |
| `content` | Notes, quicklinks, snippets |
| `extensions` | External extensions and built-in plugin administration |
| `files` | File index, watcher, history, preview |
| `launcher` | App discovery, launch history, games, search, Steam |
| `shell` | Command execution and shell history |
| `system` | Autostart, clipboard, logs, settings, metrics, window management |

## Compatibility

`commands/mod.rs` re-exports the previous flat module names. Existing paths such
as `commands::files::FileIndexState`, `commands::notes::NoteState`, and
`commands::ai_profile::ai_profile_get` remain valid. The frontend IPC contract is
also unchanged because Tauri exposes the command function name, not its Rust
module path.

## Adding a command

1. Put the handler in the domain that owns the behavior.
2. Keep the handler thin; move reusable or complex logic into the corresponding
   backend domain (`indexer`, `launcher`, `plugins`, and so on).
3. Return `VoltResult<T>` and use serializable boundary types with camel-case
   serde names where required.
4. Register the function in `tauri::generate_handler!` in `src/lib.rs`.
5. Add focused unit tests beside the implementation and verify the relevant
   frontend `invoke()` call.

Do not create a new top-level `.rs` file under `commands`. Add it to an existing
domain or introduce a clearly owned domain directory.
