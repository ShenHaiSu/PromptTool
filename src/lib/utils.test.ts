import { describe, it, expect } from "vitest"
import { ellipsis, dimColor } from "./utils"

describe("ellipsis", () => {
  it("短于上限原样返回", () => {
    expect(ellipsis("abc", 5)).toBe("abc")
  })

  it("超出上限截断并补省略号", () => {
    expect(ellipsis("abcdefgh", 5)).toBe("abcd…")
  })
})

describe("dimColor", () => {
  it("命中维度色板时返回色值", () => {
    expect(dimColor("body")).toBe("#EC4899")
  })

  it("未知维度回落默认灰", () => {
    expect(dimColor("not-a-dimension")).toBe("#94A3B8")
  })
})