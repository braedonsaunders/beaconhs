export function GET(request: Request): Response {
  return Response.redirect(new URL('/icon0.svg', request.url), 308)
}
