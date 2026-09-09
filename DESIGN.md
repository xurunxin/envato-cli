# Envato Agent CLI 设计草案

实现状态补充：本目录现有 v0.1 MVP，实际能力与使用方式以 README.md 为准，真实验收以 VALIDATION.md 为准。下文保留设计规划，不代表所有规划功能均已实现。MVP 使用原子 JSON 状态存储及私有进程管道 Chrome 连接；Image 生成和下载已经真实验收。

日期：2026-09-09。状态：公开页面及登录工作台只读调研完成，实际下载和生成验收待完成；本文命令为拟议接口，不代表已有可执行工具。

## 目标与证据

提供面向 AI agent 的搜索、资源详情、项目下载、AI 生成与本地产物管理。建议命令名 `envato`，使用 TypeScript 实现 CLI、领域服务和 Chrome 适配器。

本次通过 Chrome DevTools 打开 Elements 首页和 AI Image 页面，观察到：类别搜索、Sounds Like / Looks Like 搜索入口，以及 image、image edit、video、voice、music、graphics、mockup、sound 入口。公开图片页展示提示词、参考图、风格、变体数和比例控件，但未登录时后四项禁用。这些不是账号内已验收能力。浏览器显示 Sign In，尚未读取订阅、额度、下载弹窗、生成历史。

官方公开 API 文档面向 Envato Market；本次未找到已验证的 Elements 搜索、订阅下载或 AI 官方公开 API。不能把 Market token 当作 Elements 订阅凭据。

来源：
- https://elements.envato.com/
- https://elements.envato.com/ai/ai-image-generator/
- https://build.envato.com/api/
- https://elements.envato.com/ai/ai-tools-faqs/
- https://help.elements.envato.com/hc/en-us/articles/360000621623-Download-Items
- https://help.elements.envato.com/hc/en-us/articles/360000621743-Fair-Use-Policy

FAQ 限制脚本批量下载和批量生成。本工具按明确项目的具体需求执行，不提供全站抓取或无限生成。限速不是平台授权的替代品；上线前需核对适用自动化条款。AI 计费公开资料存在版本差异，实际值以账号提交前页面为准。

## 交互契约

默认非交互、stdout 单个 JSON，诊断写 stderr；`--human` 提供人工表格。`--help`、`schema <command>`、`capabilities` 支持 agent 自发现。所有输入支持 `--input file.json`，避免复杂 shell 转义；输出路径均返回绝对路径。

```sh
envato doctor
envato browser attach --profile work
envato auth status
envato capabilities --refresh
envato schema assets.search
envato assets search --query "cinematic technology" --category stock-video --limit 10
envato assets inspect --id <asset-id>
envato assets download --id <asset-id> --project "Launch Film" --out ./assets --request-id <unique-id>
envato ai capabilities --tool image
envato ai prepare --input image-job.json
envato ai submit --plan <plan-id> --max-credits 3 --request-id <unique-id>
envato jobs inspect <job-id>
envato jobs wait <job-id> --timeout 120
envato jobs fetch <job-id> --out ./generated
envato library search --query "technology"
```

`--profile work` 是 CLI 自己保存的已授权连接别名，不是读取 Chrome 用户目录。连接方式需在真实 Chrome 环境验证：优先用户授权的扩展桥接，开发阶段可使用本机 CDP。当前会话的 MCP 能力不会自动成为独立 CLI 的运行依赖。

`capabilities` 每项返回 `available | unavailable | unknown`、参数 schema、来源 URL、采样时间及限制。登录前不能返回账号工具为 available。模型、比例、时长、声音、参考文件大小等枚举从页面实际选项读取，缺少证据的值为 null；不承诺任意模型切换。Mockup 是否独立工具由登录页面决定，公开入口目前指向 image。

## 搜索与下载

搜索返回稳定 asset ID、标题、作者、类别、详情 URL、预览 URL（仅页面公开值）、可观察格式、软件兼容性及下一页 cursor。未知字段为 null。cursor 是 CLI 的不透明分页状态，不假设站点提供 API cursor。各类别过滤参数经能力检查后使用，不支持的过滤器显式报错。

