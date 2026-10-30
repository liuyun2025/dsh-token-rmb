# dsh-token-rmb

**Inline per-turn token cost in CNY for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`).**

A small web plugin that appends one number to the assistant action row — the estimated cost of that turn in yuan, right after the usage/time indicator. Peak and off-peak rates are applied automatically, and nothing new is added to the layout.

```
[copy] [feedback] [branch] … [usage 12.3K tok] [18:42] [≈¥0.0349]
```

- One turn, one number. No session total, no extra row, no layout shift.
- Follows the shipped **Performance & usage → Compact** setting: when the official usage pill is hidden, this disappears too.
- Prices come from a built-in snapshot and can be overridden from the profile's `cordis.patch.yml`; the override is a `volatile` field, so saving it re-prices without restarting the app (refresh the page if the number does not move).
- Estimates only. Usage is provider-reported; prices are a local table.

## 中文说明

在每轮对话结束时的操作行里，紧贴「用量 / 时间」右侧显示这一轮的 token 费用估算（人民币），支持高峰 / 空闲两档单价。

- **只显示本轮**，不占新行、不改行高；官方切到「性能与用量 = 简洁」时一起隐藏。
- 数据用该轮 `tokenUsage` 的模型上报用量（与官方用量面板同源），不是按字符数估的。
- 金额内部用皮元（1e-12 元）整数运算，展示三档：`≈¥0.86` / `≈¥0.0032` / `<¥0.0001`。

### 界面

插件安装后（多出`≈¥0.68`）

![image.png](https://lybiji.oss-cn-shenzhen.aliyuncs.com/jietu/20261030-140138-3ba28dc12e7347dcaf8fcc45b4571b23.png)

鼠标放在上面

![image.png](https://lybiji.oss-cn-shenzhen.aliyuncs.com/jietu/20261030-140202-41da4f069b9c46f4a08cefb28c52b903.png)

### 与 `dsh-turn-cost` 的区别

[dsh-turn-cost](https://github.com/WFMinerva/dsh-turn-cost) 功能更全（每轮 + 会话累计、按步取价、内置法定节假日）。本插件是**极简版**，取舍如下：

| | dsh-turn-cost | dsh-token-rmb |
|---|---|---|
| 显示 | 每轮 + 会话累计，操作行里多一行 | 只有本轮，同一行内、时间右侧 |
| 峰谷 | 按每一步的实际时点取价 | 按该轮结束时间整轮取一档（近似） |
| 法定节假日 | 内置当年安排 | **不处理**，见下文「已知误差」 |
| 价目覆盖 | 本机 `ratesPath` JSON | 宿主 `Config.pricing`，保存即生效 |
| 精度 | 到分 | 皮元整数，三档展示 |

如果你需要会话累计或节假日精确计价，请用 dsh-turn-cost；如果你只想要一个不占版面的小数，用这个。

## 安装

| 形式 | 命令 |
|---|---|
| npm | `dsh plugin --profile <profile> add dsh-token-rmb` |
| Git 仓库 | `dsh plugin --profile <profile> add github:liuyun2025/dsh-token-rmb` |
| 本地目录 | `dsh plugin --profile <profile> add <绝对路径>` |
| tarball | `dsh plugin --profile <profile> add <绝对路径>.tgz` |

装完重启该 profile 生效（插件成员在启动时确定）。卸载：`dsh plugin --profile <profile> remove dsh-token-rmb`。

## 计价

```
费用 = 输入·未命中 × 未命中价
     + 缓存写      × 缓存写价（DeepSeek 与未命中同价）
     + 缓存命中    × 命中价
     + 输出        × 输出价（reasoning 已含在输出里）
