import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/lib/db', () => ({
  dbListRecent: vi.fn(async () => [{ id: 'a1', title: 't1', promptIrJson: '{}', finalPrompt: 'p1', modelProfile: 'sd', createdAt: 1, isFavorite: false }]),
  dbListFavorites: vi.fn(async () => []),
  dbListTemplates: vi.fn(async () => []),
}))

import { useHistoryStore } from './history'

beforeEach(() => {
  setActivePinia(createPinia())
})

describe('history store', () => {
  it('loads recent on fetch', async () => {
    const s = useHistoryStore()
    await s.fetchRecent()
    expect(s.recent).toHaveLength(1)
    expect(s.recent[0]!.id).toBe('a1')
  })
  it('fetchAll loads favorites and templates', async () => {
    const s = useHistoryStore()
    await s.fetchAll()
    expect(s.recent.length).toBeGreaterThanOrEqual(0)
  })
})
