# Mocha 单元测试配置

本项目已从 Vitest 迁移到 Mocha 作为单元测试框架。

## 安装的依赖

- `mocha`: 测试框架
- `chai`: 断言库
- `tsx`: TypeScript / ESM 测试加载；不使用旧 Babel register

## 测试脚本

在 `package.json` 中配置了以下测试脚本：

- `npm test` / `npm run test:run`: 普通发布回归；保留身份/ACL、幂等、状态恢复、交付、阅读器、语音与实际游戏运行时回归。16个离线资产/历史工具验收文件从本入口移除。
- `npm run test:watch`: 监听模式运行测试
- `npm run test:assets`: 离线资产生成/迁移、E13 像素重算与 E14 性能验收。
- `npm run test:all`: 发布回归 + 所有资产工具回归。
- 正式验证继续复用 Flow4403172：默认 `CYF_TEST_PROFILE=release`；涉及 `public/juyiting`、资产生成器、离线 renderer、E13/E14 benchmark 或其 fixture/验收工具时，Owner 在同固定源码 Flow 中选择 `CYF_TEST_PROFILE=all`，不以普通发布结果冒充资产验收。只诊断资产工具可选 `assets`。资产profile保留固定 Node/Chrome、SHA/签名及10秒预热/60秒采样；不缩短测试断言/采样。

## 测试文件位置

测试文件位于 `tests/` 目录下，使用 `.spec.js` 或 `.test.js` 扩展名。

## 运行测试

运行普通发布回归（资产专项用 `npm run test:assets`，全部用 `npm run test:all`）：
```bash
npm test
```

运行特定测试文件：
```bash
npx mocha tests/composables/useHttp.spec.js
```

运行多个测试文件：
```bash
npm test -- --grep "useHttp"
```

## 测试编写示例

```javascript
import { expect } from 'chai'
import { cleanup } from '../setup.js'

describe('测试套件', () => {
  afterEach(() => {
    cleanup() // 清理测试环境
  })

  it('应该通过基本断言', () => {
    expect(true).to.be.true
    expect(1 + 1).to.equal(2)
  })

  it('应该处理对象', () => {
    const obj = { name: 'test' }
    expect(obj).to.have.property('name')
    expect(obj.name).to.equal('test')
  })
})
```

## 注意事项

1. **Vue 组件测试**: 由于 Node.js 无法直接处理 `.vue` 文件，Vue 组件测试需要额外的配置。当前配置主要支持 JavaScript 测试。

2. **ES 模块**: 项目已配置为 ES 模块 (`"type": "module"`)，所有导入需要使用 ES 模块语法。

3. **DOM 环境**: 测试设置中已配置了 JSDOM 环境，支持 DOM 相关的测试。

## 从 Vitest 迁移的更改

1. 移除了 `vitest` 和 `@vitest/ui` 依赖
2. 添加了 `mocha` 和 `chai` 依赖
3. 更新了测试脚本
4. 创建了 Mocha 配置文件 `.mocharc.json`
5. 修改了测试文件中的断言语法
6. 更新了测试设置文件 `tests/setup.js`
7. 添加了 ES 模块支持 (`"type": "module"`)

## 2026-10-09 范围收敛

基线 c6ae760，受测模块限测试入口/依赖及缓存准备，不重标业务版本已上线。删除未进入原CI入口的3个HelloWorld脚手架用例，移除6个未使用直接devDependency；E13完整正向重算原先执行两次，现在只执行一次并合并原有live/review/pending断言。关键负向篡改测试未删除，仍在assets/all。`.mocharc.json`的ignore与`.mocharc.assets.json`的spec列出同一16个文件；`.mocharc.all.json`保留原完整覆盖。Flow报告附带`ci-profile.json`明确本Run的覆盖范围。
