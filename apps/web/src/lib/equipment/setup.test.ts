import { describe, expect, it } from 'vitest'
import { emptyEquipmentSetup, equipmentSetupStepError, equipmentSetupSectionsError } from './setup'
describe('guided equipment creation', () => {
  it('requires identification or an explicit explanation rather than silently creating untitled records', () => {
    const value = {
      ...emptyEquipmentSetup('request'),
      categoryId: 'category',
      typeId: 'type',
      name: 'Mixer',
      assetTag: 'MX-1',
    }
    expect(equipmentSetupStepError(value, 1)).toMatch(/serial number/)
    expect(
      equipmentSetupStepError(
        {
          ...value,
          identifyingDetailsUnavailable: true,
          identifyingDetailsReason: 'This item has no manufacturer serial.',
        },
        1,
      ),
    ).toBeNull()
    expect(equipmentSetupStepError({ ...value, fields: { serialNumber: 'SN-1' } }, 1)).toBeNull()
  })
  it('requires both inspection decisions and rejects an empty schedule', () => {
    const value = emptyEquipmentSetup('request')
    expect(equipmentSetupStepError(value, 2)).toMatch(/both inspection/)
    expect(
      equipmentSetupStepError(
        { ...value, preUseRequired: false, scheduledInspectionsRequired: true },
        2,
      ),
    ).toMatch(/Add the scheduled/)
    expect(
      equipmentSetupStepError(
        { ...value, preUseRequired: false, scheduledInspectionsRequired: false },
        2,
      ),
    ).toMatch(/Explain/)
  })
  it('requires an intentional maintenance decision and final confirmation', () => {
    const value = emptyEquipmentSetup('request')
    expect(equipmentSetupStepError(value, 3)).toMatch(/Choose/)
    expect(equipmentSetupStepError({ ...value, maintenanceRequired: true }, 3)).toMatch(
      /at least one/,
    )
    expect(equipmentSetupStepError(value, 4)).toMatch(/Review/)
    expect(equipmentSetupStepError({ ...value, reviewed: true }, 4)).toBeNull()
  })
  it('requires a current reading and a due point for active usage-based maintenance', () => {
    const value = {
      ...emptyEquipmentSetup('request'),
      maintenanceRequired: true,
      maintenance: [
        {
          name: 'Service',
          rules: [{ kind: 'meter' as const, meter: 'engine_hours', every: 250, dueAt: 1000 }],
          match: 'any' as const,
          isActive: true,
        },
      ],
    }
    expect(equipmentSetupStepError(value, 3)).toMatch(/current equipment reading/)
    expect(equipmentSetupStepError({ ...value, fields: { currentHours: '0' } }, 3)).toBeNull()
    expect(
      equipmentSetupStepError(
        { ...value, maintenance: [{ ...value.maintenance[0]!, isActive: false }] },
        3,
      ),
    ).toBeNull()
  })
  it('shows only category-enabled groups and requires an explicit explanation for missing essentials', () => {
    const value = { ...emptyEquipmentSetup('request'), fields: { serialNumber: 'SN' } }
    expect(equipmentSetupSectionsError(value, [])).toBeNull()
    expect(equipmentSetupSectionsError(value, ['manufacture'])).toMatch(/Complete/)
    expect(
      equipmentSetupSectionsError({ ...value, fields: { manufacturer: 'Acme', model: 'M1' } }, [
        'manufacture',
      ]),
    ).toBeNull()
    expect(
      equipmentSetupSectionsError(
        {
          ...value,
          sections: {
            manufacture: { unavailable: true, reason: 'Label missing; awaiting supplier details.' },
          },
        },
        ['manufacture'],
      ),
    ).toBeNull()
  })
})
