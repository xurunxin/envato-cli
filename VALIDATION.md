# 真实验收记录

## 项目安装与维护补充

2026-09-09：新增 bundled skill、`skills list/install` 和 Windows 用户命令安装器。`npm test` 共 11 项通过，skill-creator 的 quick_validate.py 校验通过。

已在用户 `.local/bin` 安装 `envato.cmd` / `envato.ps1`，目录原已位于用户 PATH，没有重复追加。在工具仓库之外启动新的 PowerShell 7 会话，`envato --version` 成功；`envato skills install --dry-run` 的目标仍是执行命令的项目目录。工具项目内的真实 skill 安装成功，内容与 bundled source 相同。

新增测试覆盖当前目录语义、带空格路径、幂等安装、全部目标写入前的冲突检查、保留旁边文件、dry-run 零写入和 junction 越界拒绝。本次安装/维护测试未消耗 AI 点数。

日期：2026-09-09。工作目录：X:\Projects\Code\envato-cli。测试使用用户授权的订阅与 AI 点数。

## 实际结果

| 验收项 | 证据 / 结果 |
|---|---|
| 独立 CLI 登录 | doctor 返回 authenticated=true，私有管道启动专用 Chrome，无 Codex 工具依赖 |
| 搜索 | technology / video-templates 返回 UUID、作者、详情 URL；ceramic / photos 返回照片 UUID |
| 详情 | 图片标题、作者、3604 × 5406；视频模板软件/插件信息可读 |
| 图片准备 | plan bce6cccd-4f30-4213-8914-a60d555943a4；cost=1，credits=19 |
| CLI 提交 | request-id live-image-20260909，max-credits=1，返回 running 和远端 Session |
| 跨进程恢复 | 提交命令关闭 Chrome 后，jobs wait 重新打开，返回 succeeded |
| 生成产物 | asset 2393106c-f9c5-4dd7-9cc9-f8576891d3ab；PNG 2,165,613 bytes，图像已目视核实为青色陶瓷方块 |
| 重复提交 | 同一 plan/request-id 返回原已完成作业，没有再生成 |
| 生成产物重下载 | 修复临时框架事件匹配后再次成功，SHA-256 与第一次一致 |
| 素材下载 | asset 80241ada-c2a1-45c5-afb8-42363696c8dc，JPEG 8,332,161 bytes |
| 官方许可证 | 站点 Licenses 列表读取成功，index 0 下载 PDF 4,931 bytes；未核实具体项目关联 |
| Sessions / Workspaces | 实际读取成功；缺少可观察名称的 Workspace 保留 null |
| Shortcuts | 实际读取到快捷工作流；只读列表，不宣称已验收生成 |
| 本地自动化测试 | 7 项通过：预算未知/超额、地址约束、重复提交、提交断线、排他锁、schema、退出码 |
| 依赖检查 | npm install --package-lock-only --ignore-scripts 报告 0 vulnerabilities |

## 点数

开始 20，结束 18，共消耗 **2 点**：

1. Chrome 工具确认流程：1 张 image，20 → 19。
2. 独立 CLI 端到端：1 张 image，19 → 18。

未进行视频、语音或其他扣点测试；下载与重复提交验证后 doctor 显示 18 点。

## 产物

生成 PNG：`artifacts/d419697cba370b1193316b3c44fd9d33e7c099e04078bc594f0e2e8d76184239.png`

素材 JPEG：`artifacts/stock/f51a8052f1cbe39c27e868e0ee9dc1ad511995f8b1a34608b0e599d095cbf876.jpg`

官方许可 PDF：`artifacts/licenses/52e531f9d422f00031944579e97ce718db4133dcfb9af10f998e3ca00545a7dc.pdf`

文件名主体即 SHA-256。完整作业与 manifest 在 `.envato/`，包含私密输入，和 artifacts 一起忽略，不纳入 Git。

## 限制与已处理问题

- 开放调试 TCP 端口的启动命令被自动审批拒绝，未重试该命令。改为无网络监听的私有进程管道并完成独立 CLI 验收；TCP 附加模式没有实测。
- 站点从临时 frame 触发下载，严格 main-frame 校验导致一次文件已落盘但命令超时。已限制为仅 CLI 独占浏览器允许临时 frame，复验通过；共享浏览器保持严格匹配。
- 素材文件与许可证 PDF 均真实取得，但未核实许可证项目关联，因此项目许可状态仍为 unverified，不将下载成功等同于项目授权验收。
- 本版本为 DESIGN.md 所述 MVP：Image 提交已验收；Video、Voice、Music、Sound、Graphic、Edit 提交未实现。筛选枚举、分页、参考图、多变体与自动项目许可属于后续阶段。
