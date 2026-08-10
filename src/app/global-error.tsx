'use client';

/**
 * Last-resort boundary: catches errors in the root layout itself, which
 * `error.tsx` cannot — it renders INSIDE that layout.
 *
 * Because the layout failed, this component must supply its own <html> and
 * <body>, and cannot rely on globals.css having applied. The few styles it
 * needs are therefore inline, and it deliberately uses no imports beyond React.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
          padding: 24,
          background: '#1a1a1a',
          color: '#eff1f6',
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          fontSize: 14,
        }}
      >
        <h1 style={{ fontSize: 16, fontWeight: 500, margin: 0 }}>Something went wrong</h1>
        <p style={{ margin: 0, color: '#8a8a8a', fontSize: 13, textAlign: 'center' }}>
          TechDecks failed to start. Reloading usually works.
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            minHeight: 40,
            padding: '0 16px',
            borderRadius: 4,
            border: '1px solid #3e3e3e',
            background: '#303030',
            color: '#eff1f6',
            fontSize: 14,
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
        {error.digest && (
          <p style={{ margin: 0, color: '#8a8a8a', fontSize: 12, fontFamily: 'monospace' }}>
            {error.digest}
          </p>
        )}
      </body>
    </html>
  );
}
