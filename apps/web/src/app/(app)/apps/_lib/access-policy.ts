/** Web compatibility surface for the shared Builder policy. Keeping the policy
 * in @beaconhs/tenant lets request handlers and scheduled workers make the
 * exact same lifecycle/audience decision. */
export {
  canAccessTemplate,
  canEditResponsePayload,
  isTemplateBuilder,
  type TemplateAccessDescriptor,
  type TemplateAccessMode,
} from '@beaconhs/tenant'
