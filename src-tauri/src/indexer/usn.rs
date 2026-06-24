//! Unprivileged NTFS USN change-journal reader — the **no-admin** live-delta feed.
//!
//! **Pilier D, Track 2.** See `REFONTE-PILIER-D-SEARCH.md` §3 and the privilege
//! map in [`crate::indexer::mft`].
//!
//! # Why this exists (and why it needs no Administrator)
//!
//! Reading the raw `$MFT` (`CreateFile(\\.\C:, GENERIC_READ)`) requires elevation.
//! Reading the **USN change journal** does **not**: Windows exposes
//! `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL`, which a standard user can issue on a
//! volume handle opened with the minimal `FILE_TRAVERSE` access right (not
//! `GENERIC_READ`). This is the documented, supported way for non-admin tools to
//! consume the change journal — a launcher must never demand UAC just to search.
//!
//! The journal is a **delta feed**: it reports *changes since the journal was
//! created*, never a full file listing. It therefore complements — never
//! replaces — the no-admin baseline enumeration (Windows Search Index +
//! `scan_files` walk). On a delta it emits the *same* upsert/remove batches the
//! `notify` watcher emits today, so the SQLite + Tantivy + in-memory pipeline is
//! fed identically.
//!
//! # Scope of this module (first reviewed cut)
//!
//! - Open volume (`FILE_TRAVERSE`) + `FSCTL_QUERY_USN_JOURNAL` → journal id + cursor.
//! - Loop `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL`, advancing the resume cursor.
//! - A **pure, portable, unit-tested** `USN_RECORD_V2/V3` parser ([`parse_usn_buffer`]).
//! - Reason→change classification ([`UsnRecord::change`]) mirroring the watcher.
//! - Typed errors so the caller can fall back (no journal) or rebuild (journal wrap).
//! - [`UsnJournal::resolve_path`]: `OpenFileById` + `GetFinalPathNameByHandleW`.
//!
//! # Empirical finding (validated unelevated on a real NTFS volume)
//!
//! **The unprivileged read returns records WITHOUT inline filenames.** Every
//! record comes back as a 64-byte header (`RecordLength = 64`, `FileNameLength = 0`)
//! carrying FRN, parent-FRN, USN, reason, attributes and timestamp — but no name,
//! not even for files the caller owns. (Verified by draining 300k+ records and a
//! marker file we created ourselves: all nameless. This is a security property of
//! the unprivileged variant, not a parser bug — the raw bytes confirm it.)
//!
//! So the name/path is resolved **separately** via [`UsnJournal::resolve_path`]
//! (`OpenFileById(FRN)` → `GetFinalPathNameByHandleW`), which **needs no elevation**
//! and returned full paths for ~73% of changed FRNs in testing (the rest are
//! inaccessible system files or already-deleted ids → correctly skipped). This
//! also solves path reconstruction outright: it yields the *full path*, not just
//! the name. The pipeline is therefore:
//!
//! - **upsert** (create/modify/rename-new) → `resolve_path(frn)` → full path → index.
//! - **delete / rename-old** → the FRN no longer resolves; match it against an
//!   `FRN → path` map seeded from the baseline enumeration to know what to remove.
//!
//! **Still out of scope here** (next change, gated on the enumeration-bench GO):
//! the `FRN → path` map for deletes, and wiring a reader thread into the index
//! lifecycle (`db.upsert_file` / `db.remove_file` / `fulltext.apply_batch`).

// ---------------------------------------------------------------------------
// USN_REASON_* flags (winioctl.h) — only the subset we classify on.
// ---------------------------------------------------------------------------

/// File data was overwritten.
pub const USN_REASON_DATA_OVERWRITE: u32 = 0x0000_0001;
/// File data was appended.
pub const USN_REASON_DATA_EXTEND: u32 = 0x0000_0002;
/// File data was truncated.
pub const USN_REASON_DATA_TRUNCATION: u32 = 0x0000_0004;
/// The file or directory was created.
pub const USN_REASON_FILE_CREATE: u32 = 0x0000_0100;
/// The file or directory was deleted.
pub const USN_REASON_FILE_DELETE: u32 = 0x0000_0200;
/// The file's previous name (the *old* side of a rename/move).
pub const USN_REASON_RENAME_OLD_NAME: u32 = 0x0000_1000;
/// The file's new name (the *new* side of a rename/move).
pub const USN_REASON_RENAME_NEW_NAME: u32 = 0x0000_2000;
/// Basic attributes (timestamps, attributes) changed.
pub const USN_REASON_BASIC_INFO_CHANGE: u32 = 0x0000_8000;
/// The file handle was closed (the record is a final, coalesced summary).
pub const USN_REASON_CLOSE: u32 = 0x8000_0000;

/// `FILE_ATTRIBUTE_DIRECTORY` — the record describes a directory, not a file.
const FILE_ATTRIBUTE_DIRECTORY: u32 = 0x0000_0010;

// ---------------------------------------------------------------------------
// Public data model (portable, no Windows types)
// ---------------------------------------------------------------------------

/// What a change-journal record means for the file index.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RecordChange {
    /// File created, modified, or arrived under a new name → upsert into the index.
    Upsert,
    /// File deleted, or departed under its old name → remove from the index.
    Remove,
    /// Metadata-only churn we do not index on (security/EA/compression/etc.).
    Ignore,
}

/// One parsed USN change-journal record (version-agnostic view).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UsnRecord {
    /// Update Sequence Number of this record.
    pub usn: i64,
    /// File reference number (64-bit widened to 128 for V3 parity).
    pub frn: u128,
    /// Parent directory's file reference number — the anchor for path resolution.
    pub parent_frn: u128,
    /// Bitmask of `USN_REASON_*` flags coalesced for this record.
    pub reason: u32,
    /// `FILE_ATTRIBUTE_*` bitmask captured at record time.
    pub attributes: u32,
    /// The file/directory name (NOT the full path — see module docs).
    pub file_name: String,
}

