'use client'

import { GeneratedText, useGeneratedTranslations } from '@/i18n/generated'

// Print a blank assessment for on-site handwriting. Pick the type so the sheet
// carries that type's real hazards, PPE and questions with the answer columns
// left empty — a generic ruled page would make the crew write the hazard list
// out by hand too.

import { useState } from 'react'
import { Printer } from 'lucide-react'
import { Button, Select } from '@beaconhs/ui'
import { DownloadLink } from '@/components/download-link'

export function PrintBlankAssessment({ types }: { types: { id: string; name: string }[] }) {
  const tGenerated = useGeneratedTranslations()
  const [typeId, setTypeId] = useState(types[0]?.id ?? '')
  if (types.length === 0) return null

  return (
    <div className="flex items-center gap-1.5">
      <Select
        value={typeId}
        onChange={(event) => setTypeId(event.target.value)}
        aria-label={tGenerated('m_02ff3fbdf21f21')}
        className="h-9 w-44"
      >
        {types.map((type) => (
          <option key={type.id} value={type.id}>
            {type.name}
          </option>
        ))}
      </Select>
      <DownloadLink href={`/hazard-assessments/blank/pdf?typeId=${typeId}`}>
        <Button variant="outline" title={tGenerated('m_05ca9ff1bc4049')}>
          <Printer size={14} /> <GeneratedText id="m_00036852e1d66d" />
        </Button>
      </DownloadLink>
    </div>
  )
}
