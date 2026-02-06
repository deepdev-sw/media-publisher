console.log("Publisher Injected");

window.addEventListener('load', async () => {
    const data = window.__PUBLISH_DATA__;
    if (!data) {
        console.warn("No publish data found in window.__PUBLISH_DATA__");
        return;
    }

    // Helper functions
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    // Base64 to File
    function base64ToFile(base64, filename, mimeType) {
        const byteCharacters = atob(base64);
        const byteArrays = [];
        const sliceSize = 512;

        for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
            const slice = byteCharacters.slice(offset, offset + sliceSize);
            const byteNumbers = new Array(slice.length);
            for (let i = 0; i < slice.length; i++) {
                byteNumbers[i] = slice.charCodeAt(i);
            }
            const byteArray = new Uint8Array(byteNumbers);
            byteArrays.push(byteArray);
        }

        const blob = new Blob(byteArrays, { type: mimeType });
        return new File([blob], filename, { type: mimeType });
    }

    // Prepare files
    let filesToUpload = [];
    if (data.file_contents && data.file_contents.length > 0) {
        try {
            console.log(`Preparing ${data.file_contents.length} files...`);
            filesToUpload = data.file_contents.map((b64, i) => {
                return base64ToFile(b64, data.file_names[i], data.file_mimes[i]);
            });
            console.log("Files ready:", filesToUpload);
        } catch (e) {
            console.error("Failed to process files:", e);
        }
    }

    // Floating Helper UI
    const helper = document.createElement('div');
    helper.style.position = 'fixed';
    helper.style.top = '10px';
    helper.style.left = '50%';
    helper.style.transform = 'translateX(-50%)';
    helper.style.background = 'rgba(0,0,0,0.85)';
    helper.style.color = 'white';
    helper.style.padding = '12px 20px';
    helper.style.borderRadius = '8px';
    helper.style.zIndex = '999999';
    helper.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    helper.style.fontFamily = 'sans-serif';
    helper.style.minWidth = '300px';
    helper.innerHTML = `
        <div style="font-weight:bold; margin-bottom:8px; border-bottom:1px solid #555; padding-bottom:4px;">自动发布助手</div>
        <div id="status-msg" style="font-size:12px; margin-bottom:8px; line-height:1.4;">正在初始化...</div>
        <div id="progress-bar" style="height:4px; background:#333; width:100%; border-radius:2px; margin-bottom:8px; display:none;">
            <div id="progress-val" style="height:100%; background:#fe2c55; width:0%; border-radius:2px; transition:width 0.3s;"></div>
        </div>
    `;
    document.body.appendChild(helper);

    const updateStatus = (msg, color = 'white', progress = -1) => {
        const el = document.getElementById('status-msg');
        if (el) {
            el.innerText = msg;
            el.style.color = color;
        }
        const bar = document.getElementById('progress-bar');
        const val = document.getElementById('progress-val');
        if (progress >= 0) {
            bar.style.display = 'block';
            val.style.width = `${progress}%`;
        } else {
            bar.style.display = 'none';
        }
    };

    // --- Logic ---

    // State Machine
    const STATE = {
        INIT: 'INIT',
        NAVIGATE_TAB: 'NAVIGATE_TAB',
        UPLOAD: 'UPLOAD',
        WAIT_EDITOR: 'WAIT_EDITOR',
        FILL_FORM: 'FILL_FORM',
        DONE: 'DONE',
        ERROR: 'ERROR'
    };

    let currentState = STATE.INIT;
    let retryCount = 0;
    const MAX_RETRIES = 20;

    function findTabElement() {
        // Find the tab that says "发布图文"
        // It might be a div, span, or li
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (node.textContent.trim() === '发布图文') {
                // Return the clickable ancestor (usually a div with role tab or similar)
                let el = node.parentElement;
                while (el && el !== document.body) {
                    if (el.tagName === 'DIV' || el.tagName === 'LI' || el.getAttribute('role') === 'tab') {
                        return el;
                    }
                    el = el.parentElement;
                }
                return node.parentElement; // Fallback
            }
        }
        return null;
    }

    function findFileInput() {
        const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
        // Prioritize inputs that accept images
        return inputs.find(i => i.accept && i.accept.includes('image')) || inputs[0];
    }

    function findUploadZone() {
        // Look for "点击上传" or "拖入此区域"
        const keywords = ['点击上传', '拖入此区域', '上传图文'];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
        let node;
        while (node = walker.nextNode()) {
            if (keywords.some(k => node.textContent.includes(k))) {
                // We need the drop zone container
                let el = node.parentElement;
                // Go up until we find a container that looks like a drop zone (often has event listeners we can't see, but usually block level)
                // Heuristic: look for class with 'upload' or just go up 3-4 levels to be safe
                let depth = 0;
                while (el && el !== document.body && depth < 5) {
                    // If it's an input type file, we can't drop on it directly usually, we drop on label
                    if (el.tagName === 'LABEL' || (el.className && typeof el.className === 'string' && el.className.includes('upload'))) {
                        return el;
                    }
                    el = el.parentElement;
                    depth++;
                }
                // If heuristic fails, return the parent of the text, but drag events might bubble
                return node.parentElement.parentElement; 
            }
        }
        
        // Fallback: search for input type file's label
        const fileInput = document.querySelector('input[type="file"]');
        if (fileInput) {
            // Find its label or container
            // Often the input is hidden and the label is visible
            return fileInput.parentElement;
        }

        return null;
    }

    function findTitleElement() {
        const candidates = Array.from(document.querySelectorAll('input, textarea'));
        const keywords = ['标题', 'title', '填写', '添加'];
        let target = candidates.find(el => {
            if (!el.placeholder) return false;
            return keywords.some(k => el.placeholder.includes(k));
        });
        if (target) return target;
        return candidates.find(el => (el.className || '').toLowerCase().includes('title'));
    }

    function findDescriptionElement() {
        const editables = Array.from(document.querySelectorAll('[contenteditable="true"]'));
        if (editables.length > 0) {
            editables.sort((a, b) => (b.offsetHeight * b.offsetWidth) - (a.offsetHeight * a.offsetWidth));
            return editables[0];
        }
        const textareas = Array.from(document.querySelectorAll('textarea'));
        const titleEl = findTitleElement();
        return textareas.find(el => el !== titleEl && el.offsetHeight > 50);
    }

    function isLoginPage() {
        const text = document.body.innerText;
        return text.includes('扫码登录') || text.includes('验证码登录') || text.includes('手机号登录');
    }

    async function processLoop() {
        console.log(`State: ${currentState}, Retry: ${retryCount}`);
        console.log(`Current URL: ${window.location.href}`);
        switch (currentState) {
            case STATE.INIT:
                updateStatus("初始化中...");
               
                currentState = STATE.NAVIGATE_TAB;
                retryCount = 0;
                break;

            case STATE.NAVIGATE_TAB:
                if (!window.location.href.includes('/creator-micro/content/upload') || isLoginPage()) {
                    updateStatus("等待进入发布页面(请先登录)...", "#fca311");
                    await sleep(1000);
                    return;
                }

                updateStatus("正在寻找“发布图文”标签...");
                const tab = findTabElement();
                if (tab) {
                    console.log("Found tab:", tab);
                    tab.click();
                    updateStatus("已点击“发布图文”标签", "#4cc9f0");
                    await sleep(1000); // Wait for switch
                    currentState = STATE.UPLOAD;
                    retryCount = 0;
                } else {
                    retryCount++;
                    if (retryCount > MAX_RETRIES) {
                        updateStatus("找不到“发布图文”标签，请手动切换", "#ff006e");
                        // Don't stop, maybe user is already there or will switch manually
                        currentState = STATE.UPLOAD; 
                        retryCount = 0;
                    }
                }
                break;

            case STATE.UPLOAD:
                // Check if already in editor mode (maybe user uploaded manually or skipped)
                // if (findTitleElement()) {
                //     currentState = STATE.FILL_FORM;
                //     return;
                // }

                if (filesToUpload.length === 0) {
                    updateStatus("无文件可上传，跳过上传步骤", "#fca311");
                    currentState = STATE.WAIT_EDITOR;
                    return;
                }

                updateStatus(`准备上传 ${filesToUpload.length} 个文件...`);

                // Strategy 1: Direct Input Manipulation (More reliable)
                const fileInput = findFileInput();
                if (fileInput) {
                     console.log("Found file input:", fileInput);
                     try {
                        const dataTransfer = new DataTransfer();
                        filesToUpload.forEach(f => dataTransfer.items.add(f));
                        fileInput.files = dataTransfer.files;
                        fileInput.dispatchEvent(new Event('change', { bubbles: true }));
                        fileInput.dispatchEvent(new Event('input', { bubbles: true }));
                        
                        updateStatus("已触发文件选择事件", "#4cc9f0");
                        await sleep(2000);
                        currentState = STATE.WAIT_EDITOR;
                        retryCount = 0;
                        break; // Exit case
                     } catch (e) {
                         console.error("Input upload failed:", e);
                         // Fallthrough to drag and drop
                     }
                }

                const zone = findUploadZone();
                if (zone) {
                    console.log("Found upload zone:", zone);
                    
                    // Simulate Drag and Drop
                    try {
                        const dataTransfer = new DataTransfer();
                        filesToUpload.forEach(f => dataTransfer.items.add(f));

                        const events = ['dragenter', 'dragover', 'drop'];
                        events.forEach(type => {
                            const event = new DragEvent(type, {
                                bubbles: true,
                                cancelable: true,
                                dataTransfer: dataTransfer
                            });
                            zone.dispatchEvent(event);
                        });
                        
                        updateStatus("已触发上传事件", "#4cc9f0");
                        // Clear files to prevent re-upload loop if we stay in this state
                        // But wait, if it fails we might want to retry?
                        // Let's assume success moves us to next state via detection
                        await sleep(2000); 
                        currentState = STATE.WAIT_EDITOR;
                        retryCount = 0;
                    } catch (e) {
                        console.error("Upload error:", e);
                        updateStatus("自动上传出错: " + e.message, "#ff006e");
                    }
                } else {
                    retryCount++;
                    if (retryCount > MAX_RETRIES) {
                        updateStatus("找不到上传区域，请手动上传", "#ff006e");
                        currentState = STATE.WAIT_EDITOR; // Fallback
                    }
                }
                break;

            case STATE.WAIT_EDITOR:
                updateStatus("等待进入编辑界面...", "white", (retryCount % 10) * 10);
                if (findTitleElement()) {
                    currentState = STATE.FILL_FORM;
                    retryCount = 0;
                } else {
                    retryCount++;
                    // Keep waiting indefinitely? Or warn user?
                    if (retryCount > 60) { // 1 minute
                        updateStatus("等待超时，请检查是否上传成功", "#fca311");
                    }
                }
                break;

            case STATE.FILL_FORM:
                updateStatus("正在填充内容...");
                let filled = false;
                
                const titleEl = findTitleElement();
                if (titleEl && data.title) {
                    titleEl.focus();
                    // Try setter
                    let setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                    if (!setter && titleEl instanceof HTMLTextAreaElement) {
                        setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
                    }
                    
                    if (setter) {
                        setter.call(titleEl, data.title);
                    } else {
                        titleEl.value = data.title;
                    }
                    titleEl.dispatchEvent(new Event('input', { bubbles: true }));
                    filled = true;
                }

                const descEl = findDescriptionElement();
                if (descEl && data.description) {
                    // Clean description: remove [话题] artifact
                    const cleanDescription = data.description.replace(/\[话题\]#/g, '');

                    descEl.click();
                    descEl.focus();
                    if (descEl.isContentEditable) {
                        descEl.innerText = cleanDescription;
                    } else {
                        descEl.value = cleanDescription;
                    }
                    descEl.dispatchEvent(new Event('input', { bubbles: true }));
                    filled = true;
                }

                if (filled) {
                    updateStatus("发布信息已填充完成！", "#4cc9f0");
                    currentState = STATE.DONE;
                } else {
                    retryCount++;
                    if (retryCount > 10) {
                        updateStatus("填充失败，请检查控制台", "#ff006e");
                        currentState = STATE.ERROR;
                    }
                }
                break;

            case STATE.DONE:
                // Do nothing
                break;
        }
    }

    // Start Loop
    setInterval(processLoop, 1000);

});
