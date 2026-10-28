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
  mergeCollectionDomains,
  nextDomainId,
  notesRoot,
  parseConfig,
  storeLabel,
  switchVaultKind,
} from './config'

describe('parseConfig', () => {
  it('已有用户的领域列表原样保留，不替换为新用户默认值', () => {
    const domains = [
      { id: 1, name: '为人处世' },
      { id: 8, name: '摄影技巧' },
      { id: 99, name: '其他' },
    ]
    expect(parseConfig(JSON.stringify({ domains })).domains).toEqual(domains)
  })
  it('还没有配置过时返回默认配置', () => {
    const c = parseConfig(null)
    expect(c.vaultPath).toBe('')
    expect(c.services.text).toEqual({ baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', apiKey: '' })
    expect(c.domains).toEqual([{ id: 99, name: '其他' }])
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
    expect(a.domains).toHaveLength(1)
    a.domains[0].name = '被改了'
    expect(b.domains[0].name).toBe('其他')
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
  const domains = [{ id: 5, name: '设计UI' }, ...defaultConfig().domains]
  it('名称校验', () => {
    expect(checkDomainName('  ', domains)).toBe('请填写领域名。')
    expect(checkDomainName('设计/UI', domains)).toMatch('不能包含')
    expect(checkDomainName('设计UI', domains)).toBe('该领域名已存在，请换一个名称。')
    expect(checkDomainName('设计UI', domains, 5)).toBeNull()
    expect(checkDomainName('读书笔记', domains)).toBeNull()
  })
  it('新编号跳过“其他”的 99', () => {
    expect(nextDomainId(domains)).toBe(6)
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
    expect(checkBaseUrl('http://api.deepseek.com')).toBe('接口地址须以 https:// 开头。')
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
    expect(checkSubfolder('../别处')).toBe('子文件夹路径不能包含“.”或“..”层级。')
    expect(checkSubfolder('收藏/./抖音')).toBe('子文件夹路径不能包含“.”或“..”层级。')
    expect(checkSubfolder('C:/Windows')).toBe('子文件夹名不能包含：: * ? " < > |')
    expect(checkSubfolder('收藏//抖音')).toBe('子文件夹路径不能包含空层级。')
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
    expect(checkNewFolderName('收藏', existing)).toBe('“收藏”已存在，请直接选择。')
    expect(checkNewFolderName('收藏/小红书', existing)).toBe('文件夹名不能包含：\\ / : * ? " < > |')
    expect(checkNewFolderName('..', existing)).toBe('文件夹名不能是“.”或“..”。')
  })
})

describe('新增领域', () => {
  it('补入收藏库领域，保留旧领域编号和其他配置，重名及无效名字不新增', () => {
    const config = defaultConfig()
    config.domains.unshift({ id: 7, name: '设计UI' })
    const merged = mergeCollectionDomains(config, ['设计UI', 'AI与Agent', 'AI与Agent', '其他', '坏/领域'])
    expect(merged.domains).toEqual([
      { id: 7, name: '设计UI' },
      { id: 8, name: 'AI与Agent' },
      { id: 99, name: '其他' },
    ])
    expect(merged.services).toBe(config.services)
    expect(config.domains).toEqual([
      { id: 7, name: '设计UI' },
      { id: 99, name: '其他' },
    ])
    expect(mergeCollectionDomains(merged, ['设计UI', 'AI与Agent'])).toBe(merged)
  })
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
    expect(addDomain(defaultConfig(), '其他')).toBe('该领域名已存在，请换一个名称。')
  })
})