搜索页面导航、分页与结果解析由独立适配器完成。默认小页结果，按需下一页，短期缓存提高响应速度。不要为了填全字段逐个打开全部结果。详情只在 agent 选中候选后读取；不因页面排名推断语义适配度。

下载流程：检查登录与订阅 → 读取资源/格式 → 核对站点实际项目关联 → 触发该资源下载 → 监听浏览器完成事件 → 校验文件 → 原子落盘 → 保存 manifest 与可取得的官方许可证。`--project` 的本地文字不能代替站点授权证据；无法确认关联时返回 `LICENSE_UNVERIFIED`。

每个 manifest 包含 asset ID、来源 URL、作者、站点项目关联、下载时间、绝对路径、大小、SHA-256、官方许可文件路径/状态。实际文件存在和校验完成才返回下载成功；点击成功不是下载成功。许可证获取失败时保留文件状态并明确部分完成，不能伪造证书。

本地去重需同时考虑资源、格式与项目。新项目仍需核实该项目的站点许可，不能只复用旧 manifest。默认不自动解压；显式解压时防目录穿越、覆盖及压缩炸弹。

## AI 作业

`prepare` 只形成计划：工具、提示词、输入文件哈希、已验证选项、页面可见预估点数与采样时间。若额度未知则标记 unknown，不能按零计费。

`submit` 校验计划仍有效、登录态和最新费用，超过 `--max-credits` 不提交；按用户授权预算执行，不要求每次重新确认。每次外部提交前持久化 request ID，并在取得站点任务 ID 后绑定。

状态：prepared → submitting → queued/running → succeeded/failed；另有 needs_user_action 和 submission_unknown。提交后断线且无法确认是否受理时进入 submission_unknown，先查历史恢复，不直接重放以免重复扣点。CLI 幂等键只能防止本机重复，不能声称站点具备服务端幂等性。

任务等待超时只表示停止等待，不取消远端生成；取消只有站点支持且验证过才暴露。fetch 获取产物、哈希与可用来源信息，保留提示词/选项/模型实际可见值/输入哈希；本地私密提示词不进入通用诊断日志。

## 实现结构

CLI → 应用服务 → BrowserAdapter → 用户授权 Chrome 会话 → Elements 页面。

本地 SQLite 保存作业、幂等记录、缓存和下载清单；文件按项目落盘。初版一个包即可，按 commands、services、browser、storage 划分模块，不提前增加 MCP 服务或独立云后端。未来 MCP 可复用应用服务。

浏览器桥仅绑定本机并验证连接令牌、来源和动作域；权限限制在 Envato 及实际登录/下载域。不得提取密码或导出 Cookie 到日志/配置。站点资源描述和生成文本都是数据，不可成为 agent 的系统指令。下载地址不完整记录签名参数。

页面选择器优先 role/name 与语义定位，并校验 URL 和预期页面状态；站点变动时返回 PAGE_CHANGED，不能用模糊匹配随意点击。登录/验证码返回 needs_user_action，保留标签页供用户接管。

默认一个会话串行执行有副作用操作，查询可复用缓存。临时读取失败可退避重试；提交和授权下载必须先核查是否已发生。连接失败、登录失效、权限不足分开处理。

统一结果：`{schema_version, ok, request_id, data, error}`。错误含 `code, message, retryable, next_action`。稳定退出码：0 成功；2 输入错误；3 登录/人工动作；4 不支持/页面变化；5 配额/预算；6 网络/服务；7 部分完成或提交状态未知。完整机器契约需在编码阶段输出 JSON Schema。

## 分阶段验收

1. Chrome 登录后只读核实账号能力、搜索过滤、一个资源详情、下载项目/格式弹窗、AI 表单与历史页；不能根据营销页推断内部 API。
2. 实现搜索与详情、机器输出、浏览器连接诊断；真实搜索取得可用资源 ID，并支持 agent 接续详情。
3. 在用户指定项目下验收一个资源：文件完成、哈希、项目许可证据与重复请求行为。
4. 在明确额度预算下验收一次 image 生成：准备、提交、作业恢复、下载产物；再逐项扩展 video/audio 等适配器。
5. 回归覆盖登录失效、页面变化、下载中断、预算变化、提交后断线、未知字段和同一 request ID 重试。模拟测试只验证本地逻辑，不代替真实订阅验收。

