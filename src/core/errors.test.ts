import { expect, it } from 'vitest'
import { AppError, describeError } from './errors'

it('余额不足按错误码明确提示服务商充值，不依赖服务返回文字', () => {
  expect(describeError(new AppError('balance', '旧提示', 'HTTP 402'), 'DeepSeek')).toEqual({
    code: 'balance',
    message: 'DeepSeek 账户余额不足，请先充值。',
    detail: 'HTTP 402',
  })
  expect(describeError(new AppError('balance', '旧提示'), '硅基流动').message).toBe('硅基流动 账户余额不足，请先充值。')
})

it('密钥无效和网络失败保留各自错误码及提示，不误报余额不足', () => {
  for (const code of ['auth', 'network'] as const) {
    expect(describeError(new AppError(code, '原提示'), 'DeepSeek')).toEqual({
      code,
      message: '原提示',
      detail: undefined,
    })
  }
})
