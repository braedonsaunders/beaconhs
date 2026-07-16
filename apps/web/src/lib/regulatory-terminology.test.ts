import { describe, expect, it } from 'vitest'
import { DEFAULT_REGULATORY_TERMINOLOGY, resolveRegulatoryTerminology } from '@beaconhs/tenant'

describe('tenant regulatory terminology', () => {
  it('uses safe defaults for an unconfigured tenant', () => {
    expect(resolveRegulatoryTerminology({})).toEqual(DEFAULT_REGULATORY_TERMINOLOGY)
  })

  it('normalizes the tenant authority, legislation, and additional requirements', () => {
    expect(
      resolveRegulatoryTerminology({
        regulatoryTerminology: {
          authorityName: '  Ministry of Labour  ',
          authorityAbbreviation: ' MOL ',
          legislationName: ' Occupational Health and Safety Act ',
          legislationAbbreviation: ' OHSA ',
          otherApplicableLegislation: 'Construction Projects Regulation\nClient standard',
        },
      }),
    ).toEqual({
      authorityName: 'Ministry of Labour',
      authorityAbbreviation: 'MOL',
      legislationName: 'Occupational Health and Safety Act',
      legislationAbbreviation: 'OHSA',
      otherApplicableLegislation: 'Construction Projects Regulation\nClient standard',
    })
  })
})
