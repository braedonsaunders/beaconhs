import { Alert, AlertDescription, AlertTitle } from '@beaconhs/ui'

export const metadata = { title: 'New form template' }

export default function NewTemplatePage() {
  return (
    <div className="max-w-2xl space-y-4">
      <h1 className="text-2xl font-semibold">New form template</h1>
      <Alert variant="info">
        <AlertTitle>Form designer (Phase 1)</AlertTitle>
        <AlertDescription>
          The drag-drop designer will live here. Scaffold is ready: schema in{' '}
          <code>@beaconhs/forms-core</code>, persistence in <code>form_template_versions</code>. Next
          step: build the split-pane designer UI (palette · canvas · properties).
        </AlertDescription>
      </Alert>
    </div>
  )
}
