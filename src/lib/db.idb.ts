/**
 * IndexedDB 存储适配层入口（web-pure 阶段二）。
 * 与 `db.tauri.ts.bak` 同名导出，stores/components 只需 import `@/lib/db` 即可。
 * 具体实现按域拆分在同目录小模块中，本文件仅做聚合重导出：
 * - db.types.ts       报告 / 载荷类型
 * - db.rows.ts        内部行类型与共享工具
 * - db.dimensions.ts  维度 / 词条 CRUD
 * - db.assemblies.ts  拼装快照 CRUD + 回填
 * - db.templates.ts   模板 CRUD + 回填
 * - db.library.ts     词库导出 / 去重导入
 * - db.batch.ts       同维度批量建条目
 * - db.segments.ts    分段批量入库（pmf-segments）
 * - db.translation.ts 批量翻译回填
 * - db.rules.ts       规则 CRUD
 * - db.system.ts      文件落盘 / 多库注册表 / temp_carry
 */
export * from './db.types'
export * from './db.dimensions'
export * from './db.assemblies'
export * from './db.templates'
export * from './db.library'
export * from './db.batch'
export * from './db.segments'
export * from './db.translation'
export * from './db.rules'
export * from './db.system'
