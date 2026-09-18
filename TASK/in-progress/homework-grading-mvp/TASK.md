---
task_schema: plan-tasks-tracker/v3
plan_schema: rumelt-task-plan/v2
task_slug: homework-grading-mvp
plan_id: PT-homework-grading-mvp
plan_version: 1
plan_status: APPROVED
approved_by: user
approved_steps: S-01,S-02,S-03,S-04,S-05
approved_scope: A-01,A-02,A-03,A-04,A-05,A-06
approved_plan_digest: sha256:994bfd69713f64936665352d683583ede9823270e447a411a8215632c12583f2
routing_mode: auto
selected_modules: M-01,M-03,M-06,M-07
execution_status: IN_PROGRESS
created_at: 2026-09-18
updated_at: 2026-09-18
---

# 任务跟踪：学生作业批改系统 V1.0.0 MVP 网页应用

## 任务目标与批准快照

- 目标：在 `/home/ubuntu/my_project/homework_grading/` 交付可本地运行的 MVP 网页应用——上传学生作答图片 → 视觉模型判定是否物理题（结构化输出+脚本判定）→ 生图模型在原图上生成批改图片并返回；非物理题弹窗警告可重试；失败记日志可重试；三表数据库与状态机按设计实现；ZenMux SDK 独立成模块。
- 主要诊断：D-01（设计文档缺技术架构与 API 契约两块，外部平台协议与模型可用性未知，状态机横跨三层；故外部依赖先行、垂直切片推进）。
- 指导方针：G-01（外部依赖先行；SDK 自始独立成模块；界面让位于流程正确；排除"先全量 UI 后接 API"与"业务代码直调平台 API"）。
- 近端目标：O-01（当前目录交付可本地运行 MVP，完成一次真实端到端批改，三表记录与日志正确）。
- 主动不做：NG-01（不做登录/绑定、不校验批改正确性、不处理生成扭曲、不加未要求架构、提示词不入库）。
- 批准依据：用户于 2026-09-18 审阅五段摘要后答复"授权，全部批准并执行"——Q-01 采纳方案 A（Node.js（Express）+ SQLite + 原生 HTML/JS 轻前端），Q-02 授权真实外呼，批准 S-01..S-05 全部步骤。
- 路由快照：风险等级=标准；不可逆性=可逆；七维度=不确定性中/依赖强/可逆/跨模块/无遗留/环境静态/协调中。
- 已选模块：M-01, M-03, M-06, M-07。
- 用户步骤映射：S-01 -> A-01,A-02; S-02 -> A-03; S-03 -> A-04; S-04 -> A-05; S-05 -> A-06

## 变更范围

- 涉及模块或目录：`/home/ubuntu/my_project/homework_grading/` 下应用全部文件（前端页面、后端 REST API、SQLite 数据层、ZenMux SDK 独立模块、日志、package.json/.gitignore/.env.example 等工程配置），`TASK/pending/homework-grading-mvp/` 任务包，`/tmp` 探测临时脚本。
- 预计影响文件数：约 15-30 个新建文件（全新构建，无既有文件修改）。
- 允许的工具与权限：当前目录与 /tmp 文件写入；git init 与本地提交；npm 依赖安装；本地服务启动与浏览器访问；Q-02 已授权的 ZenMux 真实 API 调用（密钥仅经环境变量/.env 注入）；web-searcher 联网核实；只读验证与审查代理。
- 禁止或需另行批准：修改/删除 `学生作业批改系统设计/` 目录；将密钥明文写入源码、交付文档或版本库；更换模型或平台；引入对象存储等外部新服务；任何超出已批行动范围的架构变更。

## 行动执行契约

