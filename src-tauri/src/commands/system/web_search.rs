//! Optional web search backed by the Brave Search API.
//!
//! The API key is read from the OS keyring and never crosses the IPC boundary.
//! Calls are deliberately bounded and only target Brave's fixed HTTPS endpoint.

use crate::commands::auth::load_credential;
use crate::commands::launcher::{AppInfo, scan_applications};
use crate::commands::system::settings::{
    WebSearchSettings, load_settings, update_settings_section,
};
use crate::core::error::{VoltError, VoltResult};
use crate::launcher::{LaunchOptions, launch_with_options};
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::net::IpAddr;
#[cfg(any(target_os = "windows", target_os = "macos"))]
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::AppHandle;
use tracing::warn;
use ts_rs::TS;
use url::Url;
use zeroize::Zeroizing;

const BRAVE_WEB_SEARCH_URL: &str = "https://api.search.brave.com/res/v1/web/search";
const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const MAX_URL_BYTES: usize = 2048;
const RATE_LIMIT_WINDOW: Duration = Duration::from_secs(10);
const RATE_LIMIT_REQUESTS: usize = 20;

static REQUEST_TIMES: OnceLock<Mutex<VecDeque<Instant>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "DetectedBrowser.ts")]
pub struct DetectedBrowser {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchHit {
    pub title: String,
    pub url: String,
    pub description: Option<String>,
    pub age: Option<String>,
    pub favicon: Option<String>,
}

#[derive(Debug, Deserialize)]
struct BraveResponse {
    web: Option<BraveWebResults>,
}

#[derive(Debug, Deserialize)]
struct BraveWebResults {
    #[serde(default)]
    results: Vec<BraveResult>,
}

#[derive(Debug, Deserialize)]
struct BraveResult {
    title: String,
    url: String,
    description: Option<String>,
    age: Option<String>,
    profile: Option<BraveProfile>,
}

#[derive(Debug, Deserialize)]
struct BraveProfile {
    img: Option<String>,
}

fn validate_query(query: &str) -> VoltResult<&str> {
    let query = query.trim();
    if query.len() < 2 {
        return Err(VoltError::InvalidConfig(
            "Web search query must contain at least 2 characters".to_string(),
        ));
    }
    if query.len() > 512 {
        return Err(VoltError::InvalidConfig(
            "Web search query must not exceed 512 bytes".to_string(),
        ));
    }
    Ok(query)
}

fn validate_country(country: Option<String>) -> VoltResult<Option<String>> {
    match country {
        Some(value) if value.len() == 2 && value.as_bytes().iter().all(u8::is_ascii_alphabetic) => {
            Ok(Some(value.to_ascii_uppercase()))
        }
        Some(_) => Err(VoltError::InvalidConfig(
            "Web search country must be a two-letter country code".to_string(),
        )),
        None => Ok(None),
    }
}

fn validate_language(language: Option<String>) -> VoltResult<Option<String>> {
    match language {
        Some(value) if value.len() == 2 && value.as_bytes().iter().all(u8::is_ascii_alphabetic) => {
            Ok(Some(value.to_ascii_lowercase()))
        }
        Some(_) => Err(VoltError::InvalidConfig(
            "Web search language must be a two-letter language code".to_string(),
        )),
        None => Ok(None),
    }
}

fn validate_freshness(freshness: Option<String>) -> VoltResult<Option<String>> {
    match freshness {
        Some(value) if matches!(value.as_str(), "pd" | "pw" | "pm" | "py") => Ok(Some(value)),
        Some(_) => Err(VoltError::InvalidConfig(
            "Web search freshness must be one of pd, pw, pm, or py".to_string(),
        )),
        None => Ok(None),
    }
}

pub(crate) fn check_rate_limit() -> VoltResult<()> {
    let now = Instant::now();
    let times = REQUEST_TIMES.get_or_init(|| Mutex::new(VecDeque::new()));
    let mut times = times
        .lock()
        .map_err(|_| VoltError::Search("Web search rate limiter is unavailable".to_string()))?;

    while times
        .front()
        .is_some_and(|started| now.duration_since(*started) >= RATE_LIMIT_WINDOW)
    {
        times.pop_front();
    }

    if times.len() >= RATE_LIMIT_REQUESTS {
        return Err(VoltError::Search(
            "Web search is temporarily rate limited".to_string(),
        ));
    }

    times.push_back(now);
    Ok(())
}

fn sanitize_http_url(value: String, allow_local: bool) -> Option<String> {
    if value.len() > MAX_URL_BYTES {
        return None;
    }

    let parsed = Url::parse(&value).ok()?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return None;
    }

