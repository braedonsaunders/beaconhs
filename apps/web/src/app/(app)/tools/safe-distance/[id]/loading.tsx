import { DetailSkeleton } from '@/components/detail-skeleton'

// Detail-shaped loading state so navigating into an assessment doesn't inherit
// the list table/card skeleton from /tools/safe-distance/loading.tsx.
export default function Loading() {
  return <DetailSkeleton />
}
