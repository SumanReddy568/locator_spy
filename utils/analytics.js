const TRACK_URL = "https://multi-product-analytics.sumanreddy568.workers.dev/";

export async function track(eventName, options = {}) {
    try {
        const systemInfo = typeof window !== 'undefined' ? {
            ua: navigator.userAgent,
            lang: navigator.language,
            platform: navigator.platform,
            screen: `${window.screen.width}x${window.screen.height}`,
            viewport: `${window.innerWidth}x${window.innerHeight}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        } : { ua: 'service-worker' };

        const response = await fetch(TRACK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                product: "locator_spy",
                event: eventName,
                extensionId: chrome?.runtime?.id || 'web_user',
                page: options.page || (typeof window !== 'undefined' ? window.location.href : 'background'),
                feature: options.feature || null,
                version: chrome?.runtime?.getManifest()?.version || '1.0.0',
                system: systemInfo,
                meta: options.meta || {}
            })
        });
        return await response.json();
    } catch (err) {
        console.error("Analytics failed", err);
    }
}
