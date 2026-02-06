console.log("Scraper Injected");

function extractData() {
    console.log("Extracting data...");
    let title = document.title;
    
    // Common XHS selectors (may change)
    // Attempt 1: Meta tags
    const metaDesc = document.querySelector('meta[name="description"]');
    let desc = metaDesc ? metaDesc.content : "";

    // Attempt 2: DOM
    const titleEl = document.querySelector('.title') || document.querySelector('#detail-title');
    if (titleEl) title = titleEl.innerText;

    const descEl = document.querySelector('.desc') || document.querySelector('#detail-desc') || document.querySelector('.content');
    if (descEl) desc = descEl.innerText;

    // Images
    let images = [];
    // Note slider
    const imgEls = document.querySelectorAll('.note-slider-img, .swiper-slide img, .note-content img');
    imgEls.forEach(img => {
        if (img.src && !img.src.includes('avatar') && !img.src.includes('data:')) {
            // Get high res if possible
            images.push(img.src);
        }
    });
    
    // Background images in slider
    const bgEls = document.querySelectorAll('.note-slider-img');
    bgEls.forEach(el => {
        const style = window.getComputedStyle(el);
        const bg = style.backgroundImage;
        if (bg && bg.startsWith('url(')) {
            let url = bg.slice(4, -1).replace(/["']/g, "");
            images.push(url);
        }
    });

    images = [...new Set(images)];

    console.log("Extracted:", { title, desc, images });
    return { title, description: desc, images, video: null };
}

window.addEventListener('DOMContentLoaded', () => {
    // Inject floating button
    const btn = document.createElement('button');
    btn.innerText = "提取内容";
    btn.style.position = "fixed";
    btn.style.bottom = "20px";
    btn.style.right = "20px";
    btn.style.zIndex = "999999";
    btn.style.padding = "12px 24px";
    btn.style.background = "#ff2442";
    btn.style.color = "white";
    btn.style.border = "none";
    btn.style.borderRadius = "20px";
    btn.style.cursor = "pointer";
    btn.style.boxShadow = "0 4px 12px rgba(0,0,0,0.2)";
    btn.style.fontWeight = "bold";
    
    btn.onclick = () => {
        const data = extractData();
        // Use Tauri event emit
        // Note: We need to check how to emit from webview in V2
        // If window.__TAURI__ is available:
        if (window.__TAURI__ && window.__TAURI__.event) {
            window.__TAURI__.event.emit('scraped-data', data);
            btn.innerText = "已提取!";
            setTimeout(() => btn.innerText = "提取内容", 2000);
        } else {
            alert("Tauri API not found! Check console.");
            console.error("window.__TAURI__ is missing");
        }
    };
    
    document.body.appendChild(btn);
});
