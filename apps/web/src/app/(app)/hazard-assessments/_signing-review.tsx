import type { HazidSigningSnapshot } from '@beaconhs/db/schema'
import { GeneratedValue } from '@/i18n/generated'
import { getGeneratedValueTranslations } from '@/i18n/generated.server'
import { RichContent } from '@/components/rich-content'
import { RawImage } from '@/components/raw-image'
import { FormRenderer } from '@/app/(app)/apps/templates/[id]/fill/form-renderer'

const headerFields = [
  ['reference', 'Reference'],
  ['type_name', 'Assessment type'],
  ['occurred_at', 'Date and time'],
  ['site_name', 'Site'],
  ['location_on_site', 'Location on site'],
  ['project_name', 'Project'],
  ['supervisor_name', 'Supervisor'],
  ['reported_by_name', 'Completed by'],
] as const
const sections = [
  {
    key: 'tasks',
    label: 'Tasks',
    columns: [
      ['name', 'Task'],
      ['hazard_names', 'Hazards'],
      ['controls', 'Controls'],
    ],
  },
  {
    key: 'hazards',
    label: 'Hazards',
    columns: [
      ['name', 'Hazard'],
      ['applicable', 'Applicable'],
      ['standard_controls', 'Standard controls'],
      ['specific_controls', 'Site-specific controls'],
      ['controls', 'Controls'],
      ['pre_likelihood', 'Initial likelihood'],
      ['pre_severity', 'Initial severity'],
      ['pre_risk', 'Initial risk'],
      ['post_likelihood', 'Residual likelihood'],
      ['post_severity', 'Residual severity'],
      ['post_risk', 'Residual risk'],
    ],
  },
  {
    key: 'ppe',
    label: 'PPE',
    columns: [
      ['name', 'Item'],
      ['description', 'Description'],
      ['required', 'Required'],
      ['answer', 'Answer'],
    ],
  },
  {
    key: 'questions',
    label: 'Questions',
    columns: [
      ['question', 'Question'],
      ['answer', 'Answer'],
      ['requires_yes', 'Yes required'],
    ],
  },
] as const

/** The exact frozen content, shared by remote review, shared-device collection and history. */
export async function SigningReview({ snapshot }: { snapshot: HazidSigningSnapshot }) {
  const tGeneratedValue = await getGeneratedValueTranslations()
  const values = snapshot.values
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {headerFields.map(([key, label]) =>
          values[key] ? (
            <div key={key}>
              <dt className="text-xs text-slate-500">
                <GeneratedValue value={label} />
              </dt>
              <dd className="font-medium">{String(values[key])}</dd>
            </div>
          ) : null,
        )}
      </dl>
      {values.job_scope ? (
        <div>
          <h3 className="font-semibold">
            <GeneratedValue value="Job scope" />
          </h3>
          <RichContent html={String(values.job_scope)} />
        </div>
      ) : null}
      {sections.map((section) => {
        const rows = Array.isArray(values[section.key])
          ? (values[section.key] as Record<string, unknown>[])
          : []
        if (!rows.length) return null
        return (
          <section key={section.key} className="space-y-2">
            <h3 className="font-semibold">
              <GeneratedValue value={section.label} />
            </h3>
            {rows.map((row, index) => (
              <dl key={index} className="space-y-2 rounded-lg border p-3 dark:border-slate-700">
                {section.columns.map(([key, label]) =>
                  row[key] !== undefined && row[key] !== '' ? (
                    <div key={key}>
                      <dt className="text-xs text-slate-500">
                        <GeneratedValue value={label} />
                      </dt>
                      <dd>
                        {['controls', 'standard_controls', 'specific_controls'].includes(key) ? (
                          <RichContent html={String(row[key])} />
                        ) : (
                          <span className="whitespace-pre-wrap">{String(row[key])}</span>
                        )}
                      </dd>
                    </div>
                  ) : null,
                )}
              </dl>
            ))}
          </section>
        )
      })}
      {Array.isArray(values.photos) && values.photos.length ? (
        <section className="space-y-2">
          <h3 className="font-semibold">
            <GeneratedValue value="Photos" />
          </h3>
          {(values.photos as { url: string; caption: string }[]).map((photo, index) => (
            <figure key={index}>
              <RawImage
                optimizationReason="authenticated"
                src={photo.url}
                alt={photo.caption || tGeneratedValue('Assessment photo')}
                className="max-h-96 max-w-full rounded object-contain"
              />
              {photo.caption ? <figcaption>{photo.caption}</figcaption> : null}
            </figure>
          ))}
        </section>
      ) : null}
      {snapshot.apps.map((app, index) => (
        <section key={index}>
          <FormRenderer
            inlineAutosave
            readOnly
            templateId={app.templateId}
            templateName={app.name}
            version={app.version}
            schema={app.schema}
            people={app.people}
            entitiesByField={app.entities}
            currentUser={{ personId: null, name: null }}
            initialValues={app.values}
            initialRows={Object.fromEntries(
              app.schema.sections.flatMap((section) =>
                section.repeating && Array.isArray(app.values[section.id])
                  ? [[section.id, app.values[section.id] as Record<string, unknown>[]]]
                  : [],
              ),
            )}
          />
        </section>
      ))}
    </div>
  )
}
