import { describe, expect, it } from 'vitest'
import {
  addDomain,
  checkBaseUrl,
  checkNewFolderName,
  checkSubfolder,
  checkDomainName,
  defaultConfig,
  isConfigComplete,
  maskKey,
  nextDomainId,
  notesRoot,
  parseConfig,
  storeLabel,
  switchVaultKind,
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
    expect(checkDomainName('  ', domains)).toBe('领域名不能为空。')
    expect(checkDomainName('设计/UI', domains)).toMatch('不能有')
    expect(checkDomainName('设计UI', domains)).toBe('已经有这个领域了。')
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

describe('收藏库连接', () => {
  it('旧配置没有类型时当作普通文件夹', () => {
    const c = parseConfig(JSON.stringify({ vaultPath: 'D:\\收藏' }))
    expect(c.vault).toEqual({ kind: 'folder', subfolder: '' })
  })

  it('普通文件夹直接存在所选文件夹里，不管子文件夹', () => {
    const c = { ...defaultConfig(), vaultPath: 'D:\\收藏', vault: { kind: 'folder' as const, subfolder: '剪藏' } }
    expect(notesRoot(c)).toBe('D:\\收藏')
  })

  it('Obsidian 仓库存到指定的子文件夹里', () => {
    const c = {
      ...defaultConfig(),
      vaultPath: 'D:\\笔记',
      vault: { kind: 'obsidian' as const, subfolder: '收藏/抖音' },
    }
    expect(notesRoot(c)).toBe('D:\\笔记\\收藏\\抖音')
    expect(notesRoot({ ...c, vault: { kind: 'obsidian', subfolder: '' } })).toBe('D:\\笔记')
  })

  it('子文件夹不能跳出仓库', () => {
    expect(checkSubfolder('')).toBeNull()
    expect(checkSubfolder('收藏/抖音')).toBeNull()
    expect(checkSubfolder('../别处')).toBe('子文件夹名里不能有“..”。')
    expect(checkSubfolder('收藏/./抖音')).toBe('子文件夹名里不能有“..”。')
    expect(checkSubfolder('C:/Windows')).toBe('子文件夹名里不能有 : * ? " < > | 这些字符。')
    expect(checkSubfolder('收藏//抖音')).toBe('子文件夹名不能有空的一层。')
  })

  it('存放位置的显示：仓库名加子文件夹，普通文件夹只显示文件夹名', () => {
    const ob = {
      ...defaultConfig(),
      vaultPath: "C:\\Users\\a\\Nutstore\\cyFeng's Vault",
      vault: { kind: 'obsidian' as const, subfolder: 'test' },
    }
    expect(storeLabel(ob)).toBe("cyFeng's Vault / test")
    expect(storeLabel({ ...ob, vault: { kind: 'obsidian', subfolder: '' } })).toBe("cyFeng's Vault")
    expect(storeLabel({ ...ob, vaultPath: 'D:\\测试收藏库\\', vault: { kind: 'folder', subfolder: 'test' } })).toBe(
      '测试收藏库',
    )
  })

  it('切换方式时两边各记各的文件夹，切回来还是原来那个', () => {
    const c = { ...defaultConfig(), vaultPath: 'D:\\收藏', vault: { kind: 'folder' as const, subfolder: '' } }
    const ob = switchVaultKind(c, 'obsidian')
    expect(ob.vaultPath).toBe('') // Obsidian 还没连过：不把普通文件夹当仓库
    const connected = { ...ob, vaultPath: 'D:\\笔记' }
    const back = switchVaultKind(connected, 'folder')
    expect(back.vaultPath).toBe('D:\\收藏')
    expect(back.vault.kind).toBe('folder')
    expect(switchVaultKind(back, 'obsidian').vaultPath).toBe('D:\\笔记')
    expect(switchVaultKind(back, 'folder')).toBe(back) // 点当前方式不变
  })

  it('新建的文件夹只能一层，不能和已有的重名', () => {
    const existing = ['工作', '收藏', '收藏/抖音']
    expect(checkNewFolderName(' 剪藏 ', existing)).toBeNull()
    expect(checkNewFolderName('抖音', existing)).toBeNull() // 只和仓库最外层的比
    expect(checkNewFolderName('', existing)).toBe('文件夹名不能为空。')
    expect(checkNewFolderName('收藏', existing)).toBe('仓库里已经有“收藏”文件夹了，可以直接在上面选。')
    expect(checkNewFolderName('收藏/小红书', existing)).toBe('文件夹名里不能有 \\ / : * ? " < > | 这些字符。')
    expect(checkNewFolderName('..', existing)).toBe('文件夹名不能是“.”或“..”。')
  })
})

describe('新增领域', () => {
  it('加在“其他”前面，编号接着往后排', () => {
    const c = defaultConfig()
    const r = addDomain(c, ' 健身 ')
    if (typeof r === 'string') throw new Error(r)
    expect(r.domain).toEqual({ id: nextDomainId(c.domains), name: '健身' })
    expect(r.config.domains.at(-2)).toEqual(r.domain)
    expect(r.config.domains.at(-1)?.name).toBe('其他')
    expect(c.domains).toHaveLength(r.config.domains.length - 1) // 不改原配置
  })

  it('名字不合规时返回原因', () => {
    expect(addDomain(defaultConfig(), '为人处世')).toBe('已经有这个领域了。')
  })
})
