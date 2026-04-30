
// This file centralizes environment variables for the application.
// It's crucial to set these variables in your deployment environment.
// For development, you can add a .env file or set them here directly.
// IMPORTANT: Do not commit your secret keys to version control.

// For Supabase, we'll try environment variables first, but the primary
// configuration method is now through the in-app settings panel,
// which uses localStorage.
//
// NOTE: In the browser, Node's `process.env` is not available. Vite exposes
// build-time env vars via `import.meta.env`, and only variables prefixed with
// `VITE_` are forwarded to the client. Define `VITE_SUPABASE_URL` and
// `VITE_SUPABASE_ANON_KEY` in your `.env` if you want to preconfigure them.
const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

export const SUPABASE_URL = viteEnv.VITE_SUPABASE_URL || null;
export const SUPABASE_ANON_KEY = viteEnv.VITE_SUPABASE_ANON_KEY || null;


if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    console.info(`
    ****************************************************************
    * INFO: SUPABASE CACHING IS NOT CONFIGURED VIA ENV VARIABLES   *
    ****************************************************************
    * To enable caching, please use the settings panel within the 
    * application to configure your Supabase credentials. This is
    * the recommended method.
    *
    * Alternatively, if you need to use environment variables, set
    * VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env file.
    ****************************************************************
    `);
}
