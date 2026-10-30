// 纯逻辑自检：node test/client.test.cjs
// 直接把 lib/client.js 的工厂跑起来，把内部函数临时暴露出来做断言。
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'client.js'), 'utf8')
  .replace('return { inject, apply }', 'return { inject, apply, __test: { describeTurn, normalizePricing, formatCost, isPeak, tierOf } }')

let captured = null
const windowStub = {
  __ModuleLoader__: {
    load(definition) {
      captured = definition
    },
  },
}

function load() {
  new Function('window', 'console', source + '\n//# sourceURL=client-under-test.js')(windowStub, console)
  const fakeReact = { createElement: () => null }
  return captured.factory((id) => {
    if (id === 'react') return fakeReact
    throw new Error('unexpected require: ' + id)
  })
}

const { describeTurn, normalizePricing, formatCost, isPeak, tierOf } = load().__test

const results = []
function check(name, actual, expected) {
  results.push({ name, ok: JSON.stringify(actual) === JSON.stringify(expected), actual, expected })
}

const at = (iso) => Date.parse(iso)

// 峰谷（北京时间）
check('周五 10:00 高峰', isPeak(at('2026-10-30T10:00:00+08:00')), true)
check('周五 09:00 整点高峰', isPeak(at('2026-10-30T09:00:00+08:00')), true)
check('周五 12:00 边界非高峰', isPeak(at('2026-10-30T12:00:00+08:00')), false)
check('周五 14:30 高峰', isPeak(at('2026-10-30T14:30:00+08:00')), true)
check('周五 18:00 边界非高峰', isPeak(at('2026-10-30T18:00:00+08:00')), false)
check('周六 10:00 非高峰', isPeak(at('2026-10-31T10:00:00+08:00')), false)
check('UTC 02:00 = 北京 10:00 高峰', isPeak(at('2026-10-30T02:00:00Z')), true)

// 价目规范化
const normalized = normalizePricing({ 'my-model': { peak: { inputPerM: 3, outputPerM: 9 } } })
check('只有 peak 时 idle 复用它', normalized['my-model'].idle, { inputPerM: 3, outputPerM: 9, cacheReadPerM: 3, cacheWritePerM: 3 })
check('缺 * 时不补 *', normalized['*'], undefined)
check('空表回退内置', normalizePricing({})['deepseek-flash'].idle.inputPerM, 1)
check('缺少 outputPerM 的档位无效', tierOf({ inputPerM: 1 }), null)

// 金额格式
check('0 元', formatCost(0), '¥0')
check('1 元', formatCost(1e12), '¥1.00')
check('0.01 元', formatCost(1e10), '¥0.01')
check('0.005 元', formatCost(5e9), '¥0.0050')
check('0.0001 元', formatCost(1e8), '¥0.0001')
check('极小值', formatCost(1e7), '<¥0.0001')

// describeTurn
const pricingJson = JSON.stringify({})
const t = (key, params) => (params === undefined ? key : key + JSON.stringify(params))
const snapshot = {
  nodes: {
    values: () => [
      { kind: 'turn-tail', data: { time: at('2026-10-30T10:00:00+08:00'), tokenUsage: { uncachedInputTokens: 1000000, cacheReadTokens: 0, outputTokens: 0 }, closing: { finalNode: { messageId: 'm1' } } } },
      { kind: 'turn-tail', data: { time: at('2026-10-31T10:00:00+08:00'), tokenUsage: { uncachedInputTokens: 1000000, outputTokens: 0 }, closing: { finalNode: { messageId: 'm2' } } } },
      { kind: 'assistant-step', data: {} },
    ],
  },
}

check('高峰 1M 未命中 token = ¥2.00', describeTurn(snapshot, 'm1', 'detailed', pricingJson, t).split('\u0001')[0], '≈¥2.00')
check('空闲 1M 未命中 token = ¥1.00', describeTurn(snapshot, 'm2', 'detailed', pricingJson, t).split('\u0001')[0], '≈¥1.00')
check('compact 不渲染', describeTurn(snapshot, 'm1', 'compact', pricingJson, t), null)
check('未知消息不渲染', describeTurn(snapshot, 'nope', 'detailed', pricingJson, t), null)

const unknownModel = {
  nodes: {
    values: () => [{
      kind: 'turn-tail',
      data: {
        time: at('2026-10-30T10:00:00+08:00'),
        tokenUsage: { uncachedInputTokens: 1000, outputTokens: 500, routes: [{ provider: 'p', model: 'unknown-model' }] },
        closing: { finalNode: { messageId: 'm3' } },
      },
    }],
  },
}
check('未知模型回退 *', describeTurn(unknownModel, 'm3', 'detailed', pricingJson, t).split('\u0001')[0] !== '¥—', true)
check(
  '价目表无 * 且模型未知 → ¥—',
  describeTurn(unknownModel, 'm3', 'detailed', JSON.stringify({ other: { idle: { inputPerM: 1, outputPerM: 1 } } }), t).split('\u0001')[0],
  '¥—',
)

for (const r of results) {
  console.log((r.ok ? 'PASS' : 'FAIL') + '  ' + r.name + (r.ok ? '' : '  actual=' + JSON.stringify(r.actual) + ' expected=' + JSON.stringify(r.expected)))
}
const failed = results.filter((r) => !r.ok).length
console.log('\n' + (results.length - failed) + '/' + results.length + ' passed')
process.exit(failed === 0 ? 0 : 1)
