# Edge Chat Sidebar

这是一个 Microsoft Edge 侧栏扩展，可以在浏览器侧栏中调用 LLM API 进行多轮对话。

## 安装

1. 打开 Edge，进入 `edge://extensions/`。
2. 打开“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本文件夹：`{YOUR_PATH}\EdgeChatSidebar`。
5. 点击浏览器工具栏中的扩展按钮，即可打开侧栏。

## 使用

1. 在侧栏右上角打开设置。
2. 选择主题：跟随系统、浅色或深色。
3. 可选填写系统提示词。
4. 如需使用小米 MiMo 联网搜索，选择“自动判断”或“强制搜索”。
5. 如需配置模型 API，展开“高级模型 API”，分别维护 DeepSeek 和小米 MiMo 的 API Key 与 Endpoint。
6. 保存后开始对话。
7. 点击左下角模型按钮展开列表，可手动选择 DeepSeek 或小米 MiMo 的具体模型，默认使用 DeepSeek。
8. 选择 `mimo-v2.5` 时，可在输入框中直接粘贴 PNG、JPEG 或 WebP 图片并随消息发送。

## 说明

- API Key 保存在浏览器本地扩展存储中，不会写入项目文件。
- Chat Completions API 是无状态接口，所以扩展会把历史消息一起发送，以支持多轮对话。
- 默认 DeepSeek 请求地址为 `https://api.deepseek.com/chat/completions`。
- 默认小米 MiMo 请求地址为 `https://api.xiaomimimo.com/v1/chat/completions`，模型可在左下角模型菜单中选择 `mimo-v2.5` 或 `mimo-v2.5-pro`。
- 小米 MiMo 的 API Key 在请求中按官方 OpenAI 兼容接口示例通过 `api-key` 请求头发送。
- 小米 MiMo 联网搜索按官方 OpenAI 兼容接口通过 `tools: [{ type: "web_search" }]` 启用；使用前需要在小米 MiMo 开放平台的插件管理中启用 Web Search Plugin。自动判断模式由模型决定是否搜索，强制搜索模式会在每轮 MiMo 请求中要求搜索。
- 小米 MiMo `mimo-v2.5` 支持粘贴图片发送。扩展会把图片保存为 base64 Data URL，并按官方 OpenAI 兼容多模态消息格式发送：`content: [{ type: "text", text }, { type: "image_url", image_url: { url: "data:image/...;base64,..." } }]`。每条消息最多 4 张图片，单张不超过 5MB。
- 小米 MiMo 官方文档入口：[First API Call](https://platform.xiaomimimo.com/static/docs/quick-start/first-api-call.md)、[Model](https://platform.xiaomimimo.com/static/docs/quick-start/model.md)。
- 已支持 DeepSeek 流式输出和 thinking mode；回答会边生成边显示，思考过程会在回答上方以折叠区展示。
- 思考过程只用于本地展示和历史记录，不会作为下一轮请求消息发送给模型 API。
- 当前模型使用 DeepSeek V4：`deepseek-v4-flash` 和 `deepseek-v4-pro`。旧模型名 `deepseek-chat` / `deepseek-reasoner` 将于 2026-07-24 15:59 UTC 弃用。

## 第三方依赖与许可

- 本项目在 `vendor/katex/` 中内置 KaTeX `0.16.11` 的浏览器运行资源，用于在扩展侧栏中渲染 Markdown 消息里的 LaTeX 公式。
- KaTeX 使用 MIT License。许可证文本已随资源保留在 `vendor/katex/LICENSE`。
- 分发或修改本扩展时，请保留 `vendor/katex/LICENSE` 以及 KaTeX 相关版权与许可声明。
- KaTeX 项目地址：https://katex.org/
