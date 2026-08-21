'use client'

import { useMemo } from 'react'
import { getDictionary } from '@/lib/i18n/translations'
import { useCRMStore } from '@/lib/store'

export function useTranslations() {
  const language = useCRMStore((state) => state.settings.language)

  return useMemo(
    () => ({ language, t: getDictionary(language) }),
    [language]
  )
}
