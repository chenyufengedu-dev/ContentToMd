# ContentToMd

**把每天遇到的好东西，变成自己的知识库。**

刷到有用的视频、随手截的图、存下的文档，ContentToMd 把它们整理成 Markdown 笔记，按领域归档，放进你的 Obsidian 或自己选择的文件夹，长期积累、随时查找。

![Windows](https://img.shields.io/badge/Windows-10%2F11%20x64-0078D4)
![Version](https://img.shields.io/badge/version-0.1.0-5b5bd6)
[![License](https://img.shields.io/badge/license-MIT-1f2937)](LICENSE)

<!-- 演示动图占位：![ContentToMd 使用演示](assets/screenshots/demo.gif) -->

![ContentToMd 笔记编辑界面](assets/screenshots/note.png)

## 为什么做它

我对很多事情都好奇，看到值得学的就截图、存文档、下载视频。可存下来的东西散在各处，很少再打开，更谈不上变成自己的知识。

ContentToMd 想补上中间这一步：**收藏 → 整理 → 归档 → 积累**。AI 负责把内容理成笔记，我负责核对和决定留下什么，最后它们都进了同一个知识库。

## 有什么不同

- **一个入口，收多种内容。** 视频、音频、截图、可提取文字的 PDF、Word（DOCX）和文本，都能从同一个窗口导入，整理成统一格式的笔记。
- **知识库会自己长结构。** 笔记按领域归档，也能添加标签；没有合适的领域时，AI 会建议新领域，你点头才创建。
- **核对后才入库。** 原文和笔记并排，改好再存，库里留下的是你确认过的东西。
- **直接接上 Obsidian。** 笔记是普通 Markdown 加附件，存进 Obsidian 库就能用，可以继续链接、搜索、整理。不用注册 ContentToMd 账号，软件没有自己的服务器，文件永远是你的。
- **用自己的密钥，按量付费。** 软件免费，少量文字整理大约一条一分钱。

## 怎么用

1. **安装。** 运行 Windows 10/11 x64 安装包，安装包暂由作者提供。
2. **配置。** 跟随引导选择收藏库、填写 AI 密钥。[DeepSeek](https://platform.deepseek.com/api_keys) 用于文字和看图，[硅基流动](https://cloud.siliconflow.cn/account/ak) 用于音视频转写：注册登录 → 按需充值 → 创建并复制密钥。也可在设置中配置其他兼容服务。
3. **整理。** 拖入、粘贴或选择内容，选用要点提炼、原文精修或视觉收藏，检查后保存。支持图片、音视频、MD/TXT、可提取文字的 PDF 和 DOCX。

## 费用与隐私

以 DeepSeek Flash 输入 3000、输出 1000 tokens 为例，不计缓存优惠约 **0.007～0.014 元**，以[服务商定价和账单](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)为准。填好单价后，保存时显示单条估算，设置页可查看本月和累计费用。

处理时，本次内容、整理要求和领域、标签名称会发给你配置的 AI 服务；不发送其他笔记正文。密钥只保存在本机 Windows 凭据管理器中。

笔记和附件在你选择的收藏库，软件配置在 `%APPDATA%\ContentToMd\`。覆盖升级保留数据；卸载时保留收藏库，清除软件自身数据和密钥。

## 常见问题

**能直接下载平台视频吗？** 不能。请先准备本地音视频文件，再拖入软件。

**有 Mac 版吗？** 目前只提供 Windows 版。

**安装时提示“已保护你的电脑”怎么办？** 软件尚未签名。核对安装包来源后，点“更多信息 → 仍要运行”。

## 反馈与许可证

遇到问题或有建议，请通过 **设置 → 关于 → 反馈问题**，或提交 [GitHub Issue](https://github.com/chenyufengedu-dev/ContentToMd/issues)。请附截图和软件版本，不要附密钥或私人笔记。

代码采用 [MIT](LICENSE)，作者 **Caraxes**；内置思源黑体子集采用 [SIL OFL 1.1](src/assets/fonts/OFL.txt)。