    if !allow_local {
        let host = parsed
            .host_str()?
            .trim_end_matches('.')
            .to_ascii_lowercase();
        if host == "localhost"
            || host.ends_with(".localhost")
            || host
                .parse::<IpAddr>()
                .is_ok_and(|address| address.is_loopback() || address.is_unspecified())
        {
            return None;
        }
    }

    Some(value)
}

fn validate_url_to_open(value: String) -> VoltResult<String> {
    sanitize_http_url(value, true).ok_or_else(|| {
        VoltError::InvalidConfig(
            "Only valid http:// and https:// URLs can be opened in a browser".to_string(),
        )
    })
}

fn is_supported_search_engine(engine: &str) -> bool {
    matches!(engine, "google" | "bing" | "duckduckgo")
}

fn is_launchable_browser(app: &AppInfo) -> bool {
    if app.category.as_deref() != Some("browsers") {
        return false;
    }

    #[cfg(target_os = "windows")]
    {
        let path = Path::new(&app.path);
        path.is_file()
            && path.extension().is_some_and(|extension| {
                extension.eq_ignore_ascii_case("exe") || extension.eq_ignore_ascii_case("lnk")
            })
    }

    #[cfg(target_os = "macos")]
    {
        let path = Path::new(&app.path);
        path.exists()
            && path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("app"))
    }

    #[cfg(target_os = "linux")]
    {
        shlex::split(&app.path).is_some_and(|parts| !parts.is_empty())
    }
}

async fn detected_browser_apps() -> VoltResult<Vec<AppInfo>> {
    let mut browsers = scan_applications()
        .await?
        .into_iter()
        .filter(is_launchable_browser)
        .collect::<Vec<_>>();
    browsers.sort_by_key(|browser| browser.name.to_lowercase());
    Ok(browsers)
}

