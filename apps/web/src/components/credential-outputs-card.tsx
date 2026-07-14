import Link from 'next/link'
import { CreditCard, FileText, Settings } from 'lucide-react'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@beaconhs/ui'
import type { CredentialOutput } from '../lib/credential-designs'
import { credentialFormatLabel, credentialOutputActions } from '../lib/credential-output-actions'

export function CredentialOutputsCard({
  outputs,
  endpoint,
  canDesign,
  unavailable = false,
}: {
  outputs: CredentialOutput[]
  endpoint: string
  canDesign: boolean
  unavailable?: boolean
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Cards &amp; certificates ({outputs.length})</CardTitle>
          {canDesign ? (
            <Button asChild variant="outline" size="sm">
              <Link href="/training/credential-designs">
                <Settings size={14} /> Design
              </Link>
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {unavailable ? (
          <p className="text-sm text-red-700 dark:text-red-400">
            Credentials are unavailable because this item has been revoked.
          </p>
        ) : (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Open a PDF to print or save it from your browser's PDF viewer.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {credentialOutputActions(outputs, endpoint).map(({ output, label, href }) => (
            <div
              key={output.id}
              className="flex min-h-44 flex-col rounded-lg border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-start gap-3">
                <div
                  className="grid h-11 w-11 shrink-0 place-items-center rounded-md border"
                  style={{
                    borderColor: output.accent,
                    color: output.primary,
                    backgroundColor: output.paper,
                  }}
                >
                  <CredentialOutputIcon output={output} size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold text-slate-900 dark:text-slate-100">
                    {output.name}
                  </div>
                  <div className="mt-1">
                    <Badge variant="secondary">{credentialFormatLabel(output.format)}</Badge>
                  </div>
                </div>
              </div>
              <p className="mt-3 line-clamp-2 text-sm text-slate-600 dark:text-slate-400">
                {output.description}
              </p>
              <div className="mt-auto pt-4">
                {unavailable ? (
                  <Button variant="outline" size="sm" disabled title="Credential unavailable">
                    <CredentialOutputIcon output={output} /> {label}
                  </Button>
                ) : (
                  <Button asChild variant="outline" size="sm">
                    <Link
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={`Open ${output.name}`}
                    >
                      <CredentialOutputIcon output={output} /> {label}
                    </Link>
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function CredentialOutputIcon({ output, size = 14 }: { output: CredentialOutput; size?: number }) {
  return output.format === 'wallet' ? <CreditCard size={size} /> : <FileText size={size} />
}
