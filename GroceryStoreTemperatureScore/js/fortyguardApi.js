// =====================================================
// FortyGuard API client
// Real network calls are used when a single store/date is requested on demand.
// A deterministic simulated fallback is used for bulk/aggregate views so the
// dashboard doesn't have to fire hundreds of live requests just to render.
// =====================================================

const FG_API_KEY_STORAGE_KEY = 'fg_user_api_key';
const FG_SUBMISSION_URL = 'https://api.fortyguard.com/v1/env_params';
const FG_STATUS_URL = 'https://api.fortyguard.com/v1/status';

function getFgApiKey() {
    return (Store.get(FG_API_KEY_STORAGE_KEY, '') || '').trim();
}

function setFgApiKey(key) {
    Store.set(FG_API_KEY_STORAGE_KEY, (key || '').trim());
}

async function fgSubmit(lat, lon, dateStr) {
    const response = await fetch(FG_SUBMISSION_URL, {
        method: 'POST',
        headers: { 'api-key': getFgApiKey(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
            latitude: lat,
            longitude: lon,
            temperature: 0,
            date_time: { start_date: dateStr, start_time: '12:00', filter_type: 1 }
        })
    });
    if (!response.ok) throw new Error(`Submission failed: ${response.status}`);
    const data = await response.json();
    if (data.error !== false || !data.data || !data.data.activity_id) {
        throw new Error('Submission rejected by API');
    }
    return data.data.activity_id;
}

async function fgPoll(activityId, { intervalMs = 2000, maxAttempts = 10 } = {}) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const response = await fetch(`${FG_STATUS_URL}/${activityId}`, {
            headers: { 'api-key': getFgApiKey() }
        });
        if (!response.ok) throw new Error(`Polling failed: ${response.status}`);
        const data = await response.json();
        if (data.data && data.data.status === 'Completed') return data.data;
        await new Promise(res => setTimeout(res, intervalMs));
    }
    throw new Error('Polling timed out');
}

// Seasonal + daily-noise mock temperature, used as an offline fallback and for fast bulk scoring.
function mockTemperature(store, dateStr) {
    const d = new Date(dateStr + 'T00:00:00Z');
    const doy = dayOfYear(d);
    const latitudeFactor = (40 - Math.abs(store.latitude)) * 0.35;
    const seasonal = 12 * Math.sin(((doy - 100) / 365) * 2 * Math.PI) + 18;
    const r = rngFor('daily', store.id, dateStr);
    const noise = (r() - 0.5) * 4;
    return round(seasonal + latitudeFactor + noise, 1);
}

// Fetch (real, cached) or simulate the ambient temperature for one store on one date.
async function fetchTemperatureForDate(store, dateStr, { useLiveApi = false } = {}) {
    const cacheKey = `fg_temp_${store.id}_${dateStr}`;
    const cached = Store.get(cacheKey, null);
    if (cached) return cached;

    if (!useLiveApi || !getFgApiKey()) {
        const result = { temp: mockTemperature(store, dateStr), simulated: true };
        Store.set(cacheKey, result);
        return result;
    }

    try {
        const activityId = await fgSubmit(store.latitude, store.longitude, dateStr);
        const result = await fgPoll(activityId);
        const temp = result.result.locations[0].temperature;
        const record = { temp, simulated: false, raw: result };
        Store.set(cacheKey, record);
        return record;
    } catch (err) {
        console.warn(`FortyGuard API unavailable for ${store.id} ${dateStr}, using simulated value:`, err.message);
        const record = { temp: mockTemperature(store, dateStr), simulated: true };
        Store.set(cacheKey, record);
        return record;
    }
}

// Returns temperature series for last `pastDays` days through `futureDays` days ahead (inclusive of today).
async function getStoreTemperatureSeries(store, { pastDays = 15, futureDays = 10, useLiveApi = false, onProgress = null, concurrency = 4 } = {}) {
    const today = todayUTC();
    const dates = [];
    for (let i = -pastDays; i <= futureDays; i++) dates.push(formatDate(addDays(today, i)));

    const results = new Array(dates.length);
    let completed = 0;

    async function worker(startIdx) {
        for (let i = startIdx; i < dates.length; i += concurrency) {
            const record = await fetchTemperatureForDate(store, dates[i], { useLiveApi });
            results[i] = { date: dates[i], ...record };
            completed++;
            if (onProgress) onProgress(completed, dates.length);
        }
    }

    const workers = [];
    for (let c = 0; c < concurrency; c++) workers.push(worker(c));
    await Promise.all(workers);

    return results;
}
