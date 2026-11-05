# Inline creation form inventory — 5 November 2026

Source review of authenticated routes and shared web components. Checked native details/summary elements, collapsible sections, conditional React forms, create/add server-action forms, and client forms with local show/open state. This is a source inventory, not a claim that every role and tenant configuration was exercised in a browser.

## Fixed in this change

| Location                                                                                        | Previous behavior                            | Replacement                                                                                              |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Training → Skill types (`/training/skills/types`)                                               | Add skill type expands inline                | Header button opens the URL-driven drawer                                                                |
| Training → Authorities → authority → Skill types (`/training/authorities/[id]?tab=skill_types`) | Always-visible duplicate Add skill type form | Button opens the same drawer with the authority selected; remaining fields are edited on the full record |
| Incidents; My Workspace → Incidents; location incident tab; dashboard Report incident action    | Sends the user through `/incidents/new`      | Starts the record and opens its full reporting/investigation form; old page removed                      |

## Remaining collapsible entry forms

| Location                                                         | Trigger and behavior                                                       | Source                                                                    | Recommendation                                                                                       |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Journals → Tags (`/journals/tags`)                               | **New tag** opens an inline tag form                                       | `apps/web/src/app/(app)/journals/tags/_tags-admin.tsx`                    | Move creation into the shared drawer pattern; review inline edit and merge controls at the same time |
| Admin → Roles → role members (`/admin/roles/[id]`)               | **Add members** expands member/role-scope fields below the button          | `apps/web/src/app/(app)/admin/roles/_components/role-members-manager.tsx` | Drawer for member selection and scope; keep existing member rows compact                             |
| Equipment → equipment → maintenance schedule (`/equipment/[id]`) | **Record completion** expands date and evidence fields in the schedule row | `apps/web/src/app/(app)/equipment/_complete-schedule.tsx`                 | Drawer for completion date and evidence, then refresh the row                                        |

## Remaining always-visible inline creation forms

These are not collapsible, but still put creation fields directly in a list or detail page.

| Location                                                          | Form                                   | Source                                                                      | Recommendation                                      |
| ----------------------------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------- | --------------------------------------------------- |
| Documents → Categories (`/documents/categories`)                  | Create category card                   | `apps/web/src/app/(app)/documents/categories/page.tsx`                      | Add category button and drawer                      |
| Documents → Types (`/documents/types`)                            | Create document type card              | `apps/web/src/app/(app)/documents/types/page.tsx`                           | Add type button and drawer                          |
| Training → Library (`/training/library`)                          | Name and content-kind fields in header | `apps/web/src/app/(app)/training/library/page.tsx`                          | Add content button and drawer, then open the editor |
| Admin → API keys (`/admin/api-keys`)                              | Create API key card                    | `apps/web/src/app/(app)/admin/api-keys/page.tsx`                            | Create key drawer; retain one-time secret display   |
| People → Job titles → title → Tasks (`/people/titles/[id]/tasks`) | Add task card                          | `apps/web/src/app/(app)/people/titles/[id]/tasks/page.tsx`                  | Add task drawer with current title preselected      |
| Platform → Users → user (`/platform/users/[id]`)                  | Add tenant membership card             | `apps/web/src/app/(app)/platform/users/_components/add-membership-form.tsx` | Add membership drawer with current user fixed       |

## Related inline panels, separate from record creation

- Document editor (`/documents/[id]`, `_document-pane.tsx`): replace/import panel expands inline.
- Training slideshow editor (`training/_editor/slide-deck-editor.tsx`): import panel expands inline.
- Account password section: password-change form expands inline.
- Vehicle log settings: employee/mode assignment controls add configuration rows inline.
- Form/checklist/flow/design builders add their child elements inline as part of editing the main record.

The following were checked and excluded from defects: existing drawers/popovers, button-only actions that immediately open a new full record, ordinary autosaved fields, comment composers, expandable history/help/org-chart nodes, filters, and collapsible sections of an existing main form. Those are different interactions from hiding a new-record form under an inline expander.

The nine remaining create/entry locations above are an inventory for follow-up, not changes silently included in this release.
