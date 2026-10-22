// mammoth 的浏览器版没有自己的类型声明，只声明用到的这一个函数
declare module 'mammoth/mammoth.browser' {
  interface Mammoth {
    extractRawText(input: { arrayBuffer: ArrayBuffer }): Promise<{ value: string }>
  }
  const mammoth: Mammoth
  export default mammoth
  export const extractRawText: Mammoth['extractRawText']
}