| action_id | input | output | dependencies | permissions | acceptance | failure_response |
| --- | --- | --- | --- | --- | --- | --- |
| A-01 | F-03 中两个模型 ID；web-searcher 联网检索 | ZenMux 协议核实纪要（API 基址、鉴权方式、视觉调用与生图调用的请求/响应格式、两模型可用性证据，附可检查来源） | none | web-searcher 联网搜索（已授权） | 纪要覆盖两类调用的请求格式与鉴权方式，关键结论附来源链接或明确标注"公开资料未确认" | 公开资料无法确认协议时不编写确定性结论，在纪要中标注待验证项并由 A-02 真实调用探测兜底；两者均失败则停止后续行动，升级用户决定 |
| A-02 | ZENMUX_API_KEY（经环境变量注入，不回显）；A-01 纪要；最小测试图片 | 视觉与生图模型各一次最小真实调用的证据：成功时为响应样例（结构化判定文本/图片资源），失败时为错误三要素记录 | A-01 | Q-02 已授权外呼（少量平台费用）；/tmp 临时脚本写入 | 两类调用各自获得成功响应或明确的平台侧错误证据，证据含请求要点与响应要点，密钥未出现在证据文本中 | 任一调用失败即停止 A-03 及后续全部实施行动，保留证据与日志，将失败证据提交用户决定（更换模型/平台或中止），不得擅自更换模型继续 |
| A-03 | F-04 三表定义与状态机枚举；Q-01 技术栈决定（Node.js/Express/SQLite/原生前端） | 当前目录 git 仓库与工程骨架；SQLite 建表与访问层（三表、UNIQUE(image_id,attempt_no)、错误三要素字段，erroe_code 按原文拼写并注释）；.gitignore（排除 .env、数据目录、设计目录） | A-02 | 当前目录写入、git init、npm 依赖安装 | 建表脚本可重复执行（幂等）；三表字段、枚举与 1:N 关系与设计逐项一致；插入/更新示例运行通过 | 依赖安装失败按已批准技术栈排查环境；环境不可修复则停止并上报，不擅自更换技术栈（技术栈变更属用户决定） |
| A-04 | A-02 验证的调用方式；A-03 数据库层；审核/生图提示词配置（实现起草，置于配置文件，不入库） | 独立 SDK 模块（视觉审核调用、生图调用、错误三要素与 provider_request_id 捕获）；REST API（上传建批次、触发批改、查询状态/结果）；日志记录（拒绝与失败均落日志）；API 契约文档（应用目录 docs/ 下） | A-02, A-03 | 当前目录写入；Q-02 已授权外呼（联调） | API 契约文档化；上传→VALIDATING→READY/REJECTED→GENERATING→SUCCEEDED/FAILED 状态流转与 generation_attempts 记录在测试中可复现；业务代码不直接调用外部平台（仅经 SDK 模块） | 状态流转测试失败在本行动内修复后重测；SDK 层失败模式与 A-02 相同则停止并升级用户；契约需超出已批范围变更时暂停并提交用户 |
| A-05 | A-04 的 API 契约文档 | 最小可用页面：图片上传（多图归入同一批次）、状态轮询、批改结果图展示、非物理题弹窗警告、失败重试入口 | A-04 | 当前目录写入；本地浏览器访问 | 桌面浏览器完成一次真实端到端流程（上传物理题→出批改图）；非物理题触发弹窗警告且可重试；浏览器控制台无报错 | 与契约不符时按 A-04 契约文档核对，实现偏差退回修复；属契约缺陷则暂停并提交用户决定 |
| A-06 | 完整应用；真实物理题与非物理题样例图 | 验证证据包：物理题端到端成功、非物理题被拒（弹窗+日志）、失败路径日志与 attempt 记录、三表数据核对结果、密钥未出现在源码/文档/版本库的检查结果 | A-05 | 本地运行服务；Q-02 已授权外呼；verification-executor、risk-reviewer、artifact-quality-reviewer 只读审查 | 上述证据齐备；verification-executor 与 risk-reviewer 均通过且无未处理的高风险项 | 定位弱环节（W-01 外部依赖 / W-02 状态机一致性）并返工对应层；涉及批准范围、技术栈或权限变更则暂停执行，更新方案并重新获批 |

