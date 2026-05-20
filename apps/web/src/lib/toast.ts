// Thin wrapper around sonner so we have a single import-path inside the app.
// Sonner is the headless Linear/Vercel-style toaster — the <Toaster /> root is
// mounted once in the (app) layout; client components import { toast } here
// and call `toast.success(...)`, `toast.error(...)`, `toast.info(...)`.

export { toast } from 'sonner'
