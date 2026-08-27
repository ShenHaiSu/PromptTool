import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInvoke = vi.fn()
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}))

import { dbImportSegments, dbImportSegmentsText } from './db'

beforeEach(() => mockInvoke.mockReset())

describe('lib/db segment invoke mapping', () => {
  it('dbImportSegments calls db_import_segments with camelCase payload', async () => {
    const report = { prompts: 1, segmentsTotal: 2, segmentsImported: 2, segmentsSkipped: 0, segmentsIgnoredUnassigned: 0, modulesCreated: 2, modulesUpdated: 0, modulesSkipped: 0, errors: [], warnings: [] }
    mockInvoke.mockResolvedValueOnce(report)
    const r = await dbImportSegments({
      format: 'pmf-segments',
      formatVersion: 1,
      prompts: [{ id: 'p01', raw: 'a', segments: [{ dimensionKey: 'body', contentEn: 'slim waist' }] }],
      unassignedStrategy: 'ignore',
      mode: 'skip',
    })
    expect(mockInvoke).toHaveBeenCalledWith('db_import_segments', { payload: expect.any(Object) })
    expect(r.modulesCreated).toBe(2)
  })

  it('dbImportSegmentsText passes text + unassignedStrategy + mode', async () => {
    const report = { prompts: 1, segmentsTotal: 1, segmentsImported: 1, segmentsSkipped: 0, segmentsIgnoredUnassigned: 0, modulesCreated: 1, modulesUpdated: 0, modulesSkipped: 0, errors: [], warnings: [] }
    mockInvoke.mockResolvedValueOnce(report)
    await dbImportSegmentsText('{"format":"pmf-segments","formatVersion":1,"prompts":[]}', 'to_camera', 'overwrite')
    expect(mockInvoke).toHaveBeenCalledWith('db_import_segments_text', {
      text: '{"format":"pmf-segments","formatVersion":1,"prompts":[]}',
      unassignedStrategy: 'to_camera',
      mode: 'overwrite',
    })
  })
})