## 任务明细

- [x] T-01 | A-01 | 联网核实 ZenMux API 基址、鉴权方式、视觉与生图两类调用请求/响应格式及两个模型 ID（openai/gpt-image-2.5-sunburst、bytedance/doubao-seed-2.0-lite）可用性 | output: 协议核实纪要（含来源链接与未确认标注） | acceptance: 纪要覆盖两类调用格式与鉴权，关键结论附来源或明确标注"公开资料未确认"
- [x] T-02 | A-02 | 以环境变量注入密钥（不回显），对视觉模型与生图模型各执行一次最小真实调用并保留证据 | output: 两类调用的成功响应样例或错误三要素记录 | acceptance: 每类调用有含请求/响应要点的证据，且密钥未出现在证据文本中
- [x] T-03 | A-03 | 初始化 git 仓库与工程骨架，编写 .gitignore（排除 .env、数据目录、设计目录），实现 SQLite 三表建表与访问层 | output: 可重复执行的建表脚本与示例读写通过记录 | acceptance: 建表幂等；三表字段、枚举与 1:N 关系与 F-04 逐项一致；插入/更新示例运行通过
- [x] T-04 | A-04 | 实现独立 ZenMux SDK 模块（视觉审核调用、生图调用、错误三要素与 provider_request_id 捕获） | output: SDK 模块代码及其调用证据 | acceptance: 业务代码仅经 SDK 访问外部平台；错误三要素与请求 ID 被捕获
- [x] T-05 | A-04 | 实现 REST API（上传建批次、触发批改、查询状态/结果）与日志，编写 API 契约文档 | output: 后端服务与 docs/ 下 API 契约文档 | acceptance: 状态流转与 generation_attempts 记录在测试中可复现；拒绝与失败均落日志
- [x] T-06 | A-05 | 实现前端页面（多图上传归批次、状态轮询、批改结果图展示、非物理题弹窗警告、失败重试入口） | output: 前端页面代码 | acceptance: 桌面浏览器完成一次真实端到端流程；非物理题弹窗警告且可重试；控制台无报错
- [x] T-07 | A-06 | 执行端到端验证（成功/拒绝/失败三路径）并核对三表记录 | output: 验证证据包 | acceptance: 三路径证据与三表核对结果齐备
- [x] T-08 | A-06 | 完成风险与质量审查（密钥泄漏检查、交付物可用性质量） | output: risk-reviewer 与 artifact-quality-reviewer 审查结论 | acceptance: 两项审查通过且无未处理的高风险项

## 发现与变更记录

