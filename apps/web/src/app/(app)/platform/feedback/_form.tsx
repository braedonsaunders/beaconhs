'use client'

import { useTranslations } from 'next-intl'
import { Button, Input, Label } from '@beaconhs/ui'
import { clearPlatformFeedback, savePlatformFeedback } from '@/lib/feedback-settings-actions'
import type { FeedbackSettings } from '@/lib/feedback-config'

export function PlatformFeedbackForm({ settings }: { settings: FeedbackSettings }) {
  const t = useTranslations('Feedback')
  const common = useTranslations('Common')

  return (
    <div className="space-y-6">
      <form action={savePlatformFeedback} className="space-y-5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="enabled"
            defaultChecked={settings.enabled}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
          />
          <span>
            <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
              {t('enabled')}
            </span>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
              {t('enabledHelp')}
            </span>
          </span>
        </label>

        <div className="space-y-1.5">
          <Label htmlFor="feedback-owner">{t('owner')}</Label>
          <Input
            id="feedback-owner"
            name="owner"
            defaultValue={settings.owner}
            autoComplete="off"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="feedback-repo">{t('repo')}</Label>
          <Input id="feedback-repo" name="repo" defaultValue={settings.repo} autoComplete="off" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="feedback-token">{t('token')}</Label>
          <Input id="feedback-token" name="token" type="password" autoComplete="new-password" />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {settings.hasToken ? `${t('tokenSet')} ` : ''}
            {t('tokenHelp')}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="feedback-labels">{t('labels')}</Label>
          <Input
            id="feedback-labels"
            name="labels"
            defaultValue={settings.labels}
            autoComplete="off"
          />
          <p className="text-xs text-slate-500 dark:text-slate-400">{t('labelsHelp')}</p>
        </div>

        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            name="searchDuplicates"
            defaultChecked={settings.searchDuplicates}
            className="mt-1 h-4 w-4 rounded border-slate-300 text-teal-700 focus:ring-teal-500"
          />
          <span>
            <span className="block text-sm font-medium text-slate-900 dark:text-slate-100">
              {t('searchDuplicates')}
            </span>
            <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
              {t('searchDuplicatesHelp')}
            </span>
          </span>
        </label>

        <div className="flex justify-end">
          <Button type="submit">{common('save')}</Button>
        </div>
      </form>

      {settings.hasToken ? (
        <form
          action={clearPlatformFeedback}
          className="border-t border-slate-100 pt-4 dark:border-slate-800"
        >
          <Button type="submit" variant="ghost" className="text-red-600">
            {t('clearToken')}
          </Button>
        </form>
      ) : null}

      {!settings.ready ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">{t('notConfigured')}</p>
      ) : null}
    </div>
  )
}