pub(crate) async fn validate_web_search_settings(settings: &WebSearchSettings) -> VoltResult<()> {
    if !is_supported_search_engine(&settings.default_engine) {
        return Err(VoltError::InvalidConfig(
            "Web search engine must be google, bing, or duckduckgo".to_string(),
        ));
    }

    if let Some(browser_id) = settings.preferred_browser_id.as_deref() {
        let browsers = detected_browser_apps().await?;
        if !browsers.iter().any(|browser| browser.id == browser_id) {
            return Err(VoltError::InvalidConfig(
                "The selected browser is not installed or is not a detected browser".to_string(),
            ));
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn list_detected_browsers() -> VoltResult<Vec<DetectedBrowser>> {
    Ok(detected_browser_apps()
        .await?
        .into_iter()
        .map(|browser| DetectedBrowser {
            id: browser.id,
            name: browser.name,
        })
        .collect())
}

#[tauri::command]
pub async fn open_web_url(app_handle: AppHandle, url: String) -> VoltResult<()> {
    let url = validate_url_to_open(url)?;
    let settings = load_settings(app_handle.clone()).await?;

    if let Some(browser_id) = settings.web_search.preferred_browser_id.as_deref() {
        let (browser, should_clear_preference) = match detected_browser_apps().await {
            Ok(browsers) => (
                browsers
                    .into_iter()
                    .find(|browser| browser.id == browser_id),
                true,
            ),
            Err(error) => {
                warn!(
                    browser_id,
                    %error,
                    "Browser detection failed; falling back to the system browser"
                );
                (None, false)
            }
        };

        if let Some(browser) = browser {
            let options = LaunchOptions::new().with_args(vec![url.clone()]);
            if launch_with_options(&browser.path, options).is_ok() {
                return Ok(());
            }
            warn!(
                browser_id,
                browser_path = %browser.path,
                "Preferred browser failed to launch; falling back to the system browser"
            );
        } else {
            warn!(
                browser_id,
                "Preferred browser is no longer installed; falling back to the system browser"
            );
        }

        if should_clear_preference {
            // Persist the fallback so a removed browser is not retried on every link.
            update_settings_section(app_handle, |settings| {
                settings.web_search.preferred_browser_id = None;
            })
            .await?;
        }
    }

    tauri_plugin_opener::open_url(&url, None::<&str>)
        .map_err(|error| VoltError::Launch(format!("Failed to open URL: {error}")))
}

fn bounded_text(value: String, max_chars: usize) -> String {
    value.chars().take(max_chars).collect()
}

#[tauri::command]
pub async fn web_search_brave(
    query: String,
    count: Option<u8>,
    country: Option<String>,
    search_lang: Option<String>,
    freshness: Option<String>,
) -> VoltResult<Vec<WebSearchHit>> {
    let query = validate_query(&query)?;
    let count = count.unwrap_or(5).clamp(1, 10);
    let country = validate_country(country)?;
    let search_lang = validate_language(search_lang)?;
    let freshness = validate_freshness(freshness)?;
    let api_key = load_credential("brave-search".to_string())
        .map_err(VoltError::InvalidConfig)?
        .map(Zeroizing::new)
        .ok_or_else(|| {
            VoltError::InvalidConfig(
                "Brave Search API key is not configured in Settings".to_string(),
            )
        })?;
    check_rate_limit()?;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| {
            VoltError::Search(format!("Failed to create web search client: {error}"))
        })?;

    let mut request = client
        .get(BRAVE_WEB_SEARCH_URL)
        .header("Accept", "application/json")
        .header("X-Subscription-Token", api_key.trim())
        .query(&[
            ("q", query.to_string()),
            ("count", count.to_string()),
            ("safesearch", "moderate".to_string()),
        ]);

    if let Some(country) = country {
        request = request.query(&[("country", country)]);
    }
    if let Some(search_lang) = search_lang {
        request = request.query(&[("search_lang", search_lang)]);
    }
    if let Some(freshness) = freshness {
        request = request.query(&[("freshness", freshness)]);
    }

    let response = request
        .send()
        .await
        .map_err(|error| VoltError::Search(format!("Web search request failed: {error}")))?;
    let status = response.status();

    if !status.is_success() {
        return Err(match status.as_u16() {
            401 | 403 => {
                VoltError::PermissionDenied("Brave Search API key was rejected".to_string())
            }
            429 => VoltError::Search("Brave Search rate limit reached".to_string()),
            _ => VoltError::Search(format!("Brave Search returned HTTP {status}")),
        });
    }

    let mut bytes = Vec::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|error| VoltError::Search(format!("Failed to read web results: {error}")))?;
        if bytes.len() + chunk.len() > MAX_RESPONSE_BYTES {
            return Err(VoltError::Search(
                "Web search response exceeded the 1 MB limit".to_string(),
            ));
        }
        bytes.extend_from_slice(&chunk);
    }

    let payload: BraveResponse = serde_json::from_slice(&bytes).map_err(|error| {
        VoltError::Serialization(format!("Invalid Brave Search response: {error}"))
    })?;

    Ok(payload
        .web
        .map(|web| web.results)
        .unwrap_or_default()
        .into_iter()
        .take(count as usize)
        .filter_map(|result| {
            let url = sanitize_http_url(result.url, true)?;
            Some(WebSearchHit {
                title: bounded_text(result.title, 300),
                url,
                description: result.description.map(|value| bounded_text(value, 1_000)),
                age: result.age.map(|value| bounded_text(value, 80)),
                favicon: result
                    .profile
                    .and_then(|profile| profile.img)
                    .and_then(|value| sanitize_http_url(value, false)),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_query_bounds() {
        assert!(validate_query("a").is_err());
        assert_eq!(
            validate_query("  volt launcher  ").unwrap(),
            "volt launcher"
        );
        assert!(validate_query(&"x".repeat(513)).is_err());
    }

    #[test]
    fn validates_locale_parameters() {
        assert_eq!(
            validate_country(Some("fr".to_string())).unwrap(),
            Some("FR".to_string())
        );
        assert!(validate_country(Some("France".to_string())).is_err());
        assert_eq!(
            validate_language(Some("FR".to_string())).unwrap(),
            Some("fr".to_string())
        );
        assert!(validate_language(Some("fr-FR".to_string())).is_err());
        assert!(validate_language(Some("fr_FR".to_string())).is_err());
    }

    #[test]
    fn only_accepts_bounded_freshness_values() {
        assert_eq!(
            validate_freshness(Some("pw".to_string())).unwrap(),
            Some("pw".to_string())
        );
        assert!(validate_freshness(Some("all".to_string())).is_err());
    }

    #[test]
    fn sanitizes_upstream_urls() {
        assert!(sanitize_http_url("https://example.com/page".to_string(), true).is_some());
        assert!(sanitize_http_url("javascript:alert(1)".to_string(), true).is_none());
        assert!(sanitize_http_url("http://asset.localhost/icon".to_string(), false).is_none());
        assert!(sanitize_http_url("http://127.0.0.1/icon".to_string(), false).is_none());
    }

    #[test]
    fn only_allows_supported_search_engines() {
        assert!(is_supported_search_engine("google"));
        assert!(is_supported_search_engine("bing"));
        assert!(is_supported_search_engine("duckduckgo"));
        assert!(!is_supported_search_engine("custom"));
    }

    #[test]
    fn validates_browser_urls() {
        assert!(validate_url_to_open("https://example.com/search?q=volt".to_string()).is_ok());
        assert!(validate_url_to_open("http://localhost:3000".to_string()).is_ok());
        assert!(validate_url_to_open("file:///tmp/private".to_string()).is_err());
        assert!(validate_url_to_open("javascript:alert(1)".to_string()).is_err());
    }
}
