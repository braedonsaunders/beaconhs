import { describe, expect, it } from 'vitest'
import {
  CATEGORY_NAME_CONFLICT_MESSAGE,
  CategoryNameConflictError,
  categoryErrorHref,
  categoryMutationErrorMessage,
  isUniqueViolation,
  safeCategoryReturnTo,
} from './_category-mutation-policy'
import { InvalidCategoryParentError } from './_category-parent-policy'

describe('document category mutation errors', () => {
  it('turns a concurrent unique conflict into truthful user feedback', () => {
    expect(categoryMutationErrorMessage(new CategoryNameConflictError())).toBe(
      CATEGORY_NAME_CONFLICT_MESSAGE,
    )
    expect(categoryMutationErrorMessage({ code: '23505' })).toBe(CATEGORY_NAME_CONFLICT_MESSAGE)
    expect(categoryMutationErrorMessage({ code: '23503' })).toBeNull()
    expect(isUniqueViolation({ code: '23505' })).toBe(true)
    expect(isUniqueViolation({ code: '23503' })).toBe(false)
  })

  it('preserves actionable hierarchy validation messages', () => {
    expect(
      categoryMutationErrorMessage(new InvalidCategoryParentError('Invalid parent choice.')),
    ).toBe('Invalid parent choice.')
  })

  it('keeps redirects on the category page and encodes the message', () => {
    expect(safeCategoryReturnTo('/documents/categories?page=3')).toBe(
      '/documents/categories?page=3',
    )
    expect(safeCategoryReturnTo('https://evil.example/')).toBe('/documents/categories')
    expect(categoryErrorHref('/documents/categories?q=sds', 'Name already exists.')).toBe(
      '/documents/categories?q=sds&categoryError=Name+already+exists.',
    )
  })
})
