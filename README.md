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
4. 如需配置模型 API，展开“高级模型 API”，分别维护 DeepSeek 和小米 MiMo 的 API Key 与 Endpoint。
5. 保存后开始对话。
6. 点击左下角模型按钮展开列表，可手动选择 DeepSeek 或小米 MiMo 的具体模型，默认使用 DeepSeek。

## 说明

- API Key 保存在浏览器本地扩展存储中，不会写入项目文件。
- Chat Completions API 是无状态接口，所以扩展会把历史消息一起发送，以支持多轮对话。
- 默认 DeepSeek 请求地址为 `https://api.deepseek.com/chat/completions`。
- 默认小米 MiMo 请求地址为 `https://api.xiaomimimo.com/v1/chat/completions`，模型可在左下角模型菜单中选择 `mimo-v2.5` 或 `mimo-v2.5-pro`。
- 小米 MiMo 的 API Key 在请求中按官方 OpenAI 兼容接口示例通过 `api-key` 请求头发送。
- 已支持 DeepSeek 流式输出和 thinking mode；回答会边生成边显示，思考过程会在回答上方以折叠区展示。
- 思考过程只用于本地展示和历史记录，不会作为下一轮请求消息发送给模型 API。
- 当前模型使用 DeepSeek V4：`deepseek-v4-flash` 和 `deepseek-v4-pro`。旧模型名 `deepseek-chat` / `deepseek-reasoner` 将于 2026-07-24 15:59 UTC 弃用。

## 第三方依赖与许可

- 本项目在 `vendor/katex/` 中内置 KaTeX `0.16.11` 的浏览器运行资源，用于在扩展侧栏中渲染 Markdown 消息里的 LaTeX 公式。
- KaTeX 使用 MIT License。许可证文本已随资源保留在 `vendor/katex/LICENSE`。
- 分发或修改本扩展时，请保留 `vendor/katex/LICENSE` 以及 KaTeX 相关版权与许可声明。
- KaTeX 项目地址：https://katex.org/
