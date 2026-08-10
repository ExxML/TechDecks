import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Supabase PKCE exchange.
 *
 * Google redirects to Supabase, Supabase redirects here with a `code`, and this
 * trades it for a session cookie.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') ?? '/problems';
  const error = url.searchParams.get('error');

  // The user declined consent, or Google returned an error.
  if (error) {
    return NextResponse.redirect(new URL('/settings?auth=denied', url.origin));
  }

  if (!code) {
    return NextResponse.redirect(new URL('/settings?auth=failed', url.origin));
  }

  const supabase = await createClient();
  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return NextResponse.redirect(new URL('/settings?auth=failed', url.origin));
  }

  // Only ever redirect to a path on this origin — an open redirect here would
  // let a crafted link bounce a freshly authenticated user off-site.
  const target = next.startsWith('/') && !next.startsWith('//') ? next : '/problems';
  return NextResponse.redirect(new URL(target, url.origin));
}