impl UsnRecord {
    /// Whether this record describes a directory.
    #[must_use]
    pub fn is_directory(&self) -> bool {
        self.attributes & FILE_ATTRIBUTE_DIRECTORY != 0
    }

    /// Map the coalesced `reason` mask to an index action, mirroring the
    /// `notify` watcher's create/modify→upsert, delete→remove, rename→both.
    ///
    /// A create-then-delete that coalesced into a single record (the file
    /// existed only transiently) is intentionally [`RecordChange::Ignore`]d:
    /// there is nothing to add and nothing was ever in the index to remove.
    #[must_use]
    pub fn change(&self) -> RecordChange {
        let r = self.reason;

        // Transient file that was created and removed before the handle closed.
        if r & USN_REASON_FILE_CREATE != 0 && r & USN_REASON_FILE_DELETE != 0 {
            return RecordChange::Ignore;
        }

        // Departures: a delete, or the *old* name of a rename/move.
        if r & (USN_REASON_FILE_DELETE | USN_REASON_RENAME_OLD_NAME) != 0 {
            return RecordChange::Remove;
        }

        // Arrivals / content changes: create, the *new* name of a rename, data
        // writes, attribute changes, or the coalescing close record.
        const UPSERT_MASK: u32 = USN_REASON_FILE_CREATE
            | USN_REASON_RENAME_NEW_NAME
            | USN_REASON_DATA_OVERWRITE
            | USN_REASON_DATA_EXTEND
            | USN_REASON_DATA_TRUNCATION
            | USN_REASON_BASIC_INFO_CHANGE
            | USN_REASON_CLOSE;
        if r & UPSERT_MASK != 0 {
            return RecordChange::Upsert;
        }

        RecordChange::Ignore
    }
}

/// Resume point for the journal — persist this to avoid a full re-crawl.
///
/// A change in `journal_id` between runs means the journal was deleted and
/// recreated (or wrapped past our cursor): the delta stream is no longer
/// continuous and the caller must rebuild the baseline rather than resume.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct UsnCursor {
    /// Identifies a specific journal instance on the volume.
    pub journal_id: u64,
    /// The next USN to read from (feed back as `start_usn`).
    pub next_usn: i64,
}

/// Errors from the USN reader, shaped so the caller can decide fall-back vs rebuild.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UsnError {
    /// The volume could not be opened (`CreateFileW` failed). Carries the Win32 code.
    OpenVolume(u32),
    /// No active change journal on this volume → fall back to the `notify` watcher.
    /// We never auto-create the journal: creation needs administrator rights.
    JournalNotActive,
    /// Our cursor fell off the journal's tail (entries were purged) → rebuild baseline.
    JournalEntryDeleted,
    /// A `DeviceIoControl` call failed with the carried Win32 error code.
    DeviceIo(u32),
    /// The FSCTL returned fewer bytes than a valid header/record requires.
    MalformedBuffer,
    /// Compiled with `usn-incremental` but the platform is not Windows.
    Unsupported,
}

impl std::fmt::Display for UsnError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::OpenVolume(c) => write!(f, "failed to open volume handle (win32 {c})"),
            Self::JournalNotActive => write!(f, "USN change journal is not active on this volume"),
            Self::JournalEntryDeleted => write!(f, "USN cursor purged; baseline rebuild required"),
            Self::DeviceIo(c) => write!(f, "DeviceIoControl failed (win32 {c})"),
            Self::MalformedBuffer => write!(f, "USN buffer too short / malformed"),
            Self::Unsupported => write!(f, "USN reader is Windows-only"),
        }
    }
}

impl std::error::Error for UsnError {}

// ---------------------------------------------------------------------------
// Pure parser — portable, no Windows API, fully unit-tested.
// ---------------------------------------------------------------------------

/// Major-version field offset is identical across V2/V3 (`+4`).
const VERSION_OFFSET: usize = 4;

#[inline]
fn rd_u16(buf: &[u8], off: usize) -> Option<u16> {
    buf.get(off..off + 2)?.try_into().ok().map(u16::from_le_bytes)
}
#[inline]
fn rd_u32(buf: &[u8], off: usize) -> Option<u32> {
    buf.get(off..off + 4)?.try_into().ok().map(u32::from_le_bytes)
}
#[inline]
fn rd_u64(buf: &[u8], off: usize) -> Option<u64> {
    buf.get(off..off + 8)?.try_into().ok().map(u64::from_le_bytes)
}
#[inline]
fn rd_i64(buf: &[u8], off: usize) -> Option<i64> {
    buf.get(off..off + 8)?.try_into().ok().map(i64::from_le_bytes)
}
#[inline]
fn rd_u128(buf: &[u8], off: usize) -> Option<u128> {
    buf.get(off..off + 16)?
        .try_into()
        .ok()
        .map(u128::from_le_bytes)
}

/// Parse one fixed-layout record (already sliced to `[record_start .. record_start+len]`).
///
/// Returns `None` if the record is truncated or its filename bounds are invalid;
/// the caller skips it (defensive — the FS should never emit such records).
fn parse_one_record(rec: &[u8]) -> Option<UsnRecord> {
    let major = rd_u16(rec, VERSION_OFFSET)?;

    // Field offsets differ between V2 (64-bit FRNs) and V3 (128-bit FRNs).
    let (frn, parent_frn, usn, reason, attributes, name_len_off, name_off_off) = match major {
        2 => (
            u128::from(rd_u64(rec, 8)?),  // FileReferenceNumber
            u128::from(rd_u64(rec, 16)?), // ParentFileReferenceNumber
            rd_i64(rec, 24)?,             // Usn
            rd_u32(rec, 40)?,             // Reason
            rd_u32(rec, 52)?,             // FileAttributes
            56usize,                      // FileNameLength
            58usize,                      // FileNameOffset
        ),
        3 => (
            rd_u128(rec, 8)?,  // FileReferenceNumber (FILE_ID_128)
            rd_u128(rec, 24)?, // ParentFileReferenceNumber (FILE_ID_128)
            rd_i64(rec, 40)?,  // Usn
            rd_u32(rec, 56)?,  // Reason
            rd_u32(rec, 68)?,  // FileAttributes
            72usize,           // FileNameLength
            74usize,           // FileNameOffset
        ),
        // V4 records are range-tracking ranges without a name; unknown versions
        // are skipped rather than guessed at.
        _ => return None,
    };

    let name_len = rd_u16(rec, name_len_off)? as usize;
    let name_off = rd_u16(rec, name_off_off)? as usize;

    // Filename is UTF-16LE; offset is relative to the record start.
    let name_end = name_off.checked_add(name_len)?;
    let name_bytes = rec.get(name_off..name_end)?;
    if name_bytes.len() % 2 != 0 {
        return None;
    }
    let utf16: Vec<u16> = name_bytes
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .collect();
    let file_name = String::from_utf16_lossy(&utf16);

    Some(UsnRecord {
        usn,
        frn,
        parent_frn,
        reason,
        attributes,
        file_name,
    })
}

