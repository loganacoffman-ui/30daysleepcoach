export async function loadAdminConfig(fetcher = fetch) {
  let response;
  try {
    response = await fetcher('/.netlify/functions/admin-config', { cache: 'no-store' });
    if (!response.ok) throw new Error();
    const config = await response.json();
    const url = new URL(config.url);
    if (url.protocol !== 'https:' || url.origin !== config.url
      || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(config.publishableKey ?? '')) throw new Error();
    return { url: config.url, publishableKey: config.publishableKey };
  } catch {
    throw new Error('Admin sign-in configuration is unavailable. Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in Netlify. For local development, use Netlify Dev.');
  }
}