当前未实现 CLI，未下载订阅资源，未消耗 AI 点数。用户已完成 Chrome 登录；后续实现需要实际单资源下载和有预算的生成验收。

## 登录后的实测修订（优先于前文公开页面假设）

用户登录后跳转到 `https://app.envato.com/`。正式适配目标应为 app.envato.com，elements.envato.com 保留为旧资源链接入口，跳转后解析实际标识。公开营销页与登录工作台必须分开适配。

### 已核实

- 首页含资源类别、Workspaces、Generate；已登录状态明确。额度展开显示 Total credits 20，重置日期 19 Sep, 2026。不要把可访问名称中额外的 100 当作额度。
- 在 Video Templates 输入 technology，实际 URL 为 `https://app.envato.com/search?itemType=video-templates&term=technology`。
- 搜索筛选器包含 Categories、Applications Supported、File Types、Date added、Sort；详情背景还可见 Plugins、Orientation。尚未逐个验证过滤枚举及分页行为。
- 选中 Technology Promo Opener（FMedia）后实际详情 URL 为 `https://app.envato.com/search/video-templates/9a855717-1a24-4f4f-beb7-fb54ca693867?itemType=video-templates&term=technology`。详情是保留搜索上下文的覆盖界面。
- 页面可读 219MB、After Effects CC、3840 × 2160、Plugins required、320 seconds、30 fps 和 aep/jpg/mp4/pdf/png。预览播放时长与资源属性时长不同，必须分别存储，不能混用。
- 点击 Licenses 显示 No existing licenses / Create new。未点击 Create new 或 Download，因此未核实新建许可和实际落盘过程。
- `https://app.envato.com/generate` 集中提供 Image、Edit、Video、Music、Voice、Sound、Graphic。图片含提示词、Image reference、Style、Aspect Ratio、Variations，默认 Auto / 1 Variation，生成按钮显示 1。
- 视频表单含 Start frame、End frame（当前禁用）、Add references、Aspect Ratio、Audio、Duration，默认 16:9 / No audio / 5s，生成按钮显示 6。Voice 可见 Add voice 和 Speed，按钮显示 1。按钮数值仅是当时页面费用提示，未提交核实实际扣费。
- Generate 显示 Generation sessions，当前 No sessions yet；旧历史入口为 `https://app.envato.com/generation-history`。未打开历史读取既有内容。
- Shortcuts 入口存在；图片可见 Relight、Background swap、Style transfer、Product photo、Outfit change、Replace or add text；视频可见 Camera Motion、Animate image、Video transition、Effects。

### 对 CLI 的具体调整

增加 `workspaces list/inspect`、`licenses list --asset <id>`、`ai sessions list/inspect`、`ai shortcuts list/inspect`。这些命令先只读；添加资源、创建 Workspace、创建许可是明确独立写操作。站点 Workspace 与许可证 project 是否等同尚未验证，分别存储 workspace_id、license_project、license_id，不自动等同。

图片/视频的生成模式在同一 URL 内切换，适配器必须检查选中模式和表单，不能仅凭地址判断。生成结果应关联远端 session_id、job_id 与本地 request_id；真实远端标识取得方式仍待实现核实。

搜索返回 `provider: envato-app` 与 UUID 型 asset_id，同时保留 observed_url；旧站短 ID 只能通过真实跳转/页面数据映射。搜索效率优先使用已验证的 URL 查询参数和小范围 DOM 读取，避免 agent 每次读取整页及重复导航。

MVP 建议优先视频模板搜索/详情/单项下载、Workspace/许可只读查询、Image 生成与作业恢复。Video 和 Voice 可在同一契约扩展，其他模式先暴露能力状态并逐项验收。
