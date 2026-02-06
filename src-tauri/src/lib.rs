use tauri::{AppHandle, Manager, Emitter, WebviewWindowBuilder, WebviewUrl};
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use reqwest::Client;
use url::Url;
use scraper::{Html, Selector};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ScrapedData {
    pub title: String,
    pub description: String,
    pub images: Vec<String>,
    pub video: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PublishData {
    pub title: String,
    pub description: String,
    pub files: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PublishDataWithContent {
    pub title: String,
    pub description: String,
    pub file_contents: Vec<String>, // Base64
    pub file_names: Vec<String>,
    pub file_mimes: Vec<String>,
}

fn base64_encode(data: &[u8]) -> String {
    const ALPHABET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity((data.len() + 2) / 3 * 4);
    
    for chunk in data.chunks(3) {
        let b = match chunk.len() {
            3 => ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8) | (chunk[2] as u32),
            2 => ((chunk[0] as u32) << 16) | ((chunk[1] as u32) << 8),
            1 => (chunk[0] as u32) << 16,
            _ => 0,
        };
        
        output.push(ALPHABET[((b >> 18) & 0x3F) as usize] as char);
        output.push(ALPHABET[((b >> 12) & 0x3F) as usize] as char);
        
        if chunk.len() > 1 {
            output.push(ALPHABET[((b >> 6) & 0x3F) as usize] as char);
        } else {
            output.push('=');
        }
        
        if chunk.len() > 2 {
            output.push(ALPHABET[(b & 0x3F) as usize] as char);
        } else {
            output.push('=');
        }
    }
    output
}

#[tauri::command]
async fn open_scraper_window(app: AppHandle, url: String) -> Result<(), String> {
    let client = Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    let html_content = client.get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;

    let mut title = String::new();
    let mut description = String::new();
    let mut images = Vec::new();

    // Try to parse from JSON in window.__INITIAL_STATE__
    if let Some(start_idx) = html_content.find("window.__INITIAL_STATE__=") {
        if let Some(end_idx) = html_content[start_idx..].find("</script>") {
            let json_str = &html_content[start_idx + 25 .. start_idx + end_idx];
            let clean_json = json_str.trim().trim_end_matches(';').replace("undefined", "null");
            
            if let Ok(state) = serde_json::from_str::<Value>(&clean_json) {
                 if let Some(note_map) = state.get("note").and_then(|n| n.get("noteDetailMap")).and_then(|m| m.as_object()) {
                     // Get the first note
                     if let Some(detail) = note_map.values().next() {
                         if let Some(note) = detail.get("note") {
                             // Title
                             if let Some(t) = note.get("title").and_then(|v| v.as_str()) {
                                 title = t.to_string();
                             }
                             // Description
                             if let Some(d) = note.get("desc").and_then(|v| v.as_str()) {
                                 description = d.to_string();
                             }
                             // Images
                             if let Some(img_list) = note.get("imageList").and_then(|v| v.as_array()) {
                                 for img in img_list {
                                     if let Some(url) = img.get("urlDefault").and_then(|v| v.as_str()) {
                                         images.push(url.to_string());
                                     }
                                 }
                             }
                         }
                     }
                 }
            }
        }
    }

    let document = Html::parse_document(&html_content);

    // Fallback for Title
    if title.is_empty() {
        let title_selector = Selector::parse("title").map_err(|e| e.to_string())?;
        let fallback_title_selector = Selector::parse(".title, #detail-title").map_err(|e| e.to_string())?;
        
        title = document.select(&title_selector).next()
            .map(|el| el.text().collect::<Vec<_>>().join(""))
            .unwrap_or_default();
        
        if title.is_empty() {
            title = document.select(&fallback_title_selector).next()
                .map(|el| el.text().collect::<Vec<_>>().join(""))
                .unwrap_or_default();
        }
    }

    // Fallback for Description
    if description.is_empty() {
        let meta_desc_selector = Selector::parse("meta[name='description']").map_err(|e| e.to_string())?;
        let fallback_desc_selector = Selector::parse(".desc, #detail-desc, .content").map_err(|e| e.to_string())?;

        description = document.select(&meta_desc_selector).next()
            .and_then(|el| el.value().attr("content"))
            .map(|s| s.to_string())
            .unwrap_or_default();

        if description.is_empty() {
            description = document.select(&fallback_desc_selector).next()
                .map(|el| el.text().collect::<Vec<_>>().join(""))
                .unwrap_or_default();
        }
    }

    // Images fallback
    if images.is_empty() {
        let img_selector = Selector::parse(".note-slider-img, .swiper-slide img, .note-content img").map_err(|e| e.to_string())?;
        for element in document.select(&img_selector) {
            if let Some(src) = element.value().attr("src") {
                 if !src.contains("avatar") && !src.contains("data:") {
                    images.push(src.to_string());
                 }
            } else if let Some(style) = element.value().attr("style") {
                if style.contains("background-image") && style.contains("url(") {
                    let parts: Vec<&str> = style.split("url(").collect();
                    if parts.len() > 1 {
                        let url_part = parts[1].split(')').next().unwrap_or("");
                        let url_clean = url_part.trim_matches(|c| c == '"' || c == '\'');
                        if !url_clean.is_empty() {
                             images.push(url_clean.to_string());
                        }
                    }
                }
            }
        }
    }
    
    images.sort();
    images.dedup();

    let data = ScrapedData {
        title,
        description,
        images,
        video: None,
    };

    app.emit("scraped-data", &data).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn download_assets(app: AppHandle, urls: Vec<String>) -> Result<Vec<String>, String> {
    let cache_dir = app.path().app_cache_dir().map_err(|e| e.to_string())?;
    if !cache_dir.exists() {
        fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    }

    let mut local_paths = Vec::new();
    let client = Client::new();

    for url in urls {
        let filename = url.split('/').last().unwrap_or("image.jpg").split('?').next().unwrap_or("image.jpg");
        let path = cache_dir.join(filename);
        
        // Skip if exists? Or overwrite. Overwrite for now.
        let bytes = client.get(&url).send().await.map_err(|e| e.to_string())?
            .bytes().await.map_err(|e| e.to_string())?;
            
        fs::write(&path, bytes).map_err(|e| e.to_string())?;
        local_paths.push(path.to_string_lossy().to_string());
    }

    Ok(local_paths)
}

#[tauri::command]
async fn open_publisher_window(app: AppHandle, data: PublishData) -> Result<(), String> {
    let window_label = "publisher";
    
    if let Some(window) = app.get_webview_window(window_label) {
        let _ = window.close();
    }

    // Process files into Base64
    let mut file_contents = Vec::new();
    let mut file_names = Vec::new();
    let mut file_mimes = Vec::new();

    for path_str in &data.files {
        let path = PathBuf::from(path_str);
        if path.exists() {
            if let Ok(bytes) = fs::read(&path) {
                file_contents.push(base64_encode(&bytes));
                
                let mut filename = path.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                
                // Magic bytes check for accurate MIME type
                let mime = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
                    "image/jpeg"
                } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
                    "image/png"
                } else if bytes.len() > 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
                    "image/webp"
                } else {
                    // Fallback to extension check
                    if filename.ends_with(".png") {
                        "image/png"
                    } else if filename.ends_with(".jpg") || filename.ends_with(".jpeg") {
                        "image/jpeg"
                    } else if filename.ends_with(".webp") {
                        "image/webp"
                    } else {
                        "application/octet-stream"
                    }
                };

                // Ensure filename has correct extension based on MIME type
                if mime == "image/jpeg" && !filename.to_lowercase().ends_with(".jpg") && !filename.to_lowercase().ends_with(".jpeg") {
                    filename.push_str(".jpg");
                } else if mime == "image/png" && !filename.to_lowercase().ends_with(".png") {
                    filename.push_str(".png");
                } else if mime == "image/webp" && !filename.to_lowercase().ends_with(".webp") {
                    filename.push_str(".webp");
                }
                
                file_names.push(filename);
                file_mimes.push(mime.to_string());
            }
        }
    }

    let data_with_content = PublishDataWithContent {
        title: data.title,
        description: data.description,
        file_contents,
        file_names,
        file_mimes,
    };

    let url = "https://creator.douyin.com/creator-micro/content/upload";
    
    const STEALTH_SCRIPT: &str = r#"
        console.log("Applying stealth scripts...");
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined,
        });
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5],
        });
        Object.defineProperty(navigator, 'languages', {
            get: () => ['zh-CN', 'zh', 'en'],
        });
    "#;

    let init_script = format!(
        "{}\nwindow.__PUBLISH_DATA__ = {};\n{}", 
        STEALTH_SCRIPT,
        serde_json::to_string(&data_with_content).unwrap_or("{}".to_string()),
        include_str!("../scripts/publisher.js")
    );

    let win_builder = WebviewWindowBuilder::new(
        &app,
        window_label,
        WebviewUrl::External(Url::parse(url).unwrap())
    )
    .title("Douyin Publisher")
    .inner_size(1200.0, 800.0)
    .user_agent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36")
    .initialization_script(&init_script);

    let window = win_builder.build().map_err(|e| e.to_string())?;

    let app_handle = app.clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let _ = app_handle.emit("publisher-closed", ());
        }
    });

    #[cfg(debug_assertions)]
    window.open_devtools();

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            open_scraper_window,
            download_assets,
            open_publisher_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
