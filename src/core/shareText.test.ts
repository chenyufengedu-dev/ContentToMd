import { describe, expect, it } from 'vitest'
import { parseShareText } from './shareText'

describe('parseShareText', () => {
  it('抖音分享文字：链接、平台、作者', () => {
    const r = parseShareText(
      '7.53 复制打开抖音，看看【礼仪老师小王的作品】商务礼仪三重点 # 商务礼仪 # 职场  https://v.douyin.com/iAbC123/ Xzm:/ 01/12 d@N.Wm',
    )
    expect(r).toEqual({ url: 'https://v.douyin.com/iAbC123/', platform: '抖音', author: '礼仪老师小王' })
  })
  it('小红书新版分享文字：作者在标题后面', () => {
    const r = parseShareText(
      '【敬酒礼仪一次讲清 - 职场小林 | 小红书 - 你的生活指南】 😆 AbCdEf 😆 https://www.xiaohongshu.com/discovery/item/66aa?xsec_token=x',
    )
    expect(r).toEqual({
      url: 'https://www.xiaohongshu.com/discovery/item/66aa?xsec_token=x',
      platform: '小红书',
      author: '职场小林',
    })
  })
  it('小红书短链、没有作者', () => {
    expect(parseShareText('敬酒礼仪 http://xhslink.com/a/AbCd，复制本条信息，打开【小红书】App查看精彩内容！')).toEqual(
      { url: 'http://xhslink.com/a/AbCd', platform: '小红书', author: '' },
    )
  })
  it('普通网址：只有链接', () => {
    expect(parseShareText('https://example.com/a')).toEqual({ url: 'https://example.com/a', platform: '', author: '' })
  })
  it('没有链接：认不出', () => {
    expect(parseShareText('就是一段话')).toBeNull()
  })
  it('只是一条链接时不算分享文字', () => {
    expect(parseShareText('https://v.douyin.com/iAbC123/')).toEqual({
      url: 'https://v.douyin.com/iAbC123/',
      platform: '抖音',
      author: '',
    })
  })
})
