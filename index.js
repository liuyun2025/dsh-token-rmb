import z from '@deepseek-ai/schemastery'

/**
 * 一档单价：元 / 百万 tokens。
 * `cacheReadPerM`、`cacheWritePerM` 缺省时按 `inputPerM` 计（DeepSeek 不收独立的缓存写费用）。
 */
const Price = z.object({
  inputPerM: z.number(),
  cacheReadPerM: z.number(),
  cacheWritePerM: z.number(),
  outputPerM: z.number(),
})

/**
 * `pricing` 是整表替换：一旦配置，内置快照就不再参与；未列出的模型回退到 `*`。
 * `.volatile()` 让这一项进入浏览器的配置表单投影，客户端才能通过 `configForms` 读到并实时跟随修改。
 */
export const Config = z.object({
  pricing: z.dict(z.object({
    idle: Price,
    peak: Price,
  })).volatile(),
})

/**
 * 宿主半侧只负责让配置可读、可校验；计价完全在浏览器里完成，这里不注册任何资源。
 * @param ctx - 插件上下文。
 */
export function apply(ctx) {
  ctx.inject(['settings'], (scope) => {
    scope.effect(
      () => scope.settings.configure({ auto: false }, ctx.fiber),
      'turn-cost: settings form policy',
    )
  })
}
