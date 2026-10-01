import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RequestContext } from '@beaconhs/tenant'

const mocks = vi.hoisted(() => ({ load: vi.fn(), execute: vi.fn(), actions: vi.fn() }))
vi.mock('node:module', () => ({ createRequire: () => mocks.load }))
vi.mock('@/lib/audit', () => ({ recordAuditInTransaction: vi.fn() }))
import { executeTenantPluginAction, loadTenantPluginActions, tenantInstallations } from './host'

const tenantId = '362623eb-f615-4610-b2f9-3422dde18cf4'
const otherTenantId = '462623eb-f615-4610-b2f9-3422dde18cf4'
const context = {
  ctx: { tenantId } as RequestContext,
  surface: 'test.surface',
  target: { recordId: 'record' },
}
const installation = {
  tenantId,
  pluginId: 'test-plugin',
  modulePath: '/opt/tenant-plugins/test.cjs',
}
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('TENANT_PLUGIN_INSTALLATIONS', JSON.stringify([installation]))
  mocks.actions.mockResolvedValue([
    {
      id: 'do-work',
      label: 'Do work',
      fields: [
        { name: 'source', label: 'Source', options: [{ value: 'allowed', label: 'Allowed' }] },
      ],
    },
  ])
  mocks.execute.mockResolvedValue({ message: 'Done' })
  mocks.load.mockReturnValue({
    createPlugin: () => ({
      apiVersion: 1,
      id: 'test-plugin',
      actions: mocks.actions,
      execute: mocks.execute,
    }),
  })
})
describe('trusted tenant extension host', () => {
  it('does not load artifacts belonging to another tenant or absent installations', async () => {
    expect(
      await loadTenantPluginActions({
        ...context,
        ctx: { tenantId: otherTenantId } as RequestContext,
      }),
    ).toEqual({ actions: [], unavailable: false })
    expect(mocks.load).not.toHaveBeenCalled()
    vi.stubEnv('TENANT_PLUGIN_INSTALLATIONS', '[]')
    expect(await loadTenantPluginActions(context)).toEqual({ actions: [], unavailable: false })
    expect(mocks.load).not.toHaveBeenCalled()
    await expect(executeTenantPluginAction(context, 'test-plugin', 'do-work', {})).rejects.toThrow(
      'not installed',
    )
  })
  it('rejects nonabsolute paths, duplicate installations and unrecognized configuration fields', () => {
    expect(() =>
      tenantInstallations(
        tenantId,
        JSON.stringify([{ ...installation, modulePath: '../test.cjs' }]),
      ),
    ).toThrow()
    expect(() =>
      tenantInstallations(tenantId, JSON.stringify([installation, installation])),
    ).toThrow('Duplicate')
    expect(() =>
      tenantInstallations(tenantId, JSON.stringify([{ ...installation, secret: 'forbidden' }])),
    ).toThrow()
  })
  it('surfaces artifact failures without crashing the native workspace', async () => {
    mocks.load.mockImplementationOnce(() => {
      throw new Error('Missing artifact')
    })
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await loadTenantPluginActions(context)).toEqual({ actions: [], unavailable: true })
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })
  it('rechecks action availability and validates fields before invoking private code', async () => {
    await expect(
      executeTenantPluginAction(context, 'test-plugin', 'do-work', { source: 'forged' }),
    ).rejects.toThrow('Choose Source')
    await expect(
      executeTenantPluginAction(context, 'test-plugin', 'do-work', {
        source: 'allowed',
        recordId: 'other',
      }),
    ).rejects.toThrow('Unknown')
    expect(mocks.execute).not.toHaveBeenCalled()
    mocks.actions.mockResolvedValueOnce([
      { id: 'do-work', label: 'Do work', disabledReason: 'Disabled' },
    ])
    await expect(executeTenantPluginAction(context, 'test-plugin', 'do-work', {})).rejects.toThrow(
      'unavailable',
    )
    expect(mocks.execute).not.toHaveBeenCalled()
    expect(
      await executeTenantPluginAction(context, 'test-plugin', 'do-work', { source: 'allowed' }),
    ).toEqual({ message: 'Done' })
    expect(mocks.execute).toHaveBeenCalledWith(context, 'do-work', { source: 'allowed' })
  })
  it('checks installed module identity and descriptor uniqueness', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.load.mockReturnValueOnce({
      createPlugin: () => ({
        apiVersion: 1,
        id: 'other-plugin',
        actions: mocks.actions,
        execute: mocks.execute,
      }),
    })
    expect((await loadTenantPluginActions(context)).unavailable).toBe(true)
    mocks.actions.mockResolvedValueOnce([
      { id: 'same', label: 'One' },
      { id: 'same', label: 'Two' },
    ])
    expect((await loadTenantPluginActions(context)).unavailable).toBe(true)
    error.mockRestore()
  })
})
