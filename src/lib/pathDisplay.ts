/**
* need07 前端路径展示工具：与后端 `strip_verbatim` 同规则，前后端单测互相锁定。
* 只做展示兜底，不做比较去重（比较以后端 `norm_key` 为准）。
*/
const VERB = '\\\\?\\'
const UNC = '\\\\?\\UNC\\'
const GLOBALROOT = '\\\\?\\GLOBALROOT\\'

export function stripVerbatim(p: string): string {
  if (p.startsWith(UNC)) return '\\\\' + p.slice(UNC.length)
  if (p.startsWith(VERB)) {
    if (p.startsWith(GLOBALROOT)) return p
    return p.slice(VERB.length)
  }
  return p
}

/** 展示形态：脱壳 + 去首尾空格。 */
export function displayPath(p: string): string {
  return stripVerbatim((p ?? '').trim())
}
