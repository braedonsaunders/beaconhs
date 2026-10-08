// @vitest-environment jsdom
import { act, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FormSchemaV1 } from '@beaconhs/forms-core'

const mocks = vi.hoisted(() => ({ listOrgUnitOptions: vi.fn(), save: vi.fn() }))
vi.mock('./actions', () => ({
  analyzePhotos: vi.fn(),
  createDraftResponse: mocks.save,
  draftSketchDiagram: vi.fn(),
  fetchEntityAttrs: vi.fn(),
  listOrgUnitOptions: mocks.listOrgUnitOptions,
  saveFormResponseDraft: mocks.save,
  submitFormResponse: mocks.save,
  updateResponseField: mocks.save,
}))
vi.mock('@/app/(app)/apps/_lib/data-sources', () => ({
  aggregateDataSource: vi.fn(),
  queryDataSource: vi.fn(),
}))
vi.mock('@/i18n/generated', () => ({
  GeneratedValue: ({ value }: { value: ReactNode }) => value,
  GeneratedText: () => null,
  useGeneratedTranslations: () => (key: string) => key,
  useGeneratedValueTranslations: () => (value: string) => value,
}))
vi.mock('next-intl', () => ({ useLocale: () => 'en', useTranslations: () => (key: string) => key }))
vi.mock('next/link', () => ({ default: ({ children }: { children: ReactNode }) => children }))
vi.mock('next/dynamic', () => ({ default: () => () => null }))
vi.mock('@/lib/uploads', () => ({ finalizeUpload: vi.fn(), requestUpload: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/signature-pad', () => ({ SignaturePad: () => null }))
vi.mock('@/components/raw-image', () => ({ RawImage: () => null }))
vi.mock('@/components/risk-matrix', () => ({ RiskMatrixField: () => null }))
vi.mock('@/components/file-upload', () => ({ FileUpload: () => null, dataUrlToFile: vi.fn() }))
vi.mock('@/components/photo-gallery', () => ({ PhotoGallery: () => null }))
vi.mock('@/components/remote-search-select', () => ({ RemoteSearchSelect: () => null }))
vi.mock('@/components/page-layout', () => ({
  WizardLayout: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}))
vi.mock('@/components/section', () => ({
  Section: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  ),
}))
vi.mock('@/components/premium-section', () => ({
  PremiumSection: ({ children }: { children: ReactNode }) => <section>{children}</section>,
}))
vi.mock('@beaconhs/ui', () => ({
  Alert: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AlertDescription: () => null,
  AlertTitle: () => null,
  Badge: () => null,
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  DetailHeader: () => null,
  Drawer: () => null,
  Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} />,
  Label: ({ children }: { children: ReactNode }) => <label>{children}</label>,
  RichTextEditor: () => null,
  SearchSelect: () => null,
  Select: () => null,
  Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => <textarea {...props} />,
  uploadReservedFile: vi.fn(),
}))
import { FormRenderer } from './form-renderer'

let dispose: (() => Promise<void>) | undefined
afterEach(async () => {
  await dispose?.()
  dispose = undefined
  vi.clearAllMocks()
})
const schema: FormSchemaV1 = {
  schemaVersion: 1,
  title: { en: 'Attached job form' },
  tabs: [
    { id: 'one', title: { en: 'First tab' } },
    { id: 'two', title: { en: 'Second tab' } },
  ],
  sections: [
    {
      id: 'first',
      step: 'start',
      tabId: 'one',
      title: { en: 'First section' },
      fields: [{ id: 'scope', type: 'text', label: { en: 'Work scope' } }],
    },
    {
      id: 'second',
      step: 'end',
      tabId: 'two',
      title: { en: 'Last section' },
      fields: [
        { id: 'controls', type: 'text', label: { en: 'Critical controls' } },
        { id: 'site', type: 'site_picker', label: { en: 'Job site' } },
        {
          id: 'blank',
          type: 'text',
          label: { en: 'Intentionally blank' },
          defaultValue: { kind: 'literal', value: 'Invented default' },
        },
      ],
    },
  ],
  workflow: {
    steps: [
      { key: 'start', title: { en: 'Start' }, assignee: { type: 'role', role: 'worker' } },
      { key: 'end', title: { en: 'End' }, assignee: { type: 'role', role: 'worker' } },
    ],
  },
}
describe('read-only form review', () => {
  it.each([false, true])(
    'shows every step/tab, keeps blanks, and uses captured picker names (inline=%s)',
    async (inlineAutosave) => {
      Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
      const container = document.createElement('div')
      document.body.append(container)
      const root = createRoot(container)
      dispose = async () => {
        await act(async () => root.unmount())
        container.remove()
      }
      await act(async () =>
        root.render(
          <FormRenderer
            readOnly
            inlineAutosave={inlineAutosave}
            templateId="template"
            templateName="Attached job form"
            version={1}
            schema={schema}
            people={[]}
            entitiesByField={{ site: { name: 'Original job site' } }}
            currentUser={{ personId: null, name: null }}
            initialValues={{
              scope: 'Install handrail',
              controls: 'Isolate equipment',
              site: 'site-uuid',
            }}
          />,
        ),
      )
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20))
      })
      expect(container.textContent).toContain('Original job site')
      expect([...container.querySelectorAll('input')].map((input) => input.value)).toEqual(
        expect.arrayContaining(['Install handrail', 'Isolate equipment', '']),
      )
      expect([...container.querySelectorAll('input')].map((input) => input.value)).not.toContain(
        'Invented default',
      )
      expect(mocks.listOrgUnitOptions).not.toHaveBeenCalled()
      expect(mocks.save).not.toHaveBeenCalled()
    },
  )
})