/// Parse a full `FSCTL_READ_*_USN_JOURNAL` output buffer.
///
/// The buffer layout is: an 8-byte `USN` (the *next* USN to resume from),
/// followed by a packed sequence of `USN_RECORD_V2`/`V3` entries, each prefixed
/// by its own `RecordLength`. `buf` must be sliced to the `bytesReturned` the
/// FSCTL reported.
///
/// Returns `(next_usn, records)`. An empty record vec with a valid `next_usn`
/// means "caught up" (the FSCTL returned only the 8-byte header).
///
/// # Errors
/// Returns [`UsnError::MalformedBuffer`] if the buffer is shorter than the
/// mandatory 8-byte USN header.
pub fn parse_usn_buffer(buf: &[u8]) -> Result<(i64, Vec<UsnRecord>), UsnError> {
    let next_usn = rd_i64(buf, 0).ok_or(UsnError::MalformedBuffer)?;

    let mut records = Vec::new();
    let mut offset = 8usize;
    while offset + 8 <= buf.len() {
        let record_length = match rd_u32(buf, offset) {
            Some(0) | None => break, // zero length would loop forever; stop.
            Some(len) => len as usize,
        };
        let end = match offset.checked_add(record_length) {
            Some(e) if e <= buf.len() => e,
            _ => break, // truncated trailing record — stop cleanly.
        };
        if let Some(rec) = parse_one_record(&buf[offset..end]) {
            records.push(rec);
        }
        offset = end;
    }

    Ok((next_usn, records))
}