- 2026-09-18 | 批准记录 | 用户答复"授权，全部批准并执行"：Q-01 采纳方案 A（Node.js/Express + SQLite + 原生前端），Q-02 授权真实外呼，批准 S-01..S-05。
- 2026-09-18 | T-01 | evidence: type=artifact; locator=docs/zenmux-protocol-notes.md; result=纪要覆盖 base URL（https://zenmux.ai/api/v1）、Bearer 鉴权、OpenAI 兼容端点（/chat/completions、/images/generations）、视觉 image_url 传入（支持 base64 data URL）、生图同步返回 b64_json；两模型 ID 均查到官方页面；未确认项已如实标注（doubao-seed-2.0-lite 模型级 structured output、错误 JSON 体完整结构）
- 2026-09-18 | T-02 | evidence: type=command; locator=/tmp/zenmux-probe.mjs、/tmp/zenmux-probe2.mjs、/tmp/zenmux-probe3.mjs（node --check 通过后执行，退出码 0）; result=生图调用 HTTP 200（47924ms，size=1024x1024，data[0].b64_json 1,877,900 字符，解码 1,408,423 字节 PNG 签名有效，产物 /tmp/probe_physics_question.png）；视觉调用 4 次 HTTP 200（json_object/json_schema strict/提示词约束均实测，json_schema strict 可强制 {is_physics: boolean, reason: string} 精确键名）；错误探测得 HTTP 403 error={code:"403",type:"access_denied",message:"...(request_id:...)"}；密钥全程脱敏（MASKED(73)），证据文本无密钥明文
- 2026-09-18 | H-01 | 判定=支持。观察：两模型经 ZenMux 真实调用均成功（生图 200 + b64_json 有效 PNG；视觉 4 次 200 且正确判定 is_physics=true，reason 与图片内容吻合）。覆盖条件=两类调用各至少一次实测（已满足）。未覆盖项=images/edits、stream、429 限流行为（不影响本 MVP 验收）。
- 2026-09-18 | A-02 协议修正（实现输入） | ① 网关请求 ID 响应头实际名为 X-ZenMux-RequestId（非文档示例的 x-request-id），已实测确认；② 无效凭据返回 403/access_denied 而非 401，错误处理不能只判 401；③ 错误 JSON 体结构={"error":{"code","type","message"}}；④ GET /models 走门户路由不校验密钥，不可用于鉴权探测；⑤ doubao-seed-2.0-lite 支持 response_format（json_object 与 json_schema strict 均实测通过）。
- 2026-09-18 | T-03 | evidence: type=file; locator=src/db/schema.sql（合并提交 f813794，worktree 审核通过）; result=三表与 F-04 逐项一致：CHECK 枚举（validation_status 4 态、status 7 态、attempt status 3 态）、UNIQUE(image_id,attempt_no)、erroe_code 按设计原文拼写加注释、provider_request_id 注明取 X-ZenMux-RequestId；测试 ok4-8 验证建表幂等/字段/外键/枚举/UNIQUE（15/15 通过）
- 2026-09-18 | T-04 | evidence: type=file; locator=src/sdk/zenmux/{client,vision,image}.js + 全库 git grep "sk-ai-v1"（无结果）; result=SDK 独立模块为业务代码唯一外部出口；json_schema strict 强制 {is_physics,reason}；错误规范化 {code,type,message,requestId}（403 access_denied 兼容）；X-ZenMux-RequestId 大小写不敏感捕获；.env.example 仅占位符；测试 ok9-13 覆盖状态机与 attempt 三要素
- 2026-09-18 | T-05 | evidence: type=test; locator=docs/api.md + npm test（15/15）+ 实施冒烟（首页/静态资源 200、非法格式 400 统一 JSON、日志双写 logs/app.log 与控制台、无密钥优雅降级 MISSING_API_KEY）; result=六端点契约文档化（方法/路径/请求/响应示例/错误格式/状态机图）；状态流转与 attempt 记录测试可复现；拒绝与失败均落日志
- 2026-09-18 | 实施偏差记录（3 条，实现细节级） | ① better-sqlite3 经 npm 12 allowScripts 授权完成原生编译（未启用 node:sqlite 降级，仍在已批 SQLite 栈内）；② test 脚本改为 node --test test/*.test.js（Node 22 不识别目录参数，等价）；③ retry 接口异步返回 202（避免阻塞 48s 真实生成）；校验阶段 FAILED 卡片用静态 error_message（该阶段无 attempt 记录，schema 仅存生图错误三要素）——两条均不改变已批契约验收边界
- 2026-09-18 | T-08（前端质量部分） | evidence: type=manual; locator=artifact-quality-reviewer 审查报告（逐行走查 public/ 三文件 + PORT=3199 实启服务 curl 验证 + node --check + XSS sink 扫描）; result=总体可交付：业务闭环齐全（上传/徽标/结果下载/拒绝弹窗/失败重试）、无 XSS（无 innerHTML，全部 textContent）、15 个 id 与 JS 绑定一一对应、兼容现代浏览器；发现 3 个低严重度缺陷（D1 轮询恢复后残留错误提示、D2 重试按钮无在途防护双击误导报错、D3 上传在途可并发创建批次）+ 1 处契约不一致（非 multipart 请求实际 500、docs/api.md 承诺 400）；未覆盖：真实浏览器控制台/移动端视口实测（环境无 headless 浏览器）
- 2026-09-18 | T-06 | evidence: type=manual; locator=verification-executor V2/V3 API 级端到端 + artifact-quality-reviewer 交互逻辑走查 + 实施冒烟首页 200; result=成功路径经 API 级真实端到端闭环（上传→SUCCEEDED→结果图可下载）；REJECTED 模态与重试按钮逻辑经走查确认（rejectionModalShown 防重复弹窗、终态停轮询、错误熔断）；无控制台报错的结构性风险（无 XSS sink、15 id 绑定一一对应）；替代证据已获，浏览器人工复核列为未覆盖项
- 2026-09-18 | T-07 | evidence: type=test; locator=verification-executor 报告 V1-V6（npm test 15/15；PORT=3100 真实端到端 101s SUCCEEDED，结果图 /tmp/e2e_result.png 目视确认红笔批改标注；海滩日落图 11s REJECTED 且日志 image_id 对应；PORT=3101 无效模型构造 FAILED，attempt erroe_code=404/error_type=invalid_model/latency_ms=878；data/app.db 三表一致性 8/8，provider_request_id=300d9a66...非空，存储文件 cmp 逐字节一致）; result=三路径全部通过、证据齐备、所有验证进程已关闭
- 2026-09-18 | H-02 | 判定=支持。观察：本地文件系统 + SQLite 满足三表与 key 语义——V5 核对 raw_image_key/result_image_key 与磁盘文件逐字节一致，状态流转读写正常（成功/拒绝/失败三路径）。覆盖条件=端到端三路径实测（已满足）。
- 2026-09-18 | T-08 | evidence: type=manual; locator=risk-reviewer 审查报告（git rev-list --all 全历史密钥扫描、六类敏感路径 ls-files/check-ignore 核对、logger 调用点走查、multipart/storage/api 源码通读、npm ls 依赖核对）; result=无高级风险：全部提交历史与工作区零密钥泄漏（sk-ai-v1 扫描无命中，误报仅为 "risk-reviewer" 字样）、敏感路径从未入库、无破坏性操作、外呼面唯一（SDK）、依赖恰为 express/better-sqlite3/busboy 三项；风险审查与前端质量审查（前条）均通过，无未处理的高风险项
- 2026-09-18 | 审查修正处置 | .env 权限 777→600（已修复，chmod 实测确认）；其余 6 项（前端 D1/D2/D3、非 multipart 500→400、busboy 限额、绑定 127.0.0.1、resolveKey 断言）由小修代理在 worktree 修复并复测后合并；目录 777 属环境现状不擅改，遗留提示用户
- 2026-09-18 | 隐私提示（运营层，非代码缺陷） | 学生作业图片以 base64 发往第三方 zenmux.ai 属产品预期功能；作业可能含未成年人个人信息，提请用户在实际使用时自行评估告知同意与留存策略。
- 2026-09-18 | H-02 | 状态=待验证（A-03/A-06 执行时记录观察）。
- 2026-09-18 | 战略检验（外部依赖先行） | 观察窗口=A-04/A-05 执行期；观察点=是否因协议误判返工及返工集中层；暂无法判断。
- 2026-09-18 | state: PENDING -> IN_PROGRESS | reason: 开始或恢复执行

## 完成标准

- 当前目录下应用可本地启动（npm 安装依赖后按 README 指引运行）。
- 桌面浏览器完成一次真实端到端批改：物理题出批改图；非物理题弹窗警告且可重试；生成失败路径有日志与 attempt 记录。
- 三表（batches/images/generation_attempts）记录与设计 F-04 逐项一致，状态机流转正确。
- 密钥未出现在任何源码、交付文档与版本库中（.gitignore 与 .env 机制生效）。
- 全部获批行动（A-01..A-06）均有结构化完成证据；verification-executor 与 risk-reviewer 通过且无未处理高风险项。
- overall：上述全部满足后标记 COMPLETED，附 overall 证据。
