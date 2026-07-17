import { describe, expect, it } from 'vitest'
import { resolveComplianceLink } from './_resolve-link'

describe('compliance completion links', () => {
  it('carries exact form-obligation provenance into the filler', () => {
    expect(
      resolveComplianceLink(
        'form',
        { formTemplateId: '10000000-0000-4000-8000-000000000001' },
        { obligationId: '20000000-0000-4000-8000-000000000002' },
      ),
    ).toEqual({
      href: '/apps/templates/10000000-0000-4000-8000-000000000001/fill?obligationId=20000000-0000-4000-8000-000000000002',
      prefetch: false,
    })
  })

  it('keeps normal on-demand form links unassigned', () => {
    expect(
      resolveComplianceLink('form', {
        formTemplateId: '10000000-0000-4000-8000-000000000001',
      }),
    ).toEqual({
      href: '/apps/templates/10000000-0000-4000-8000-000000000001/fill',
      prefetch: false,
    })
  })

  it('reviews the exact completed response instead of opening another blank entry', () => {
    expect(
      resolveComplianceLink(
        'form',
        { formTemplateId: '10000000-0000-4000-8000-000000000001' },
        { responseId: '30000000-0000-4000-8000-000000000003' },
      ),
    ).toEqual({
      href: '/apps/responses/30000000-0000-4000-8000-000000000003',
      prefetch: true,
    })
  })

  it('opens course requirements in the learner runtime', () => {
    expect(
      resolveComplianceLink('training', {
        courseId: '40000000-0000-4000-8000-000000000004',
      }),
    ).toEqual({
      href: '/training/learn/40000000-0000-4000-8000-000000000004',
      prefetch: true,
    })
  })

  it('carries exact assessment-obligation provenance into the attempt', () => {
    expect(
      resolveComplianceLink(
        'training',
        { assessmentTypeId: '50000000-0000-4000-8000-000000000005' },
        {
          personId: '60000000-0000-4000-8000-000000000006',
          obligationId: '80000000-0000-4000-8000-000000000008',
        },
      ),
    ).toEqual({
      href: '/training/assessments?drawer=new&typeId=50000000-0000-4000-8000-000000000005&personId=60000000-0000-4000-8000-000000000006&obligationId=80000000-0000-4000-8000-000000000008',
      prefetch: true,
    })
  })

  it('opens skill requirements in the learner wallet', () => {
    expect(
      resolveComplianceLink('cert_requirement', {
        skillTypeId: '70000000-0000-4000-8000-000000000007',
      }),
    ).toEqual({ href: '/my/wallet', prefetch: true })
  })
})
