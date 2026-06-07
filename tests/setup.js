import { JSDOM } from 'jsdom'

// 设置全局的 DOM 环境
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  url: 'http://localhost'
})

// 在 ES 模块中，我们需要更小心地设置全局属性
Object.defineProperty(global, 'window', { value: dom.window, writable: true })
Object.defineProperty(global, 'document', { value: dom.window.document, writable: true })
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, writable: true })

// 导出轻量 cleanup，避免在 jsdom 初始化前加载 Vue runtime。
export const cleanup = () => {
  document.body.innerHTML = ''
}