// ---------------------------------------------------------------------------
// Windows FFI — the only `unsafe` in this module.
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod platform {
    use super::{UsnCursor, UsnError, UsnRecord, parse_usn_buffer};
    use std::os::windows::ffi::OsStrExt;
    use winapi::shared::minwindef::{DWORD, FALSE, LPVOID};
    use winapi::um::errhandlingapi::GetLastError;
    use winapi::um::fileapi::{CreateFileW, OPEN_EXISTING};
    use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
    use winapi::um::ioapiset::DeviceIoControl;
    use winapi::um::winnt::{FILE_ATTRIBUTE_NORMAL, FILE_SHARE_READ, FILE_SHARE_WRITE, HANDLE};

    // --- Win32 constants we define locally (stable ABI) -------------------

    /// Minimal access right that lets a *standard user* open a volume handle for
    /// unprivileged USN reads — crucially NOT `GENERIC_READ` (which needs admin).
    const FILE_TRAVERSE: DWORD = 0x0000_0020;

    /// `CTL_CODE(FILE_DEVICE_FILE_SYSTEM=9, fn, method, FILE_ANY_ACCESS=0)`.
    const fn ctl_code(function: u32, method: u32) -> DWORD {
        const FILE_DEVICE_FILE_SYSTEM: u32 = 0x0000_0009;
        (FILE_DEVICE_FILE_SYSTEM << 16) | (function << 2) | method
    }
    const METHOD_BUFFERED: u32 = 0;
    const METHOD_NEITHER: u32 = 3;

    /// `FSCTL_QUERY_USN_JOURNAL` = `0x000900F4` (fn 61, METHOD_BUFFERED).
    const FSCTL_QUERY_USN_JOURNAL: DWORD = ctl_code(61, METHOD_BUFFERED);
    /// `FSCTL_READ_UNPRIVILEGED_USN_JOURNAL` = `0x000903AB` (fn 234, METHOD_NEITHER).
    /// The unprivileged variant — readable without administrator rights.
    const FSCTL_READ_UNPRIVILEGED_USN_JOURNAL: DWORD = ctl_code(234, METHOD_NEITHER);

    // Win32 error codes we special-case.
    const ERROR_HANDLE_EOF: u32 = 38;
    const ERROR_JOURNAL_NOT_ACTIVE: u32 = 1179;
    const ERROR_JOURNAL_ENTRY_DELETED: u32 = 1181;
    const ERROR_INVALID_FUNCTION: u32 = 1;

    /// `USN_JOURNAL_DATA_V0` — output of `FSCTL_QUERY_USN_JOURNAL`.
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct UsnJournalDataV0 {
        usn_journal_id: u64,
        first_usn: i64,
        next_usn: i64,
        lowest_valid_usn: i64,
        max_usn: i64,
        maximum_size: u64,
        allocation_delta: u64,
    }

    /// `READ_USN_JOURNAL_DATA_V0` — input of the read FSCTL. V0 is deliberate:
    /// it is the broadly-compatible form and yields V2 records on NTFS.
    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    struct ReadUsnJournalDataV0 {
        start_usn: i64,
        reason_mask: u32,
        return_only_on_close: u32,
        timeout: u64,
        bytes_to_wait_for: u64,
        usn_journal_id: u64,
    }

    /// Read buffer size per FSCTL call (64 KiB holds many hundreds of records).
    const READ_BUFFER_BYTES: usize = 64 * 1024;

    // --- OpenFileById path resolution -------------------------------------
    // The unprivileged journal read strips inline filenames, so we resolve a
    // changed file-reference-number to its full path ourselves. This needs no
    // elevation for files the caller can access (system files → access-denied).

    /// Minimal access to read attributes / resolve a path (no data access).
    const FILE_READ_ATTRIBUTES: DWORD = 0x0000_0080;
    const FILE_SHARE_DELETE: DWORD = 0x0000_0004;
    /// Required to open directories by id (and to open without data access).
    const FILE_FLAG_BACKUP_SEMANTICS: DWORD = 0x0200_0000;

    /// `FILE_ID_DESCRIPTOR` (winbase.h). `id_type` 0 = `FileIdType` (64-bit
    /// `FileId`); 2 = `ExtendedFileIdType` (`FILE_ID_128`). The 16-byte id holds
    /// the file reference number, low half first.
    #[repr(C)]
    struct FileIdDescriptor {
        dw_size: u32,
        id_type: u32,
        id_low: u64,
        id_high: u64,
    }

    unsafe extern "system" {
        fn OpenFileById(
            h_volume_hint: HANDLE,
            lp_file_id: *const FileIdDescriptor,
            dw_desired_access: DWORD,
            dw_share_mode: DWORD,
            lp_security_attributes: LPVOID,
            dw_flags_and_attributes: DWORD,
        ) -> HANDLE;
        fn GetFinalPathNameByHandleW(
            h_file: HANDLE,
            lpsz_file_path: *mut u16,
            cch_file_path: DWORD,
            dw_flags: DWORD,
        ) -> DWORD;
    }

    /// An open, unprivileged handle to a volume's USN change journal.
    ///
    /// Holds a raw `HANDLE`; intentionally not `Send`/`Sync`. Open it on the
    /// thread that will drain it (e.g. a dedicated reader thread).
    pub struct UsnJournal {
        handle: HANDLE,
        journal_id: u64,
        next_usn: i64,
        buffer: Vec<u8>,
    }

    impl UsnJournal {
        /// Open the volume for `drive_letter` (e.g. `'C'`) **without elevation**
        /// and query its change journal.
        ///
        /// # Errors
        /// [`UsnError::OpenVolume`] if the handle cannot be opened,
        /// [`UsnError::JournalNotActive`] if the volume has no active journal.
        pub fn open(drive_letter: char) -> Result<Self, UsnError> {
            // Build the wide path `\\.\X:` for CreateFileW.
            let path = format!(r"\\.\{}:", drive_letter.to_ascii_uppercase());
            let wide: Vec<u16> = std::ffi::OsStr::new(&path)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();

            // SAFETY: `wide` is a valid NUL-terminated UTF-16 string for the
            // lifetime of the call; all other pointer args are null as allowed
            // by CreateFileW. FILE_TRAVERSE keeps this an unprivileged open.
            let handle = unsafe {
                CreateFileW(
                    wide.as_ptr(),
                    FILE_TRAVERSE,
                    FILE_SHARE_READ | FILE_SHARE_WRITE,
                    std::ptr::null_mut(),
                    OPEN_EXISTING,
                    FILE_ATTRIBUTE_NORMAL,
                    std::ptr::null_mut(),
                )
            };
            if handle == INVALID_HANDLE_VALUE {
                // SAFETY: trivially safe; reads the calling thread's last error.
                return Err(UsnError::OpenVolume(unsafe { GetLastError() }));
            }

            let mut data = UsnJournalDataV0::default();
            let mut bytes: DWORD = 0;
            // SAFETY: `handle` is valid; `data` is a correctly-sized, aligned
            // output buffer for USN_JOURNAL_DATA_V0; `bytes` receives the count.
            let ok = unsafe {
                DeviceIoControl(
                    handle,
                    FSCTL_QUERY_USN_JOURNAL,
                    std::ptr::null_mut(),
                    0,
                    std::ptr::addr_of_mut!(data) as LPVOID,
                    u32::try_from(std::mem::size_of::<UsnJournalDataV0>()).unwrap_or(0),
                    &mut bytes,
                    std::ptr::null_mut(),
                )
            };
            if ok == FALSE {
                // SAFETY: trivially safe.
                let err = unsafe { GetLastError() };
                // SAFETY: handle is a valid, owned handle we are done with.
                unsafe { CloseHandle(handle) };
                return Err(match err {
                    ERROR_JOURNAL_NOT_ACTIVE | ERROR_INVALID_FUNCTION => UsnError::JournalNotActive,
                    other => UsnError::DeviceIo(other),
                });
            }

            Ok(Self {
                handle,
                journal_id: data.usn_journal_id,
                next_usn: data.next_usn,
                buffer: vec![0u8; READ_BUFFER_BYTES],
            })
        }

        /// Current resume cursor — persist across restarts to avoid a re-crawl.
        #[must_use]
        pub fn cursor(&self) -> UsnCursor {
            UsnCursor {
                journal_id: self.journal_id,
                next_usn: self.next_usn,
            }
        }

        /// Read the next page of records starting at `start_usn`, advancing the
        /// internal cursor. An empty vec means "caught up".
        ///
        /// # Errors
        /// [`UsnError::JournalEntryDeleted`] if the cursor was purged (rebuild),
        /// [`UsnError::DeviceIo`] for other `DeviceIoControl` failures.
        pub fn read_batch(&mut self, start_usn: i64) -> Result<Vec<UsnRecord>, UsnError> {
            let read_data = ReadUsnJournalDataV0 {
                start_usn,
                reason_mask: u32::MAX,
                usn_journal_id: self.journal_id,
                ..Default::default()
            };
            let mut bytes: DWORD = 0;
            // SAFETY: `handle` is valid; `read_data` is a correctly-sized input
            // struct; `buffer` is a writable region of `buffer.len()` bytes;
            // `bytes` receives the count written. METHOD_NEITHER FSCTLs use the
            // raw buffers we pass directly.
            let ok = unsafe {
                DeviceIoControl(
                    self.handle,
                    FSCTL_READ_UNPRIVILEGED_USN_JOURNAL,
                    std::ptr::addr_of!(read_data) as LPVOID,
                    u32::try_from(std::mem::size_of::<ReadUsnJournalDataV0>()).unwrap_or(0),
                    self.buffer.as_mut_ptr() as LPVOID,
                    u32::try_from(self.buffer.len()).unwrap_or(0),
                    &mut bytes,
                    std::ptr::null_mut(),
                )
            };
            if ok == FALSE {
                // SAFETY: trivially safe.
                let err = unsafe { GetLastError() };
                return match err {
                    // EOF here means "no more data right now" — treat as caught up.
                    ERROR_HANDLE_EOF => {
                        self.next_usn = start_usn;
                        Ok(Vec::new())
                    }
                    ERROR_JOURNAL_ENTRY_DELETED => Err(UsnError::JournalEntryDeleted),
                    other => Err(UsnError::DeviceIo(other)),
                };
            }

            let returned = bytes as usize;
            let (next_usn, records) =
                parse_usn_buffer(&self.buffer[..returned.min(self.buffer.len())])?;
            self.next_usn = next_usn;
            Ok(records)
        }

        /// Drain every pending record from `start_usn` to the journal tail,
        /// invoking `sink` for each. Returns the new cursor to persist.
        ///
        /// `sink` returning `false` stops the drain early (cooperative cancel).
        ///
        /// # Errors
        /// Propagates [`read_batch`](Self::read_batch) errors so the caller can
        /// fall back or rebuild.
        pub fn drain<F: FnMut(&UsnRecord) -> bool>(
            &mut self,
            start_usn: i64,
            mut sink: F,
        ) -> Result<UsnCursor, UsnError> {
            let mut start = start_usn;
            loop {
                let batch = self.read_batch(start)?;
                if batch.is_empty() {
                    break;
                }
                for rec in &batch {
                    if !sink(rec) {
                        return Ok(self.cursor());
                    }
                }
                // Advance; guard against a non-progressing cursor.
                if self.next_usn <= start {
                    break;
                }
                start = self.next_usn;
            }
            Ok(self.cursor())
        }

        /// Resolve a file reference number to its full path via `OpenFileById`
        /// on the volume handle — **no elevation required** for files the caller
        /// can access. Returns `None` for inaccessible (system) files, for files
        /// that no longer exist (a deleted FRN does not resolve), or on error.
        ///
        /// This is how the no-admin pipeline obtains paths: the unprivileged
        /// journal read strips inline filenames, so a changed FRN is resolved
        /// here for upserts. Deletes (whose FRN no longer resolves) are matched
        /// against an `FRN→path` map seeded from the baseline enumeration.
        #[must_use]
        pub fn resolve_path(&self, frn: u128) -> Option<std::path::PathBuf> {
            let desc = FileIdDescriptor {
                dw_size: u32::try_from(std::mem::size_of::<FileIdDescriptor>()).ok()?,
                id_type: if frn >> 64 == 0 { 0 } else { 2 },
                id_low: frn as u64,
                id_high: (frn >> 64) as u64,
            };
            // SAFETY: `self.handle` is a live volume handle on the same volume as
            // `frn`; `desc` outlives the call; null security attributes allowed.
            let file = unsafe {
                OpenFileById(
                    self.handle,
                    std::ptr::addr_of!(desc),
                    FILE_READ_ATTRIBUTES,
                    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
                    std::ptr::null_mut(),
                    FILE_FLAG_BACKUP_SEMANTICS,
                )
            };
            if file == INVALID_HANDLE_VALUE {
                return None;
            }
            let mut buf = vec![0u16; 32768];
            // SAFETY: `file` is a valid handle; `buf` is a writable region of
            // `buf.len()` u16; flags 0 = FILE_NAME_NORMALIZED | VOLUME_NAME_DOS.
            let len = unsafe {
                GetFinalPathNameByHandleW(
                    file,
                    buf.as_mut_ptr(),
                    u32::try_from(buf.len()).unwrap_or(0),
                    0,
                )
            } as usize;
            // SAFETY: `file` is an owned handle we are finished with.
            unsafe { CloseHandle(file) };
            if len == 0 || len >= buf.len() {
                return None;
            }
            Some(std::path::PathBuf::from(String::from_utf16_lossy(&buf[..len])))
        }
    }

    impl Drop for UsnJournal {
        fn drop(&mut self) {
            if self.handle != INVALID_HANDLE_VALUE {
                // SAFETY: `handle` was produced by CreateFileW and not yet closed.
                unsafe { CloseHandle(self.handle) };
            }
        }
    }
}

