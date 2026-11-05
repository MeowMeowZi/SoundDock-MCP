# SoundDock MCP · 声坞

**Give your AI a dock for sound.** 让 AI 直接生成音效、BGM 和旁白，并把 WAV / MP3 保存到本地项目。

这是独立的 **MCP 工具服务器**，不是需要先写文档的工作流，也不是只提供提示词的 Skill。AI 接入后即可按需求调用：描述声音 → 生成 → 获得真实文件路径。无需创建需求、采纳候选或手动下载。

- 音效 / BGM：SeedAudio `seed-audio-1.0`。
- 旁白：火山引擎流式 TTS，显式配置音色；支持语速、采样率和表现力指令。
- 本地 STDIO，无需启动网页、数据库服务或原项目。任务记录使用 Node 内置 SQLite。
- 稳定请求 ID、持久化去重、异常结果待核对，避免 AI 超时后盲目重复付费。

[源码仓库](https://github.com/MeowMeowZi/SoundDock-MCP) · [下载 v0.1.0 ZIP](https://github.com/MeowMeowZi/SoundDock-MCP/releases/download/v0.1.0/sounddock-mcp-0.1.0.zip) · [所有版本](https://github.com/MeowMeowZi/SoundDock-MCP/releases)

## 最简单的用法：把仓库链接交给 AI

把下面这段话发给能操作本机文件、且支持本地 MCP 的 AI：

> 请按照 https://github.com/MeowMeowZi/SoundDock-MCP 的 README 中「给 AI 的接入流程」安装 SoundDock MCP，合并到我当前 AI 客户端的配置，保留已有 MCP。先做不付费的自检；缺少凭据时只问我要本地密钥文件路径，不要让我在聊天中粘贴 Key。安装完成后，音频需求直接调用工具生成，并使用返回的本地文件，不要再创建需求文档或下载步骤。

**仓库链接是安装材料，不是远程 MCP 地址。** 当前版本只支持由客户端启动的本地 STDIO。只有网页聊天、没有本机执行能力或只接受远程 HTTP MCP 的客户端，不能直接填写 GitHub URL 使用本项目；需要支持本地 MCP 的客户端 / 本地执行环境。本项目不提供托管 API、免费额度或远程认证服务。

## 给 AI 的接入流程

按顺序执行；本节是唯一的安装流程，后续配置与工具章节供按需查阅。

1. **确认环境。** 确认用户当前客户端支持本地 STDIO MCP，执行 `node --version`，要求 **Node.js 24+** 和 npm。确认稳定安装目录及音频输出目录；安装目录独立于用户业务项目。若客户端只支持远程 MCP，说明上述限制并停止本地配置，不把 GitHub 地址伪装成服务端点。完成标准：客户端类型、Node 版本和目录明确。

2. **安装独立工程。** 在用户指定的工具目录执行下列命令；已存在安装时先检查版本与本地改动，保留现有配置。也可解压 Release ZIP 后进入其中的 `SoundDock-MCP` 文件夹。完成标准：锁定依赖安装成功，`server.mjs` 存在。

   ```sh
   git clone https://github.com/MeowMeowZi/SoundDock-MCP.git
   cd SoundDock-MCP
   npm ci --omit=dev --no-audit --no-fund
   ```

3. **准备本地配置。** 仅在不存在时复制 `config.example.json` 为 `config.local.json`，按需修改 `dataDir`、`outputDir`。请用户提供已保存在本机的密钥文件路径，并确认服务权限。音效 / BGM 需要 SeedAudio Key；旁白另需 TTS Key、资源 ID 和至少一个可用音色 ID。只启用需要的服务，其他可保持未配置；凭据文件只含 Key 文本，可带末尾换行，不是 JSON。完成标准：所需服务的配置字段齐全，敏感文件不进入 Git 或聊天。

4. **验证协议与配置。** 设置绝对路径 `AUDIO_MCP_CONFIG_FILE` 后运行 `npm run check`，见下方命令。该命令只检查 MCP 握手、工具列表与能力，**不调用付费接口**。检查所需服务的 `configured` 为 `true`；缺项时按 `missing` / `error` 修复。若用户尚无凭据，报告“协议可用、服务待配置”，不要宣称已可生成。完成标准：协议为 `ok`，所需服务本地配置通过；上游权限与音质仍未经真实生成验证。

5. **合并客户端配置。** 采用下方适合客户端的配置，仅添加 / 更新 `sounddock` 项，保留其他 MCP。`args` 与配置文件路径都用绝对路径；若客户端找不到 `node`，使用 `node` 可执行文件的绝对路径。重载客户端 MCP，若客户端要求重启则请用户完成。完成标准：当前 AI 能看到本项目的三个工具，且能调用 `audio_get_capabilities`。

6. **直接处理音频需求。** 用户提出实际音频需求后，再执行付费生成；安装阶段不擅自付费试音。为每份经授权的输出建立稳定 `request_id`，严格遵循下文重试规则。成功后使用 `job.file.path`，需要放入业务项目时复制实际文件并按用户要求接线；保留任务记录用于核对。完成标准：AI 可调用工具，真实生成与文件验收在用户提出需求后进行；不额外创建文档、工单或下载流程。

## 本地配置

只生成音效 / BGM 的最小 `config.local.json`：

```json
{
  "dataDir": "./state",
  "outputDir": "./output",
  "seedAudio": {
    "apiKeyFile": "./.secrets/seed.key"
  }
}
```

需要旁白时，在同一 JSON 中增加以下 `narration` 字段；把音色 ID 和名称替换为自己的已授权音色，不要把占位符当成真实音色：

```json
{
  "apiKeyFile": "./.secrets/narration.key",
  "resourceId": "seed-icl-2.0",
  "voices": [
    { "id": "YOUR_SPEAKER_ID", "name": "我的角色音色" }
  ]
}
```

上面这一段是 `narration` 的值，而不是整份配置。服务不会从原业务项目导入密钥或音色，也不会自动设计 / 复刻音色。`resourceId` 必须与自己的 TTS 权限及音色匹配；`seed-icl-2.0` 仅为示例。

配置内相对路径均相对于配置文件所在目录，不受客户端启动目录影响。建议把 `outputDir` 改成业务项目的音频素材目录，或在生成后复制；每份输出在独立任务子目录中，文件名会进行安全处理。配置在服务器启动时读取，修改后重启 MCP。

### 不付费的自检

PowerShell，在安装目录执行：

```powershell
$env:AUDIO_MCP_CONFIG_FILE = (Resolve-Path ./config.local.json).Path
npm run check
```

macOS / Linux：

```sh
AUDIO_MCP_CONFIG_FILE="$PWD/config.local.json" npm run check
```

成功输出包含 `protocol: "ok"`、三个工具、服务配置状态与 `paid_requests: 0`。没有 Key 也可验证协议；`configured: true` 仅代表本地配置齐全，不代表已验证上游余额、音色权限或实际音质。启动时的 SQLite 实验性提示走 stderr，不是协议失败。

### 环境变量（可代替或覆盖 JSON）

| 变量 | 用途 |
| --- | --- |
| `AUDIO_MCP_CONFIG_FILE` | 本地 JSON 文件绝对路径 |
| `AUDIO_MCP_DATA_DIR` | 任务数据库目录；无配置时默认 `~/.sounddock` |
| `AUDIO_MCP_OUTPUT_DIR` | 生成文件根目录；默认在数据目录下的 `files` |
| `SEEDAUDIO_API_KEY_FILE` / `SEEDAUDIO_API_KEY` | SeedAudio 密钥文件 / 环境密钥 |
| `NARRATION_API_KEY_FILE` / `NARRATION_API_KEY` | 旁白独立密钥文件 / 环境密钥 |
| `NARRATION_RESOURCE_ID` | 旁白资源 ID |
| `AUDIO_MCP_VOICES_JSON` | 音色白名单，如 `[{"id":"YOUR_SPEAKER_ID","name":"角色"}]` |

优先使用密钥文件，环境值覆盖 JSON；同一服务同时设置环境文件和环境 Key 时，环境文件优先，读取失败不回退。JSON 也支持 `apiKey`，但不建议把明文密钥写进配置。没有配置文件时，目录环境变量必须是绝对路径；密钥文件同样建议使用绝对路径。密钥只发送到所配置的上游，不作为工具参数、能力结果或任务记录返回。

服务默认访问火山引擎 HTTPS 接口。高级部署可用 `SEEDAUDIO_API_URL` / `AUDIO_MCP_NARRATION_API_URL` 覆盖接口地址；仅允许 HTTPS 或 loopback HTTP。地址由本机操作者管理，AI 工具调用不能修改；只使用可信地址，因为请求会携带服务密钥。

## 接入 AI 客户端

### Codex

按 [Codex 官方 MCP 配置说明](https://developers.openai.com/codex/mcp/)，合并到 `~/.codex/config.toml`，或已信任项目的 `.codex/config.toml`：

```toml
[mcp_servers.sounddock]
command = "node"
args = ["C:/Tools/SoundDock-MCP/server.mjs"]
env = { AUDIO_MCP_CONFIG_FILE = "C:/Tools/SoundDock-MCP/config.local.json" }
startup_timeout_sec = 15
tool_timeout_sec = 60
```

macOS / Linux 将两处路径替换为真实安装路径，例如 `/home/you/tools/SoundDock-MCP/...`。工具只短暂等待，上游仍在生成时返回任务，后续轮询，因此不必把单次工具超时设为几分钟。

### 使用 `mcpServers` JSON 的客户端

按客户端自己的本地 MCP 配置入口合并（不是所有客户端都使用同一配置文件）：

```json
{
  "mcpServers": {
    "sounddock": {
      "command": "node",
      "args": ["C:/Tools/SoundDock-MCP/server.mjs"],
      "env": {
        "AUDIO_MCP_CONFIG_FILE": "C:/Tools/SoundDock-MCP/config.local.json"
      }
    }
  }
}
```

两种配置的可复制模板位于 `examples/`。`npm start` 是 STDIO 服务器，不会启动网站；通常让 AI 客户端启动它，而不是手动开一个常驻终端。

## AI 工具调用

| 工具 | 行为 |
| --- | --- |
| `audio_get_capabilities` | 查看配置状态、可用音色、目录与限制；不付费 |
| `audio_generate` | 受理一份音效、BGM 或旁白，生成并保存真实文件；可能付费 |
| `audio_get_job` | 按原 `request_id` 查询 / 等待既有任务；不重新生成 |

先查看能力，再调用生成。`wait_seconds` 默认 20，可设 0–25；得到 `processing` 后调用 `audio_get_job`。所有调用结果在 `structuredContent` 中，也提供等价 JSON 文本供客户端读取。

### 音效 / BGM

```json
{
  "request_id": "my-game:ui-confirm:v1",
  "kind": "sfx",
  "title": "ui_confirm",
  "prompt": "A short, bright wooden click with a soft bell tail, about 0.4 seconds, clean isolated game UI confirmation, no speech.",
  "format": "wav",
  "wait_seconds": 20
}
```

BGM 改用 `kind: "bgm"`，将曲风、用途、期望时长及循环意图写入 `prompt`。当前两者使用同一 SeedAudio 模型；不额外注入隐藏指令。不提供单独的精确时长 / 无缝循环参数，描述的时长最长 120 秒；模型输出未必精确符合意图，需要试听验证。输出采样率为 24 kHz，`prompt` 最长 3000 字符。

### 旁白

`voice_id` 必须从能力结果的 `narration.voices` 中明确选择。`text` 是实际朗读台词，语气说明写入 `parameters.context_text`，不要塞进台词：

```json
{
  "request_id": "my-game:intro-line-01:v1",
  "kind": "narration",
  "title": "intro_line_01",
  "text": "你终于来了。我们出发吧。",
  "voice_id": "YOUR_SPEAKER_ID",
  "format": "wav",
  "parameters": {
    "sample_rate": 24000,
    "speech_rate": 0,
    "model": "seed-tts-2.0-expressive",
    "context_text": "对终于赴约的同伴，先松口气，随后轻快地发出邀请。"
  }
}
```

此示例的表现力模型需要 `seed-icl-2.0` 资源；其他资源请使用自己的可用参数。ICL2 的语气指令 / CoT 标签必须配合 `seed-tts-2.0-expressive`。支持的参数由工具输入 schema 和 `src/narration-fields.ts` 定义；未知参数、无效依赖及未配置音色会在发送上游前拒绝。台词最多 64 KiB UTF-8；多语言音色、情绪和资源权限仍以服务方授权为准。

### 文件与任务

成功结果包含 `job.status: "ready"` 和 `job.file`：绝对 `path`、MIME 类型、字节数、SHA-256、实际时长及采样率。**文件已经保存**，让 AI 使用或复制它即可，不需要再次请求生成或手动下载。

`job.resource_uri` 使用 `sounddock://jobs/{id}/audio`，可通过 MCP 资源读取原始字节。大于 **6 MiB** 的文件仅通过本地路径使用，避免 Base64 超过客户端消息限制；文件上限 **100 MiB**。资源读取会核验哈希，文件被删除或改写时不会自动重新生成。

## 费用、重试与数据边界

- 每份经用户授权的输出使用一个稳定 `request_id`（1–128 位 ASCII 字母、数字及 `._:-`，首位为字母或数字）。同 ID、同规范化输入返回原任务；改变输入返回 `REQUEST_ID_CONFLICT`。`title` 也是输入的一部分，查询时使用 `audio_get_job`。
- 客户端超时 / 断线后先查询原 ID；不要换新 ID 当作轮询。`processing` 继续查，`ready` 直接使用文件；`failed` / `uncertain` 保留原结果，不自动重放，需核对结果与费用并取得新生成授权。
- `BUSY` 表示当前数据目录已有生成任务，新请求尚未受理；稍后可用同一个新请求 ID 再试。每个共享数据目录同时只处理一份任务，按序生成多份即可。
- 上游等待最长 300 秒。网络中断、进程退出、半段音频或落盘失败均可能已产生费用；重启只恢复状态，不重新发送。存活判断使用本机 PID，不支持跨主机、网络盘或隔离 PID 命名空间共享一个数据目录；PID 被复用时保守保持处理中，需要人工核对。
- `dataDir` 中的 `jobs.sqlite` 持久保存请求 ID、描述 / 台词和结果；音频在 `outputDir`。它们可能包含私有素材，应限制本机访问。停止全部相关 MCP 后一起备份数据库和音频；删除 / 更换数据库会失去原 ID 的去重历史，不能据此安全重试旧请求。
- Key、`config.local.json`、数据库、输出和发布目录已被 Git 忽略；发布脚本另外限制文件范围。服务只发起用户授权的上游生成，不提供声线设计、用户 / 项目权限管理或原系统数据迁移。

## 开发、验证与打包

```sh
npm ci --no-audit --no-fund
npm test
npm run pack
```

测试使用真实 SDK STDIO 子进程、独立临时 SQLite、本机模拟接口和合成 WAV / MP3 帧；测试入口剥离真实凭据及代理，预加载仅允许 loopback 的网络防误调用器。覆盖文件原字节、参数、去重、并发、断线恢复、资源边界及错误脱敏。防误调用器不是不可信代码沙箱；测试不验证真实计费、上游权限或音质。

打包输出 `dist/sounddock-mcp-0.1.0.zip` 和 `dist/SHA256SUMS.txt`，ZIP 内另有逐文件 `FILES.sha256`。压缩包含独立源码、锁文件、接入说明、示例与测试，不含 `node_modules` 或密钥，解压后仍需联网执行 `npm ci`。GitHub Actions 在 Windows / Linux 上运行同一测试与打包命令。
