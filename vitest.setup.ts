// vitest 全局 setup（web-pure 阶段二）：为 jsdom 提供 IndexedDB 内存实现，
// 使组件/Store 测试能直接调用 db.idb 真实现。仅测试环境生效，不影响生产构建。
import 'fake-indexeddb/auto'
