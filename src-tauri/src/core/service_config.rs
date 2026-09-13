//! Runtime configuration for public third-party service clients.
//!
//! The desktop fetches this from VoltLaunchr so source builds do not require
//! project-specific values. The response is deliberately restricted to a
//! Supabase publishable/legacy-anon key. Such a key is observable by every
//! desktop user and must only be used with correctly enforced RLS.

use serde::Deserialize;
use tokio::sync::OnceCell;

const SERVICE_CONFIG_URL: &str = "https://voltlaunchr.com/api/desktop/config";
static SUPABASE_CONFIG: OnceCell<SupabaseConfig> = OnceCell::const_new();

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SupabaseConfig {
    pub supabase_url: String,
    pub supabase_publishable_key: String,
}

fn validate(config: SupabaseConfig) -> Result<SupabaseConfig, String> {
    let parsed = url::Url::parse(&config.supabase_url)
        .map_err(|_| "runtime Supabase URL is invalid".to_string())?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "runtime Supabase URL has no host".to_string())?;
    if parsed.scheme() != "https" || !host.ends_with(".supabase.co") {
        return Err("runtime Supabase URL must be an HTTPS supabase.co project URL".into());
    }

    let key = &config.supabase_publishable_key;
    if !(key.starts_with("sb_publishable_") || key.starts_with("eyJ")) {
        return Err("runtime Supabase key is not publishable".into());
    }
    if key.starts_with("sb_secret_") || key.contains("service_role") {
        return Err("server-side Supabase keys are forbidden in desktop configuration".into());
    }
    Ok(config)
}

pub async fn supabase_config() -> Result<&'static SupabaseConfig, String> {
    SUPABASE_CONFIG
        .get_or_try_init(|| async {
            let response = reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(10))
                .build()
                .map_err(|e| format!("failed to build service-config client: {e}"))?
                .get(SERVICE_CONFIG_URL)
                .send()
                .await
                .map_err(|e| format!("failed to fetch Volt service configuration: {e}"))?;

            if !response.status().is_success() {
                return Err(format!(
                    "Volt service configuration returned {}",
                    response.status()
                ));
            }

            let config = response
                .json::<SupabaseConfig>()
                .await
                .map_err(|e| format!("invalid Volt service configuration: {e}"))?;
            validate(config)
        })
        .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(url: &str, key: &str) -> SupabaseConfig {
        SupabaseConfig {
            supabase_url: url.into(),
            supabase_publishable_key: key.into(),
        }
    }

    #[test]
    fn accepts_only_https_supabase_projects_and_public_keys() {
        assert!(
            validate(config(
                "https://project.supabase.co",
                "sb_publishable_example"
            ))
            .is_ok()
        );
        assert!(validate(config("https://project.supabase.co", "eyJ.legacy.anon")).is_ok());
    }

    #[test]
    fn rejects_server_credentials_and_untrusted_hosts() {
        assert!(validate(config("https://project.supabase.co", "sb_secret_example")).is_err());
        assert!(validate(config("https://attacker.example", "sb_publishable_example")).is_err());
        assert!(
            validate(config(
                "http://project.supabase.co",
                "sb_publishable_example"
            ))
            .is_err()
        );
    }
}
