window.__ModuleLoader__.load({
  id: 'dsh-token-rmb',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 文案命名空间；与 `slots.register` 的 `locale` 保持一致。 */
    const NS = 'tokenRmb'

    // ------------------------------------------------------------------
    // 价目表：元 / 百万 tokens。内置快照取自 2026-10-30 的 DeepSeek 官方价，
    // 由宿主 `Config.pricing` 整表覆盖；未列出的模型回退到 '*'。
    // ------------------------------------------------------------------
    const BUILTIN = {
      'deepseek-flash': {
        idle: { inputPerM: 1, cacheReadPerM: 0.02, cacheWritePerM: 1, outputPerM: 4 },
        peak: { inputPerM: 2, cacheReadPerM: 0.04, cacheWritePerM: 2, outputPerM: 8 },
      },
      'deepseek-v4-pro': {
        idle: { inputPerM: 4.5, cacheReadPerM: 0.15, cacheWritePerM: 4.5, outputPerM: 13.5 },
        peak: { inputPerM: 9, cacheReadPerM: 0.3, cacheWritePerM: 9, outputPerM: 27 },
      },
      '*': {
        idle: { inputPerM: 1, cacheReadPerM: 0.02, cacheWritePerM: 1, outputPerM: 4 },
        peak: { inputPerM: 2, cacheReadPerM: 0.04, cacheWritePerM: 2, outputPerM: 8 },
      },
    }

    /** 默认价目表的序列化形式；配置缺失时客户端读到的就是这个。 */
    const DEFAULT_PRICING_JSON = JSON.stringify(BUILTIN)

    // ------------------------------------------------------------------
    // 金额：内部用「皮元」（1e-12 元）整数计价。
    // 费用_皮元 = tokens × round(单价 × 1e6)，全程整数乘加，没有浮点累加误差。
    // ------------------------------------------------------------------
    const PICO_PER_YUAN = 1e12
    const PICO_PER_CENT = 1e10
    const PICO_PER_BASIS = 1e8

    function numberOrUndefined(value) {
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
    }

    /** 把一档价格的原始对象规范成四个单价；`inputPerM` / `outputPerM` 缺失视为这一档无效。 */
    function tierOf(raw) {
      if (raw === null || typeof raw !== 'object') return null
      const input = numberOrUndefined(raw.inputPerM)
      const output = numberOrUndefined(raw.outputPerM)
      if (input === undefined || output === undefined) return null
      return {
        inputPerM: input,
        outputPerM: output,
        cacheReadPerM: numberOrUndefined(raw.cacheReadPerM) ?? input,
        cacheWritePerM: numberOrUndefined(raw.cacheWritePerM) ?? input,
      }
    }

    /** 配置表单可能把 volatile 字段投影成带 `.get()` 的引用；两种形态都接受。 */
    function unwrap(value) {
      if (value !== null && typeof value === 'object' && typeof value.get === 'function') {
        try {
          return value.get()
        } catch (error) {
          return undefined
        }
      }
      return value
    }

    /** 把配置里的价目表规范成 `{ model: { idle, peak } }`；空表回退内置快照。 */
    function normalizePricing(raw) {
      if (raw === null || typeof raw !== 'object') return BUILTIN
      const out = {}
      for (const model of Object.keys(raw)) {
        const entry = raw[model]
        if (entry === null || typeof entry !== 'object') continue
        const idle = tierOf(entry.idle) ?? tierOf(entry.peak)
        const peak = tierOf(entry.peak) ?? tierOf(entry.idle)
        if (idle === null || peak === null) continue
        out[model] = { idle, peak }
      }
      // 配置了却没有任何有效条目时退回内置快照；
      // 只要有一项有效，就按用户那张表算——缺 `*` 时未知模型如实显示「未计价」。
      if (Object.keys(out).length === 0) return BUILTIN
      return out
    }

    let cachedPricingJson = null
    let cachedPricing = BUILTIN

    /** 解析序列化价目表；同一个字符串只解析一次。 */
    function pricingOf(json) {
      if (json === cachedPricingJson) return cachedPricing
      let parsed = null
      try {
        parsed = JSON.parse(json)
      } catch (error) {
        console.warn('[dsh-token-rmb] 价目表解析失败，回退内置快照', error)
      }
      cachedPricing = normalizePricing(parsed)
      cachedPricingJson = json
      return cachedPricing
    }

    // ------------------------------------------------------------------
    // 峰谷：官方按「北京时间、周一至周五 9:00–12:00 与 14:00–18:00」为高峰。
    // 时区固定 Asia/Shanghai，不跟随系统时区；法定节假日暂不处理（按工作日计）。
    // ------------------------------------------------------------------
    const SHANGHAI_CLOCK = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })

    const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }

    /** 判断一个时刻是否落在高峰时段。 */
    function isPeak(timeMs) {
      if (typeof timeMs !== 'number' || !Number.isFinite(timeMs)) return false
      let parts
      try {
        parts = SHANGHAI_CLOCK.formatToParts(new Date(timeMs))
      } catch (error) {
        return false
      }
      let weekday
      let hour
      let minute
      for (const part of parts) {
        if (part.type === 'weekday') weekday = part.value
        else if (part.type === 'hour') hour = Number(part.value)
        else if (part.type === 'minute') minute = Number(part.value)
      }
      const day = WEEKDAY_INDEX[weekday]
      if (day === undefined || day === 0 || day === 6) return false
      const minutes = hour * 60 + minute
      return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
    }

    // ------------------------------------------------------------------
    // 展示格式
    // ------------------------------------------------------------------
    function formatCount(value) {
      return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    }

    function formatPrice(value) {
      return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(6)))
    }

    /** 皮元 → 人民币文本（不含 ≈）。三档：两位小数 / 四位小数 / 小于最小显示值。 */
    function formatCost(pico) {
      if (!Number.isFinite(pico) || pico <= 0) return '¥0'
      if (pico >= PICO_PER_CENT) return '¥' + (Math.round(pico / PICO_PER_CENT) / 100).toFixed(2)
      if (pico >= PICO_PER_BASIS) return '¥' + (Math.round(pico / PICO_PER_BASIS) / 1e4).toFixed(4)
      return '<¥0.0001'
    }

    function withApprox(text) {
      return text.charAt(0) === '<' ? text : '≈' + text
    }

    /** 把 label 和 title 打包成一个稳定字符串，避免选择器每次返回新对象导致无限重渲染。 */
    const SEPARATOR = '\u0001'
    function pack(label, title) {
      return label + SEPARATOR + title
    }

    // ------------------------------------------------------------------
    // 从 Chat 快照里取这一轮的 tail 数据（与官方用量面板同源）
    // ------------------------------------------------------------------
    const turnIndexCache = new WeakMap()

    function turnIndex(snapshot) {
      let index = turnIndexCache.get(snapshot)
      if (index !== undefined) return index
      index = new Map()
      const nodes = snapshot && snapshot.nodes
      if (nodes && typeof nodes.values === 'function') {
        for (const node of nodes.values()) {
          if (node === null || typeof node !== 'object' || node.kind !== 'turn-tail') continue
          const closing = node.data && node.data.closing
          const finalNode = closing && closing.finalNode
          const messageId = finalNode && finalNode.messageId
          if (typeof messageId === 'string' && !index.has(messageId)) index.set(messageId, node.data)
        }
      }
      turnIndexCache.set(snapshot, index)
      return index
    }

    // ------------------------------------------------------------------
    // 计算与文案
    // ------------------------------------------------------------------
    /** 渲染期绝不抛错：任何意外都退化成「不显示」，不影响这一行和整条会话。 */
    function describeTurn(snapshot, messageId, mode, pricingJson, t) {
      try {
        return describeTurnInner(snapshot, messageId, mode, pricingJson, t)
      } catch (error) {
        console.warn('[dsh-token-rmb] 费用计算失败，本轮不显示', error)
        return null
      }
    }

    function describeTurnInner(snapshot, messageId, mode, pricingJson, t) {
      // 用户选了「简洁」时官方连用量都不显示，我们跟着一起消失。
      if (mode === 'compact') return null
      if (typeof messageId !== 'string' || messageId === '') return null

      const data = turnIndex(snapshot).get(messageId)
      if (data === undefined || data.tokenUsage === undefined) return null

      const usage = data.tokenUsage
      const routes = Array.isArray(usage.routes) ? usage.routes : []
      const firstRoute = routes[0]
      const model = firstRoute && typeof firstRoute.model === 'string' ? firstRoute.model : null

      const pricing = pricingOf(pricingJson)
      const plan = (model !== null ? pricing[model] : undefined) ?? pricing['*'] ?? null
      if (plan === null) {
        return pack('¥—', t('cost.unpriced', { model: model ?? t('cost.noModel') }))
      }

      const peak = isPeak(data.time)
      const tier = peak ? plan.peak : plan.idle
      if (tier === null) {
        return pack('¥—', t('cost.unpriced', { model: model ?? t('cost.noModel') }))
      }

      const miss = numberOrUndefined(usage.uncachedInputTokens) ?? 0
      const write = numberOrUndefined(usage.cacheWriteTokens) ?? 0
      const hit = numberOrUndefined(usage.cacheReadTokens) ?? 0
      const output = numberOrUndefined(usage.outputTokens) ?? 0

      const pico =
        miss * Math.round(tier.inputPerM * 1e6) +
        write * Math.round(tier.cacheWritePerM * 1e6) +
        hit * Math.round(tier.cacheReadPerM * 1e6) +
        output * Math.round(tier.outputPerM * 1e6)

      const label = withApprox(formatCost(pico))
      const tierName = t(peak ? 'cost.tier.peak' : 'cost.tier.idle')
      const rows = []
      if (miss > 0) rows.push(t('cost.row', { label: t('cost.inputMiss'), count: formatCount(miss), price: formatPrice(tier.inputPerM) }))
      if (write > 0) rows.push(t('cost.row', { label: t('cost.inputWrite'), count: formatCount(write), price: formatPrice(tier.cacheWritePerM) }))
      if (hit > 0) rows.push(t('cost.row', { label: t('cost.inputHit'), count: formatCount(hit), price: formatPrice(tier.cacheReadPerM) }))
      if (output > 0) rows.push(t('cost.row', { label: t('cost.output'), count: formatCount(output), price: formatPrice(tier.outputPerM) }))

      const lines = [
        t('cost.title'),
        t('cost.model', { model: model ?? t('cost.noModel'), tier: tierName }),
      ]
      lines.push(...rows)
      lines.push(t('cost.total', { cost: label }))
      if (routes.length > 1 && model !== null) lines.push(t('cost.multi', { count: routes.length, model }))
      lines.push(t('cost.note'))

      return pack(label, lines.join('\n'))
    }

    // ------------------------------------------------------------------
    // 组件
    // ------------------------------------------------------------------
    const STYLE = {
      order: 1,
      display: 'inline-flex',
      alignItems: 'center',
      whiteSpace: 'nowrap',
      fontVariantNumeric: 'tabular-nums',
      fontSize: 'calc(var(--dsh-content-font-size-secondary, 13px) - 1px)',
      lineHeight: 'calc(24px + var(--dsh-content-font-delta, 0px))',
      color: 'var(--dsw-alias-label-tertiary)',
    }

    const EMPTY_SNAPSHOT = { nodes: { values: () => [] } }
    const fallbackHook = (value) => (selector) => selector(value)

    /**
     * 一轮结束时的费用标签。`order: 1` 让它在视觉上排到「用量 / 时间」右侧，
     * 而 DOM 顺序仍留在官方动作行里。
     */
    function TurnCost(props) {
      const t = typeof props.t === 'function' ? props.t : (key) => key
      const useChat = typeof props.useChat === 'function' ? props.useChat : fallbackHook(EMPTY_SNAPSHOT)
      const useUiUsage = typeof props.useUiUsage === 'function' ? props.useUiUsage : fallbackHook('detailed')
      const usePricing = typeof props.usePricing === 'function' ? props.usePricing : fallbackHook(DEFAULT_PRICING_JSON)

      const mode = useUiUsage((value) => (value === 'compact' ? 'compact' : 'detailed'))
      const pricingJson = usePricing((value) => (typeof value === 'string' ? value : DEFAULT_PRICING_JSON))
      const packed = useChat((snapshot) => describeTurn(snapshot, props.messageId, mode, pricingJson, t))

      if (typeof packed !== 'string') return null
      const split = packed.indexOf(SEPARATOR)
      const label = split < 0 ? packed : packed.slice(0, split)
      const title = split < 0 ? packed : packed.slice(split + 1)

      return h('span', {
        style: STYLE,
        title,
        'aria-label': title,
        'data-token-rmb': '',
      }, label)
    }

    // ------------------------------------------------------------------
    // 文案
    // ------------------------------------------------------------------
    const zh = {
      'cost.title': '本轮 token 费用估算',
      'cost.model': '模型 {model} · {tier}',
      'cost.tier.idle': '空闲价',
      'cost.tier.peak': '高峰价',
      'cost.row': '{label} {count} × ¥{price}/M',
      'cost.total': '合计 {cost}',
      'cost.multi': '本轮涉及 {count} 个模型，按 {model} 计价',
      'cost.note': '按当前价目表估算，与账单可能有出入',
      'cost.unpriced': '未配置该模型的单价：{model}',
      'cost.noModel': '未知模型',
      'cost.inputMiss': '输入·未命中',
      'cost.inputHit': '输入·缓存命中',
      'cost.inputWrite': '缓存写',
      'cost.output': '输出',
    }

    const en = {
      'cost.title': 'Estimated token cost for this turn',
      'cost.model': 'Model {model} · {tier}',
      'cost.tier.idle': 'off-peak',
      'cost.tier.peak': 'peak',
      'cost.row': '{label} {count} × ¥{price}/M',
      'cost.total': 'Total {cost}',
      'cost.multi': 'This turn used {count} models; priced with {model}',
      'cost.note': 'Estimated from the current price table; your bill may differ',
      'cost.unpriced': 'No price configured for model {model}',
      'cost.noModel': 'unknown model',
      'cost.inputMiss': 'Input (cache miss)',
      'cost.inputHit': 'Input (cache hit)',
      'cost.inputWrite': 'Cache write',
      'cost.output': 'Output',
    }

    // ------------------------------------------------------------------
    // 插件主体
    // ------------------------------------------------------------------
    function makeStore(initial) {
      let value = initial
      const listeners = new Set()
      return {
        getSnapshot: () => value,
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        set(next) {
          if (Object.is(next, value)) return
          value = next
          for (const listener of [...listeners]) {
            try {
              listener()
            } catch (error) {
              console.error('[dsh-token-rmb] subscriber threw', error)
            }
          }
        },
      }
    }

    const inject = ['slots', 'locale']

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'token-rmb: dictionaries')

      // 「简洁 / 详细」跟随 ui-chat 的偏好；价目表跟随本插件的宿主配置。
      const uiUsage = makeStore('detailed')
      const pricing = makeStore(DEFAULT_PRICING_JSON)

      ctx.inject(['configForms'], (scope) => {
        let costForm = null
        try {
          costForm = scope.configForms.get('dsh-token-rmb')
        } catch (error) {
          console.warn('[dsh-token-rmb] 无法读取插件配置，使用内置价目表', error)
        }
        if (costForm !== null && typeof costForm.subscribe === 'function') {
          const syncCost = () => {
            let raw
            try {
              raw = costForm.getSnapshot()?.value?.pricing
            } catch (error) {
              raw = undefined
            }
            pricing.set(JSON.stringify(normalizePricing(unwrap(raw))))
          }
          scope.effect(() => costForm.subscribe(syncCost), 'token-rmb: price config')
          syncCost()
        }

        let chatForm = null
        try {
          chatForm = scope.configForms.get('ui-chat')
        } catch (error) {
          chatForm = null
        }
        if (chatForm !== null && typeof chatForm.subscribe === 'function') {
          const syncChat = () => {
            let mode
            try {
              mode = chatForm.getSnapshot()?.value?.performanceUsage
            } catch (error) {
              mode = undefined
            }
            uiUsage.set(mode === 'compact' ? 'compact' : 'detailed')
          }
          scope.effect(() => chatForm.subscribe(syncChat), 'token-rmb: usage detail preference')
          syncChat()
        }
      })

      ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
        name: 'conversation.chat.assistant-actions',
        id: 'token-rmb',
        order: 20,
        locale: NS,
        inject: () => ({ hooks: { uiUsage, pricing } }),
      }, TurnCost))
    }

    return { inject, apply }
  },
})
