import * as React from 'react'
import type { SelectOption } from './search-select'

type ParsedSelectChildren = {
  options: SelectOption[]
  placeholder?: string
  clearable: boolean
  emptyLabel?: string
}

export function selectChildrenEqual(
  left: ParsedSelectChildren,
  right: ParsedSelectChildren,
): boolean {
  return (
    left.placeholder === right.placeholder &&
    left.emptyLabel === right.emptyLabel &&
    left.clearable === right.clearable &&
    left.options.length === right.options.length &&
    left.options.every((option, index) => {
      const other = right.options[index]
      return (
        option.value === other?.value &&
        option.label === other.label &&
        option.disabled === other.disabled &&
        option.group === other.group
      )
    })
  )
}

/** Read the resolved option tree after React components have rendered inside
 * the hidden native select. This covers option-producing components, which
 * cannot be evaluated safely while parsing the original ReactNode tree. */
export function parseNativeSelect(select: HTMLSelectElement): ParsedSelectChildren {
  const options: SelectOption[] = []
  let placeholder: string | undefined
  let emptyLabel: string | undefined
  let clearable = false
  let seenAny = false

  for (const option of select.options) {
    const label = option.textContent?.trim() || option.label || option.value
    if (option.value === '' && !seenAny) {
      placeholder = label || undefined
      emptyLabel = label || 'None'
      clearable = !option.disabled
      seenAny = true
      continue
    }
    seenAny = true
    if (option.hidden) continue
    const parent = option.parentElement
    const inGroup = parent instanceof HTMLOptGroupElement
    options.push({
      value: option.value,
      label: label || option.value,
      disabled: option.disabled || (inGroup && parent.disabled),
      group: inGroup ? parent.label : undefined,
    })
  }

  return { options, placeholder, clearable, emptyLabel }
}

function textOf(node: React.ReactNode): string {
  if (node == null || node === false || node === true) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement(node)) {
    const props = node.props as { children?: React.ReactNode; value?: React.ReactNode }
    // Translation and conditional-render helpers are intentionally transparent
    // React components. Their rendered content is carried in `value`, not
    // `children`, so read it when deriving the visible typeahead label.
    return textOf(props.children ?? (typeof node.type !== 'string' ? props.value : undefined))
  }
  return ''
}

// Flatten <option>/<optgroup> children into a SelectOption[] for the typeahead.
// A leading <option value=""> becomes the placeholder (greyed); if it isn't
// disabled it also makes the field clearable back to "".
export function parseSelectChildren(children: React.ReactNode): ParsedSelectChildren {
  const options: SelectOption[] = []
  let placeholder: string | undefined
  let emptyLabel: string | undefined
  let clearable = false
  let seenAny = false

  const pushOption = (el: React.ReactElement, group?: string) => {
    const props = el.props as {
      value?: string | number | readonly string[]
      children?: React.ReactNode
      disabled?: boolean
      hidden?: boolean
    }
    const label = textOf(props.children)
    const value = props.value != null ? String(props.value) : label
    if (value === '' && !seenAny) {
      placeholder = label || undefined
      emptyLabel = label || 'None'
      clearable = !props.disabled
      seenAny = true
      return
    }
    seenAny = true
    if (props.hidden) return
    options.push({ value, label: label || value, disabled: !!props.disabled, group })
  }

  const walk = (nodes: React.ReactNode) => {
    React.Children.forEach(nodes, (child) => {
      if (!React.isValidElement(child)) return
      if (child.type === React.Fragment) {
        walk((child.props as { children?: React.ReactNode }).children)
      } else if (child.type === 'optgroup') {
        const props = child.props as { label?: string; children?: React.ReactNode }
        React.Children.forEach(props.children, (option) => {
          if (React.isValidElement(option) && option.type === 'option') {
            pushOption(option, props.label)
          }
        })
      } else if (child.type === 'option') {
        pushOption(child)
      } else if (typeof child.type !== 'string') {
        // Server/client translation helpers and conditional wrappers can sit
        // between Select and its option elements. Native <select> rendering
        // handles those wrappers after React resolves them, but the custom
        // typeahead must unwrap their ReactNode payload itself.
        const props = child.props as { children?: React.ReactNode; value?: React.ReactNode }
        walk(props.children ?? props.value)
      }
    })
  }
  walk(children)

  return { options, placeholder, clearable, emptyLabel }
}
