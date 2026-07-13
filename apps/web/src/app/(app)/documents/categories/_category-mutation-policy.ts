import { InvalidCategoryParentError } from './_category-parent-policy'

export const CATEGORY_NAME_CONFLICT_MESSAGE =
  'An active category with that name already exists under the selected parent.'
export const CATEGORY_DELETE_CONFLICT_MESSAGE =
  'This category cannot be deleted because moving its children up one level would create duplicate sibling names.'

export class CategoryNameConflictError extends Error {
  constructor() {
    super(CATEGORY_NAME_CONFLICT_MESSAGE)
    this.name = 'CategoryNameConflictError'
  }
}

export function categoryMutationErrorMessage(error: unknown): string | null {
  if (error instanceof InvalidCategoryParentError) return error.message
  if (error instanceof CategoryNameConflictError) return error.message
  if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
    return CATEGORY_NAME_CONFLICT_MESSAGE
  }
  return null
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

export function safeCategoryReturnTo(value: FormDataEntryValue | null): string {
  const raw = typeof value === 'string' ? value : ''
  return raw === '/documents/categories' || raw.startsWith('/documents/categories?')
    ? raw
    : '/documents/categories'
}

export function categoryErrorHref(returnTo: string, message: string): string {
  const url = new URL(returnTo, 'https://beaconhs.invalid')
  url.searchParams.set('categoryError', message)
  return `${url.pathname}?${url.searchParams.toString()}`
}
