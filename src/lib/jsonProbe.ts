/**
 * need03 S5：JSON 探测助手。
 * 解析器需要“试一下看是不是 JSON”的探针式 try/catch，
 * 统一收敛到本文件，避免在业务代码里出现空 catch（00 铁律 4 / 06 §3）。
 */
import { logger } from './logger'

/** 探测文本是否为合法 JSON（非法不是业务错误，仅 debug 级输出）。 */
export function isParsableJson(text: string): boolean {
  try {
    JSON.parse(text)
    return true
  } catch (e) {
    logger.warn('jsonProbe', '文本不是合法 JSON：', e)
    return false
  }
}

/** 探测并返回解析结果，失败返回 undefined。 */
export function tryParseJson<T = unknown>(text: string): T | undefined {
  try {
    return JSON.parse(text) as T
  } catch (e) {
    logger.warn('jsonProbe', 'JSON 解析失败：', e)
    return undefined
  }
}