```

### 内置价目（2026-10-30，元 / 百万 tokens）

| deepseek-flash | 空闲 | 高峰 |
| --- | --- | --- |
| 输入·缓存命中 | 0.02 | 0.04 |
| 输入·缓存未命中 | 1 | 2 |
| 缓存写 | 1 | 2 |
| 输出 | 4 | 8 |

`deepseek-v4-pro` 也内置了一份（0.15 / 4.5 / 13.5 与 0.3 / 9 / 27）；未列出且没有 `*` 的模型显示 `¥—`，不套用别人的价格。

### 峰谷

固定**北京时间**，高峰为**周一至周五 9:00–12:00、14:00–18:00**，其余（含周末）空闲、价格减半。

## 配置

写在当前 profile 的 `cordis.patch.yml`，**整表替换**内置快照；未列出的模型回退 `*`。`pricing` 是 `.volatile()` 字段，保存后重新计价，不用重启应用（若数字没立即更新，刷新页面即可）。

```yaml
- id: dsh-token-rmb
  name: dsh-token-rmb
  config:
    pricing:
      deepseek-flash:
        idle: { inputPerM: 1, cacheReadPerM: 0.02, cacheWritePerM: 1, outputPerM: 4 }
        peak: { inputPerM: 2, cacheReadPerM: 0.04, cacheWritePerM: 2, outputPerM: 8 }
      my-gateway-model:
        idle: { inputPerM: 3, cacheReadPerM: 0.3, cacheWritePerM: 3, outputPerM: 12 }
        peak: { inputPerM: 6, cacheReadPerM: 0.6, cacheWritePerM: 6, outputPerM: 24 }
      '*':
        idle: { inputPerM: 1, cacheReadPerM: 0.02, cacheWritePerM: 1, outputPerM: 4 }
        peak: { inputPerM: 2, cacheReadPerM: 0.04, cacheWritePerM: 2, outputPerM: 8 }
```

- `inputPerM`、`outputPerM` 必填；`cacheReadPerM`、`cacheWritePerM` 缺省按 `inputPerM`。
- 只写 `peak` 或只写 `idle`，另一档复用同一份。
- 没有 DSH 设置页表单：官方目前没有客户端会根据 schema 自动生成页面，改价就是改这段 YAML。

## 降级

- 该轮没有可用用量 → 不显示，不留占位符。
- 有用量但算不出价 → 显示 `¥—`，悬停写明原因。
- 计算或渲染出任何异常 → 捕获后不显示，不影响这一行和会话本身。
- 读不到「性能与用量」偏好（例如 `ui-chat` 不存在）→ 按「详细」处理，照常显示。

## 已知误差与限制

1. **节假日不处理**：官方规则里中国法定节假日算空闲价，本插件按工作日算，因此节假日当天会**高估一倍**。国庆、春节这类连续假期最明显。
2. **跨时段的一轮按整轮计价**：一轮里多次请求跨越 12:00 或 18:00 时，整轮按**轮次结束时间**取一档，只影响跨界的少数轮次。
3. 一轮混用多个模型时按 `routes[0]` 计价，悬停里会标注。
4. 只算 token：搜索/抓取、套餐订阅等不计入，文案写的是「token 费用估算」。
5. 价目表是快照，官方保留调价权；实际扣费以平台为准。价目表改了，历史轮次金额会按新价重算。

## 兼容性

在 **0.2.1-rc.3** 上实测。客户端读取聊天节点的 `turn-tail` 数据（与官方用量面板同源），属于 `dsh-client-ui-chat` 的内部形状，因此 `engines.dsh` 限定在 `>=0.2.1-rc.3 <0.2.2`；升级宿主前请先确认这一行还在。

## 开发

```sh
pnpm install
pnpm test      # 纯逻辑自检（峰谷、格式化、降级）
pnpm run check # 语法检查
```

改 `lib/client.js` 后刷新页面；改配置不用。宿主半侧依赖 `@deepseek-ai/schemastery`：用 `link:` 安装时 Node 不会去 profile 里找它，所以本地 `pnpm install` 会把 `cosmokit` / `@standard-schema/spec` 装到包根目录（见 `devDependencies`）。

## License

[MIT](./LICENSE)
