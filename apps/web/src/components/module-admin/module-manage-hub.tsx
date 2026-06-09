// The per-module Manage hub landing — a tiles grid of a module's admin sections,
// driven entirely by the registry. Every module's /<module>/manage page renders
// this; nothing is hand-built per module.

import { PageHeader } from '@beaconhs/ui'
import { PageContainer } from '@/components/page-layout'
import { AdminTileGrid } from './admin-tile-grid'
import type { ModuleAdmin } from '@/lib/module-admin/registry'

export function ModuleManageHub({ module }: { module: ModuleAdmin }) {
  return (
    <PageContainer>
      <PageHeader
        title={`${module.label} administration`}
        description={`Configure ${module.label.toLowerCase()} — records, taxonomies, and settings.`}
        back={{ href: module.href, label: `Back to ${module.label}` }}
      />
      <div className="mt-6">
        <AdminTileGrid
          tiles={module.sections.map((s) => ({
            key: s.key,
            label: s.label,
            href: s.href,
            iconKey: s.iconKey,
            desc: s.desc,
          }))}
        />
      </div>
    </PageContainer>
  )
}
