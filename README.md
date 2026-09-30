# Token Stats — a DSH plugin

在 [DSH (DeepSeek Harness)](https://github.com/deepseek-ai/deepseek-harness) 的**输入框下方**显示当前会话的 Token 用量、缓存命中率与上下文占用。

A DSH plugin that shows the current session's token usage, cache-hit share, and context occupancy **below the composer**.

```
16.4K · 缓存 87.7% · 上下文 1%
```

点击展开明细面板：输入 / 缓存读取 / 缓存写入 / 输出 / 总计、缓存命中率、轮次与步骤，以及上下文占用的分段色条（系统提示词 / 工具定义 / 对话消息）。

## 特性

- **K / M / B 紧凑显示** —— `16.4K`、`13.9M`、`1.5B`；千以下保持精确（`400` 仍是 `400`），进位边界不出现 `1000K`（`999,600` 显示 `1M`）。
- **缓存命中率** —— 提示侧已计费输入中缓存读取的占比，pill 与面板都有。
- **上下文占用** —— 已用 / 容量与百分比，以及启发式构成（系统提示词 / 工具定义 / 对话消息）。
- **中英双语** —— 走宿主 `locale` 服务，跟随语言切换，无硬编码文案。
- **跟随主题** —— 只用 DSH 主题令牌（`--dsw-*`），明暗主题一致。
- **零轮询** —— 数据全部来自宿主既有的耐久 session 投影，不自行折叠事件、不订阅轮询。

## 安装

这是一个 DSH **bundle** 包（`package.json` 里声明了 `dsh.bundle.patch`）。把它放进 profile 有两种方式：

**方式一：在 DSH 会话里让 Agent 安装（推荐）**

让 Agent 调用 `plugin_manager` 工具，`action: install_bundle`，`target` 指向本仓库目录的绝对路径。它会自动完成依赖链接、bundle 注册与启用。

**方式二：手动作为本地包接入**

```bash
# 1) 在本仓库目录建立到 profile 的本地链接
dsh plugin --profile <你的profile> add link:/绝对/路径/dsh-token-stats

# 2) 在 profile 的 package.json 中把包名加入 dsh.profile.bundles
```

`dsh plugin` 只是把参数转发给 pnpm，所以用 `link:` 前缀引用本地目录。第 2 步是必需的：仅安装依赖不会让 Loader 加载这个 bundle。

> 注意：本包**不含**密钥、账号或本机路径。所有数据都在运行时从当前会话的投影读取。

## 数据来源

所有数字都读取宿主已有的耐久投影，不新增事件、不写日志：

| 投影 | 用途 |
|---|---|
| `tokenUsage` | 累计输入 / 缓存读取 / 缓存写入 / 输出 |
| `contextPressure` | 已用 Token 与上下文容量 |
| `contextBreakdown` | 上下文构成（系统提示词 / 工具定义 / 对话消息） |
| `sessionStats` | 轮次与步骤 |

## 开发与测试

无需构建步骤，Client 半边是纯 JavaScript（`window.__ModuleLoader__.load` 工厂格式）。

```bash
node test/render.test.mjs   # 渲染与行为：K/M/B 边界、面板数值、边界场景、键覆盖守卫
node test/icon.test.mjs     # 图标结构
node test/served.test.mjs   # 与运行中服务器实际提供的字节比对（需本机 3081 端口在跑）
```

`served.test.mjs` 需要本机 DSH Web 服务在运行；其余两个可离线运行。

渲染测试使用一个忠实模拟宿主查找链的 translate 桩（`自身命名空间 → common → 键名`），因此**引用别的插件私有命名空间的键会被测出来** —— 这正是本项目早期一个真实缺陷的成因。

## 结构

```
package.json          包清单：dsh.bundle 补丁 + dsh.client 声明
cordis.patch.yml      Loader 补丁：插入 bundle 行
index.js              Host 半边（仅承载 bundle 行）
client.js             Client 半边：界面与逻辑
icon.svg              Plugin Manager 图标
locale/zh.json        插件标题与描述（中文）
locale/en.json        插件标题与描述（英文）
test/                 测试
```

## License

MIT