#[cfg(windows)]
pub use platform::UsnJournal;

/// Non-Windows stub so the crate compiles with `usn-incremental` on any OS
/// (the pure parser above is what those builds exercise in tests).
#[cfg(not(windows))]
pub struct UsnJournal;

#[cfg(not(windows))]
impl UsnJournal {
    /// Always [`UsnError::Unsupported`] off Windows.
    ///
    /// # Errors
    /// Always returns [`UsnError::Unsupported`].
    pub fn open(_drive_letter: char) -> Result<Self, UsnError> {
        Err(UsnError::Unsupported)
    }
}

// ---------------------------------------------------------------------------
// Index driver — turn the change stream into index mutations.
// ---------------------------------------------------------------------------

/// Resolves a file reference number to a clean full path (no `\\?\` prefix).
/// Abstracted so the driver logic is unit-testable with a fake resolver, and so
/// the `OpenFileById` FFI stays isolated behind the Windows implementation.
pub trait PathResolver {
    /// Full path for `frn`, or `None` if inaccessible / already deleted.
    fn resolve(&self, frn: u128) -> Option<String>;
}

#[cfg(windows)]
impl PathResolver for UsnJournal {
    fn resolve(&self, frn: u128) -> Option<String> {
        self.resolve_path(frn)
            .map(|p| strip_extended_prefix(&p.to_string_lossy()))
    }
}

