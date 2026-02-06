# Media Publisher (小红书转抖音自动发布工具)

本项目是一个基于 Tauri 和 Vue 3 开发的桌面端应用，旨在帮助内容创作者高效地将小红书的图文/视频内容迁移并发布至抖音平台。通过自动化脚本技术，实现“输入链接 -> 内容抓取 -> 自动填充发布”的一站式流程。

## ✨ 核心功能

*   **链接解析**：支持识别小红书 App 分享短链接及网页长链接。
*   **内容抓取**：
    *   自动下载高清图片
    *   提取笔记标题和正文文案。
*   **本地管理**：提供本地资源缓存与管理功能。
*   **自动发布**：
    *   集成抖音创作者中心登录。
    *   自动填充标题、文案及上传素材。
    *   模拟人工操作，降低风控风险。

## 🛠 技术栈

*   **Frontend**: [Vue 3](https://vuejs.org/) + [TypeScript](https://www.typescriptlang.org/) + [TailwindCSS](https://tailwindcss.com/)
*   **Backend**: [Tauri 2.0](https://tauri.app/) (Rust)
*   **Automation**: Tauri Webview + JS Injection

## 🚀 快速开始

### 环境要求

确保您的开发环境已安装以下工具：

*   [Node.js](https://nodejs.org/) (推荐 LTS 版本)
*   [Rust](https://www.rust-lang.org/tools/install) (及 Cargo)
*   包管理器 (npm, pnpm 或 yarn)

### 安装依赖

```bash
# 安装前端依赖
npm install
```

### 开发模式

启动开发服务器（包含前端热重载和 Tauri 窗口）：

```bash
npm run tauri dev
```

### 构建应用

打包生成生产环境的应用程序：

```bash
npm run tauri build
```

## ⚠️ 免责声明

本项目仅供学习和技术研究使用。

1.  请确保抓取和发布的内容符合相关平台（小红书、抖音）的用户协议。
2.  请勿用于侵犯他人版权或进行大规模自动化滥用，由此产生的法律风险由使用者自行承担。
3.  建议仅用于搬运自己拥有版权的内容或经授权的内容。

## 📄 许可证

[MIT License](LICENSE)
