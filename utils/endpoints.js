export const WORKER_BASE = "https://open-api-worker.sumanreddy568.workers.dev";
export const GATEWAY_BASE = `${WORKER_BASE}/gateway`;

// Google OAuth "Web application" client for "Continue with Google". Its
// authorized redirect URIs must include https://<extension-id>.chromiumapp.org/
// for the store and dev builds. The worker only accepts tokens whose audience is
// listed in its GOOGLE_SIGNIN_CLIENT_IDS var. Empty = button hidden.
export const GOOGLE_OAUTH_CLIENT_ID = "811001181556-lm5bgd36bts391ns0qdb4k9tltenpgqa.apps.googleusercontent.com";
