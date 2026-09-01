import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

/**
 * Runs before every matched request.
 *   1. Refreshes the Supabase session so logins don't silently expire.
 *   2. Rejects unauthenticated AND under-privileged access to /staff
 *      before any page code runs.
 *
 * This is the OUTERMOST layer of access control. RLS is the innermost:
 * even if this layer were bypassed, the database still refuses.
 * Defence in depth — neither layer is trusted alone.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // Do not remove: this call refreshes the session token.
  const { data: { user } } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname

  if (path.startsWith('/staff')) {
    if (!user) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('next', path)
      return NextResponse.redirect(url)
    }

    // Authenticated is not sufficient — a patient must not reach
    // the staff console. This read is itself RLS-constrained:
    // app_users_read allows a user to see their own row.
    const { data: profile } = await supabase
      .from('app_users')
      .select('role')
      .eq('id', user.id)
      .single()

    const allowed = ['staff', 'nurse', 'clinician']
    if (!profile || !allowed.includes(profile.role)) {
      const url = request.nextUrl.clone()
      url.pathname = '/'
      url.searchParams.set('denied', 'staff_area')
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}