import { describe, expect, it } from 'vitest'
import {
  checkBaseUrl,
  checkDomainName,
  defaultConfig,
  isConfigComplete,
  maskKey,
  nextDomainId,
  parseConfig,
} from './config'

describe('parseConfig', () => {
  it('还没有配置过时返回默认配置', () => {
    const c = parseConfig(null)
    expect(c.vaultPath).toBe('')
    expect(c.services.text).toEqual({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: '' })
    expect(c.domains.map((d) => d.name)).toEqual([
      '为人处世',
      '职场求职',
      '品牌商业',
      'AI与Agent',
      '设计UI',
      '金融理财',
      '思考与表达',
      '其他',
    ])
  })

  it('旧配置缺字段时用默认值补上，已有的值保留', () => {
    const c = parseConfig(JSON.stringify({ vaultPath: 'D:\\收藏库', services: { text: { apiKey: 'sk-abc' } } }))
    expect(c.vaultPath).toBe('D:\\收藏库')
    expect(c.services.text).toEqual({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: 'sk-abc' })
    expect(c.services.asr.model).toBe('FunAudioLLM/SenseVoiceSmall')
  })

  it('领域列表被写坏时换回默认列表，而且每次是新的副本', () => {
    const a = parseConfig(JSON.stringify({ domains: 'oops' }))
    const b = parseConfig(JSON.stringify({ domains: [] }))
    expect(a.domains).toHaveLength(8)
    a.domains[0].name = '被改了'
    expect(b.domains[0].name).toBe('为人处世')
  })

  it('整个文件不是 JSON 时报错，不悄悄换成默认配置', () => {
    expect(() => parseConfig('{坏掉')).toThrow()
  })
})

describe('isConfigComplete', () => {
  it('收藏库和三项服务都填好才算完成', () => {
    const c = defaultConfig()
    c.vaultPath = 'D:\\收藏库'
    c.services.text.apiKey = c.services.vision.apiKey = 'sk-1'
    expect(isConfigComplete(c)).toBe(false)
    c.services.asr.apiKey = 'sk-2'
    expect(isConfigComplete(c)).toBe(true)
  })
})

describe('领域', () => {
  const domains = defaultConfig().domains
  it('名称校验', () => {
    expect(checkDomainName('  ', domains)).toBe('领域名不能为空')
    expect(checkDomainName('设计/UI', domains)).toMatch('不能有')
    expect(checkDomainName('设计UI', domains)).toBe('已经有这个领域了')
    expect(checkDomainName('设计UI', domains, 5)).toBeNull()
    expect(checkDomainName('读书笔记', domains)).toBeNull()
  })
  it('新编号跳过“其他”的 99', () => {
    expect(nextDomainId(domains)).toBe(8)
    expect(nextDomainId([...domains, { id: 98, name: 'x' }])).toBe(100)
  })
})

it('maskKey 只露出最后 4 位', () => {
  expect(maskKey('sk-1234567890abcd')).toBe('sk-****abcd')
  expect(maskKey('')).toBe('')
})

describe('接口地址只允许 HTTPS', () => {
  it('https 地址通过，http 和乱填的不通过', () => {
    expect(checkBaseUrl('https://api.deepseek.com')).toBeNull()
    expect(checkBaseUrl('HTTPS://api.siliconflow.cn/v1')).toBeNull()
    expect(checkBaseUrl('http://api.deepseek.com')).toBe('接口地址必须以 https:// 开头（加密连接）')
    expect(checkBaseUrl('api.deepseek.com')).not.toBeNull()
    expect(checkBaseUrl('https://')).not.toBeNull()
  })

  it('用 http 地址的服务不算已配置', () => {
    const c = defaultConfig()
    c.vaultPath = 'D:\\收藏库'
    for (const k of ['text', 'vision', 'asr'] as const) c.services[k].apiKey = 'sk-1'
    c.services.asr.baseUrl = 'http://api.siliconflow.cn/v1'
    expect(isConfigComplete(c)).toBe(false)
  })
})
