<script setup lang="ts">
import { ref, onMounted } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Types
interface ScrapedData {
  title: string;
  description: string;
  images: string[];
  video: string | null;
}

// State
const xhsUrl = ref("");
const status = ref("就绪");
const scrapedData = ref<ScrapedData | null>(null);
const localImages = ref<string[]>([]);
const isProcessing = ref(false);
const isPublishing = ref(false);
const previewImage = ref<string | null>(null);

// Logs
const logs = ref<string[]>([]);
const log = (msg: string) => {
  logs.value.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  status.value = msg;
};

function moveImage(index: number, direction: 'left' | 'right') {
  if (!scrapedData.value) return;
  
  const newIndex = direction === 'left' ? index - 1 : index + 1;
  
  // Boundary checks
  if (newIndex < 0 || newIndex >= scrapedData.value.images.length) return;
  
  // Swap in scrapedData
  const temp = scrapedData.value.images[index];
  scrapedData.value.images[index] = scrapedData.value.images[newIndex];
  scrapedData.value.images[newIndex] = temp;
  
  // Swap in localImages if synced
  if (localImages.value.length === scrapedData.value.images.length) {
    const tempLocal = localImages.value[index];
    localImages.value[index] = localImages.value[newIndex];
    localImages.value[newIndex] = tempLocal;
  }
}

onMounted(async () => {
  log("App initialized");
  
  // Listen for publisher window close
  await listen("publisher-closed", () => {
    log("抖音发布窗口已关闭");
    isPublishing.value = false;
  });
  
  // Listen for scraped data from scraper window
  await listen<ScrapedData>("scraped-data", async (event) => {
    log("收到抓取数据!");
    scrapedData.value = event.payload;
    //打印scrapedData.value
    log(JSON.stringify(scrapedData.value));
    
    // Auto download images
    if (scrapedData.value.images.length > 0) {
      log(`开始下载 ${scrapedData.value.images.length} 张图片...`);
      try {
        localImages.value = await invoke("download_assets", { urls: scrapedData.value.images });
        log(`图片下载完成! 保存路径: ${localImages.value[0]} ...`);
      } catch (e) {
        log(`下载失败: ${e}`);
      }
    }
    
    isProcessing.value = false;
  });
});

async function openScraper() {
  if (!xhsUrl.value) {
    alert("请输入小红书链接");
    return;
  }
  
  isProcessing.value = true;
  log("正在打开抓取窗口...");
  
  try {
    await invoke("open_scraper_window", { url: xhsUrl.value });
  } catch (e) {
    log(`打开窗口失败: ${e}`);
    isProcessing.value = false;
  }
}

async function publishToDouyin() {
  if (!scrapedData.value) return;
  
  log("正在打开抖音发布窗口...");
  isPublishing.value = true;
  
  try {
    await invoke("open_publisher_window", { 
      data: {
        title: scrapedData.value.title,
        description: scrapedData.value.description,
        files: localImages.value
      }
    });
    // 成功打开后确保状态为 true
    isPublishing.value = true;
  } catch (e) {
    log(`发布失败: ${e}`);
    isPublishing.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen bg-gray-100 p-8 flex flex-col gap-6">
    <header class="bg-white p-6 rounded-lg shadow-sm">
      <h1 class="text-2xl font-bold text-gray-800">Media Publisher MVP</h1>
      <p class="text-gray-500">小红书 -> 抖音 自动发布工具</p>
    </header>

    <!-- Input Section -->
    <section class="bg-white p-6 rounded-lg shadow-sm flex flex-col gap-4">
      <h2 class="text-lg font-semibold">1. 内容抓取</h2>
      <div class="flex gap-2">
        <input 
          v-model="xhsUrl"
          type="text" 
          placeholder="粘贴小红书笔记链接..." 
          class="flex-1 border rounded px-4 py-2 focus:outline-none focus:ring-2 focus:ring-red-500"
        />
        <button 
          @click="openScraper"
          :disabled="isProcessing"
          class="bg-red-500 hover:bg-red-600 text-white px-6 py-2 rounded font-medium disabled:opacity-50 transition-colors"
        >
          {{ isProcessing ? '抓取中...' : '开始抓取' }}
        </button>
      </div>
    </section>

    <!-- Preview Section -->
    <section v-if="scrapedData" class="bg-white p-6 rounded-lg shadow-sm flex flex-col gap-4">
      <h2 class="text-lg font-semibold">2. 内容预览 & 编辑</h2>
      
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
        <!-- Text Info -->
        <div class="flex flex-col gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">标题</label>
            <input v-model="scrapedData.title" class="w-full border rounded px-3 py-2" />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">描述</label>
            <textarea v-model="scrapedData.description" rows="10" class="w-full border rounded px-3 py-2"></textarea>
          </div>
        </div>
        
        <!-- Media Preview -->
        <div>
           <label class="block text-sm font-medium text-gray-700 mb-1">图片 ({{ scrapedData.images.length }})</label>
           <div class="grid grid-cols-3 gap-3 max-h-96 overflow-y-auto p-2 border rounded bg-gray-50">
             <div v-if="scrapedData.images.length === 0" class="col-span-3 text-center text-gray-400 py-8">
               暂无图片
             </div>
             <div v-for="(img, idx) in scrapedData.images" :key="img" 
                 class="relative w-full pb-[133.33%] bg-gray-200 rounded-lg overflow-hidden cursor-pointer group shadow-sm hover:shadow-md transition-all"
                 @click="previewImage = img">
              <img :src="img" class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
              
              <!-- Left Move Button -->
              <button 
                v-if="idx > 0"
                @click.stop="moveImage(idx, 'left')"
                class="absolute left-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm"
                title="向左移动"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
              </button>

              <!-- Right Move Button -->
              <button 
                v-if="idx < scrapedData.images.length - 1"
                @click.stop="moveImage(idx, 'right')"
                class="absolute right-2 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center bg-black/50 hover:bg-black/70 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all duration-200 backdrop-blur-sm"
                title="向右移动"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>
              </button>
            </div>
           </div>
           <p class="text-xs text-gray-400 mt-2">* 预览使用的是原始网络链接</p>
        </div>
      </div>

      <div class="flex justify-end pt-4 border-t">
        <button 
          @click="publishToDouyin"
          :disabled="isPublishing"
          :class="{'opacity-50 cursor-not-allowed': isPublishing}"
          class="bg-black hover:bg-gray-800 text-white px-8 py-3 rounded font-medium flex items-center gap-2 transition-opacity"
        >
          <span>{{ isPublishing ? '发布中...' : '发布到抖音' }}</span>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
        </button>
      </div>
    </section>

    <!-- Logs -->
    <section class="bg-gray-800 text-green-400 p-4 rounded-lg shadow-sm font-mono text-xs h-40 overflow-y-auto">
      <div v-for="(log, i) in logs" :key="i">{{ log }}</div>
    </section>
    <!-- Image Preview Modal -->
    <div v-if="previewImage" class="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-90" @click="previewImage = null">
      <div class="relative max-w-4xl max-h-screen p-4">
        <img :src="previewImage" class="max-w-full max-h-[90vh] object-contain rounded-lg" />
        <button class="absolute top-4 right-4 text-white hover:text-gray-300" @click.stop="previewImage = null">
          <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
    </div>
  </div>
</template>
