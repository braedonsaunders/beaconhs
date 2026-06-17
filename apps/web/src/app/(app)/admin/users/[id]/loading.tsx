import { DetailSkeleton } from '@/components/detail-skeleton'

// Detail-shaped loading state so clicking into a member doesn't inherit the
// list skeleton from /admin/users/loading.tsx.
export default function Loading() {
  return <DetailSkeleton />
}