/// Strip the Win32 extended-length prefix so paths match the rest of the index
/// (`\\?\C:\x` → `C:\x`, `\\?\UNC\srv\s` → `\\srv\s`).
#[must_use]
pub fn strip_extended_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        path.to_string()
    }
}

/// Path-component denylist mirroring the Volt scanner and the Windows Search
/// supplement (`indexer/windows_search.rs`). The USN journal fires for the
/// *entire* volume, so noisy/system locations are dropped before they ever reach
/// the index.
const EXCLUDED_COMPONENTS: &[&str] = &[
    "node_modules",
    ".git",
    ".svn",
    "__pycache__",
    ".venv",
    "venv",
    "target",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "tmp",
    "temp",
    "Temp",
    "Cache",
    "cache",
    "Caches",
    "caches",
    ".cache",
    "$Recycle.Bin",
    "System Volume Information",
    "AppData",
    "Windows",
    "ProgramData",
    "Program Files",
    "Program Files (x86)",
];

/// Whether `path` is worth indexing (false for excluded/system locations).
#[must_use]
pub fn is_indexable(path: &str) -> bool {
    !std::path::Path::new(path).components().any(|c| {
        c.as_os_str()
            .to_str()
            .is_some_and(|s| EXCLUDED_COMPONENTS.contains(&s))
    })
}

/// The index mutations a batch of USN records resolves to.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct UsnDelta {
    /// Full paths to (re)index.
    pub upserts: Vec<String>,
    /// Full paths to remove from the index.
    pub removals: Vec<String>,
}

/// Turns the USN change stream into index mutations. Owns the `FRN → path` map
/// that lets *deletes* — whose FRN no longer resolves via `OpenFileById` — be
/// turned back into the path to remove.
#[derive(Debug, Default)]
pub struct UsnIndexer {
    frn_to_path: std::collections::HashMap<u128, String>,
}

impl UsnIndexer {
    /// Empty indexer with no tracked FRNs.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Pre-populate the map from already-indexed `(frn, path)` pairs so that a
    /// delete of a file indexed *before* this session can still be resolved.
    pub fn seed(&mut self, frn: u128, path: String) {
        self.frn_to_path.insert(frn, path);
    }

    /// Number of FRNs currently tracked.
    #[must_use]
    pub fn tracked(&self) -> usize {
        self.frn_to_path.len()
    }

    /// Classify a batch of records into upsert/remove paths, updating the map.
    /// `resolver` turns a live FRN into its current path (e.g. `OpenFileById`).
    ///
    /// The FRN→path mapping is recorded for *every* resolvable upsert — even
    /// excluded paths — so a later delete can still be matched; only allowed
    /// paths are emitted into the returned [`UsnDelta`].
    pub fn apply_records(
        &mut self,
        records: &[UsnRecord],
        resolver: &impl PathResolver,
    ) -> UsnDelta {
        let mut delta = UsnDelta::default();
        for rec in records {
            match rec.change() {
                RecordChange::Upsert => {
                    if let Some(path) = resolver.resolve(rec.frn) {
                        self.frn_to_path.insert(rec.frn, path.clone());
                        if is_indexable(&path) {
                            delta.upserts.push(path);
                        }
                    }
                }
                RecordChange::Remove => {
                    if let Some(path) = self.frn_to_path.remove(&rec.frn)
                        && is_indexable(&path)
                    {
                        delta.removals.push(path);
                    }
                }
                RecordChange::Ignore => {}
            }
        }
        delta
    }
}

#[cfg(windows)]
impl UsnIndexer {
    /// Drain the journal from `start_usn`, resolve + classify every record, and
    /// apply the resulting upserts/removals to the SQLite index (and the Tantivy
    /// index when enabled). Returns the resume cursor and the applied delta.
    ///
    /// NOTE: not yet wired into the app lifecycle — gated on the enumeration
    /// benchmark GO (see `TODO-REFONTE.md`). SQLite is the source of truth; the
    /// in-memory result cache is rebuilt from it on next load, so updating that
    /// cache live is left to the lifecycle integration.
    ///
    /// # Errors
    /// Propagates [`UsnJournal::read_batch`] errors so the caller can fall back
    /// (no journal) or rebuild the baseline (journal wrap).
    pub fn pump(
        &mut self,
        journal: &mut UsnJournal,
        start_usn: i64,
        db: &crate::indexer::database::FileIndexDb,
        #[cfg(feature = "tantivy-search")] fulltext: Option<
            &crate::indexer::fulltext::FulltextIndex,
        >,
    ) -> Result<(UsnCursor, UsnDelta), UsnError> {
        use crate::indexer::scanner::{create_directory_info_pub, create_file_info_pub};
        use crate::indexer::types::FileInfo;

        // Drain pending records, then classify them in one pass. (For a large
        // cold catch-up this buffers many records; the lifecycle integration
        // will chunk it. Incremental deltas are tiny.)
        let mut records: Vec<UsnRecord> = Vec::new();
        let cursor = journal.drain(start_usn, |rec| {
            records.push(rec.clone());
            true
        })?;
        let delta = self.apply_records(&records, &*journal);

        // Materialise upsert paths into FileInfo via the same helpers the
        // recursive walker uses, then apply to the sinks.
        let mut infos: Vec<FileInfo> = Vec::new();
        for path in &delta.upserts {
            let p = std::path::Path::new(path);
            if let Ok(meta) = std::fs::metadata(p) {
                let info = if meta.is_dir() {
                    create_directory_info_pub(p, &meta)
                } else {
                    create_file_info_pub(p, &meta)
                };
                if let Some(fi) = info {
                    if let Err(e) = db.upsert_file(&fi) {
                        tracing::warn!("USN upsert failed for {path}: {e}");
                    } else {
                        infos.push(fi);
                    }
                }
            }
        }
        for path in &delta.removals {
            if let Err(e) = db.remove_file(path) {
                tracing::warn!("USN remove failed for {path}: {e}");
            }
        }

        #[cfg(feature = "tantivy-search")]
        if let Some(ft) = fulltext
            && (!infos.is_empty() || !delta.removals.is_empty())
            && let Err(e) = ft.apply_batch(&infos, &delta.removals)
        {
            tracing::warn!("USN fulltext sync failed: {e}");
        }

        Ok((cursor, delta))
    }
}

