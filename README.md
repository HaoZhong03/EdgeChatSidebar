# Edge Sidebar Chat

这是一个 Microsoft Edge 侧栏扩展，可以在浏览器侧栏中调用 LLM API 进行多轮对话。

## 安装

1. 打开 Edge，进入 `edge://extensions/`。
2. 打开“开发人员模式”。
3. 点击“加载解压缩的扩展”。
4. 选择本文件夹：`C:\Users\25026\Documents\EdgeChatSidebar`。
5. 点击浏览器工具栏中的扩展按钮，即可打开侧栏。

## 使用

1. 在侧栏右上角打开设置。
2. 填入 DeepSeek API Key。
3. 选择模型，默认是 `deepseek-v4-flash`；需要更强能力时可选 `deepseek-v4-pro`。
4. 选择主题：跟随系统、浅色或深色。
5. 可选填写系统提示词。
6. 保存后开始对话。

## 说明

- API Key 保存在浏览器本地扩展存储中，不会写入项目文件。
- DeepSeek Chat Completions API 是无状态接口，所以扩展会把历史消息一起发送，以支持多轮对话。
- 当前请求地址为 `https://api.deepseek.com/chat/completions`。
- 当前模型使用 DeepSeek V4：`deepseek-v4-flash` 和 `deepseek-v4-pro`。旧模型名 `deepseek-chat` / `deepseek-reasoner` 将于 2026-07-24 15:59 UTC 弃用。