// ---------------------------------------------------------------------------
// Tests — exercise the portable parser + classifier on synthetic buffers.
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Build a synthetic `USN_RECORD_V2` for tests.
    fn make_v2(usn: i64, frn: u64, parent: u64, reason: u32, attrs: u32, name: &str) -> Vec<u8> {
        let name_utf16: Vec<u8> = name
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        let name_off: u16 = 60; // fixed V2 header size
        let record_length = (name_off as usize + name_utf16.len()) as u32;

        let mut rec = vec![0u8; name_off as usize];
        rec[0..4].copy_from_slice(&record_length.to_le_bytes());
        rec[4..6].copy_from_slice(&2u16.to_le_bytes()); // MajorVersion = 2
        rec[6..8].copy_from_slice(&0u16.to_le_bytes()); // MinorVersion
        rec[8..16].copy_from_slice(&frn.to_le_bytes());
        rec[16..24].copy_from_slice(&parent.to_le_bytes());
        rec[24..32].copy_from_slice(&usn.to_le_bytes());
        // 32..40 TimeStamp (ignored by parser)
        rec[40..44].copy_from_slice(&reason.to_le_bytes());
        // 44..48 SourceInfo, 48..52 SecurityId
        rec[52..56].copy_from_slice(&attrs.to_le_bytes());
        rec[56..58].copy_from_slice(&(name_utf16.len() as u16).to_le_bytes());
        rec[58..60].copy_from_slice(&name_off.to_le_bytes());
        rec.extend_from_slice(&name_utf16);
        rec
    }

    /// Build a synthetic `USN_RECORD_V3` (128-bit FRNs) for tests.
    fn make_v3(usn: i64, reason: u32, attrs: u32, name: &str) -> Vec<u8> {
        let name_utf16: Vec<u8> = name
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect();
        let name_off: u16 = 76; // fixed V3 header size
        let record_length = (name_off as usize + name_utf16.len()) as u32;

        let mut rec = vec![0u8; name_off as usize];
        rec[0..4].copy_from_slice(&record_length.to_le_bytes());
        rec[4..6].copy_from_slice(&3u16.to_le_bytes()); // MajorVersion = 3
        // 8..24 FRN (128-bit), 24..40 parent FRN — left zero
        rec[40..48].copy_from_slice(&usn.to_le_bytes());
        rec[56..60].copy_from_slice(&reason.to_le_bytes());
        rec[68..72].copy_from_slice(&attrs.to_le_bytes());
        rec[72..74].copy_from_slice(&(name_utf16.len() as u16).to_le_bytes());
        rec[74..76].copy_from_slice(&name_off.to_le_bytes());
        rec.extend_from_slice(&name_utf16);
        rec
    }

    /// Prepend the 8-byte next-USN header that the FSCTL output carries.
    fn with_header(next_usn: i64, records: &[Vec<u8>]) -> Vec<u8> {
        let mut buf = next_usn.to_le_bytes().to_vec();
        for r in records {
            buf.extend_from_slice(r);
        }
        buf
    }

    #[test]
    fn parses_single_v2_record() {
        let rec = make_v2(42, 100, 5, USN_REASON_FILE_CREATE, 0, "hello.txt");
        let buf = with_header(43, &[rec]);

        let (next, records) = parse_usn_buffer(&buf).expect("parse");
        assert_eq!(next, 43);
        assert_eq!(records.len(), 1);
        let r = &records[0];
        assert_eq!(r.usn, 42);
        assert_eq!(r.frn, 100);
        assert_eq!(r.parent_frn, 5);
        assert_eq!(r.file_name, "hello.txt");
        assert_eq!(r.change(), RecordChange::Upsert);
        assert!(!r.is_directory());
    }

    #[test]
    fn parses_multiple_records_in_one_buffer() {
        let recs = vec![
            make_v2(1, 10, 2, USN_REASON_FILE_CREATE, 0, "a.rs"),
            make_v2(2, 11, 2, USN_REASON_FILE_DELETE, 0, "b.rs"),
            make_v2(3, 12, 2, USN_REASON_DATA_EXTEND | USN_REASON_CLOSE, 0, "c.rs"),
        ];
        let buf = with_header(4, &recs);

        let (next, parsed) = parse_usn_buffer(&buf).expect("parse");
        assert_eq!(next, 4);
        assert_eq!(parsed.len(), 3);
        assert_eq!(parsed[0].change(), RecordChange::Upsert);
        assert_eq!(parsed[1].change(), RecordChange::Remove);
        assert_eq!(parsed[2].change(), RecordChange::Upsert);
        assert_eq!(parsed[0].file_name, "a.rs");
        assert_eq!(parsed[2].file_name, "c.rs");
    }

    #[test]
    fn parses_v3_record_with_unicode_name() {
        let rec = make_v3(
            7,
            USN_REASON_RENAME_NEW_NAME,
            FILE_ATTRIBUTE_DIRECTORY,
            "Résumé 文档",
        );
        let buf = with_header(8, &[rec]);

        let (next, records) = parse_usn_buffer(&buf).expect("parse");
        assert_eq!(next, 8);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].file_name, "Résumé 文档");
        assert_eq!(records[0].change(), RecordChange::Upsert);
        assert!(records[0].is_directory());
    }

    #[test]
    fn empty_buffer_means_caught_up() {
        let buf = 99i64.to_le_bytes().to_vec(); // header only, no records
        let (next, records) = parse_usn_buffer(&buf).expect("parse");
        assert_eq!(next, 99);
        assert!(records.is_empty());
    }

    #[test]
    fn buffer_shorter_than_header_is_malformed() {
        assert_eq!(parse_usn_buffer(&[0u8; 4]), Err(UsnError::MalformedBuffer));
    }

    #[test]
    fn rename_old_name_is_a_removal() {
        let rec = make_v2(5, 20, 2, USN_REASON_RENAME_OLD_NAME, 0, "old.txt");
        let (_, records) = parse_usn_buffer(&with_header(6, &[rec])).expect("parse");
        assert_eq!(records[0].change(), RecordChange::Remove);
    }

    #[test]
    fn create_then_delete_coalesced_is_ignored() {
        let rec = make_v2(
            5,
            20,
            2,
            USN_REASON_FILE_CREATE | USN_REASON_FILE_DELETE | USN_REASON_CLOSE,
            0,
            "transient.tmp",
        );
        let (_, records) = parse_usn_buffer(&with_header(6, &[rec])).expect("parse");
        assert_eq!(records[0].change(), RecordChange::Ignore);
    }

    #[test]
    fn metadata_only_change_is_ignored() {
        // SecurityChange (0x800) alone is churn we do not index on.
        let rec = make_v2(5, 20, 2, 0x0000_0800, 0, "perms.txt");
        let (_, records) = parse_usn_buffer(&with_header(6, &[rec])).expect("parse");
        assert_eq!(records[0].change(), RecordChange::Ignore);
    }

    #[test]
    fn truncated_trailing_record_is_skipped_not_panicked() {
        let good = make_v2(1, 10, 2, USN_REASON_FILE_CREATE, 0, "good.rs");
        let mut buf = with_header(2, &[good]);
        // Append a bogus record claiming a huge length but with no body.
        buf.extend_from_slice(&9999u32.to_le_bytes());
        buf.extend_from_slice(&2u16.to_le_bytes());

        let (next, records) = parse_usn_buffer(&buf).expect("parse");
        assert_eq!(next, 2);
        assert_eq!(records.len(), 1); // only the valid record survives
        assert_eq!(records[0].file_name, "good.rs");
    }

    // --- Index driver ----------------------------------------------------

    /// In-memory stand-in for `OpenFileById` resolution.
    struct FakeResolver(std::collections::HashMap<u128, String>);
    impl PathResolver for FakeResolver {
        fn resolve(&self, frn: u128) -> Option<String> {
            self.0.get(&frn).cloned()
        }
    }

    /// Minimal record with a chosen FRN + reason (the driver ignores the name).
    fn driver_rec(frn: u128, reason: u32) -> UsnRecord {
        UsnRecord {
            usn: 1,
            frn,
            parent_frn: 0,
            reason,
            attributes: 0,
            file_name: String::new(),
        }
    }

    #[test]
    fn strip_extended_prefix_variants() {
        assert_eq!(strip_extended_prefix(r"\\?\C:\Users\a.txt"), r"C:\Users\a.txt");
        assert_eq!(strip_extended_prefix(r"\\?\UNC\srv\share\f"), r"\\srv\share\f");
        assert_eq!(strip_extended_prefix(r"C:\already\clean"), r"C:\already\clean");
    }

    #[test]
    fn is_indexable_excludes_system_and_noise() {
        assert!(is_indexable(r"C:\Users\me\Documents\report.pdf"));
        assert!(!is_indexable(r"C:\Windows\System32\kernel32.dll"));
        assert!(!is_indexable(r"C:\Users\me\project\node_modules\x\index.js"));
        assert!(!is_indexable(r"C:\Users\me\AppData\Local\app\cache.db"));
    }

    #[test]
    fn upsert_is_indexed_and_tracked() {
        let mut idx = UsnIndexer::new();
        let resolver = FakeResolver(
            [(7u128, r"C:\Users\me\notes.md".to_string())]
                .into_iter()
                .collect(),
        );
        let delta = idx.apply_records(&[driver_rec(7, USN_REASON_FILE_CREATE)], &resolver);
        assert_eq!(delta.upserts, vec![r"C:\Users\me\notes.md".to_string()]);
        assert!(delta.removals.is_empty());
        assert_eq!(idx.tracked(), 1);
    }

    #[test]
    fn delete_after_upsert_resolves_via_map() {
        let mut idx = UsnIndexer::new();
        let resolver = FakeResolver(
            [(7u128, r"C:\Users\me\notes.md".to_string())]
                .into_iter()
                .collect(),
        );
        idx.apply_records(&[driver_rec(7, USN_REASON_FILE_CREATE)], &resolver);
        // The delete resolver returns None (file gone) — the map carries the path.
        let empty = FakeResolver(std::collections::HashMap::new());
        let delta = idx.apply_records(&[driver_rec(7, USN_REASON_FILE_DELETE)], &empty);
        assert_eq!(delta.removals, vec![r"C:\Users\me\notes.md".to_string()]);
        assert_eq!(idx.tracked(), 0); // FRN dropped from the map
    }

    #[test]
    fn delete_of_untracked_frn_is_skipped() {
        let mut idx = UsnIndexer::new();
        let empty = FakeResolver(std::collections::HashMap::new());
        let delta = idx.apply_records(&[driver_rec(99, USN_REASON_FILE_DELETE)], &empty);
        assert!(delta.removals.is_empty());
    }

    #[test]
    fn excluded_path_is_tracked_but_not_emitted() {
        let mut idx = UsnIndexer::new();
        let resolver = FakeResolver(
            [(7u128, r"C:\Windows\System32\drivers\etc\hosts".to_string())]
                .into_iter()
                .collect(),
        );
        let up = idx.apply_records(&[driver_rec(7, USN_REASON_FILE_CREATE)], &resolver);
        assert!(up.upserts.is_empty(), "excluded path must not be indexed");
        assert_eq!(idx.tracked(), 1, "but the FRN is still tracked for later deletes");

        let empty = FakeResolver(std::collections::HashMap::new());
        let del = idx.apply_records(&[driver_rec(7, USN_REASON_FILE_DELETE)], &empty);
        assert!(del.removals.is_empty(), "excluded path must not be removed either");
        assert_eq!(idx.tracked(), 0);
    }
}
