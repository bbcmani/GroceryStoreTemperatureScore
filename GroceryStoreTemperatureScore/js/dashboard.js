// =====================================================
// Dashboard wiring: filters, KPIs, charts, aisle heatmap, placement editor, suggestions
// =====================================================

let DATA = null; // { stores, products, placements }
let productsById = {};
let storesById = {};
let currentTempSeries = []; // temp series for the currently selected store
let charts = {};
let selectedCellKey = null; // "x,y,z" of the product cube selected in the 3D view

function byId(list) {
    const map = {};
    for (const item of list) map[item.id] = item;
    return map;
}

function statusFor(withstandDays) {
    if (withstandDays < 2) return { label: 'At Risk', cls: 'status-risk' };
    if (withstandDays < 5) return { label: 'Watch', cls: 'status-warn' };
    return { label: 'Safe', cls: 'status-ok' };
}

function populateStoreSelect() {
    const sel = $('#storeSelect');
    sel.innerHTML = DATA.stores.map(s => `<option value="${s.id}">${s.name} (${s.address.split(',').slice(-2).join(',').trim()})</option>`).join('');
}

function populateCategorySelect() {
    const sel = $('#categorySelect');
    for (const cat of CATEGORIES) {
        const opt = document.createElement('option');
        opt.value = cat; opt.textContent = cat;
        sel.appendChild(opt);
    }
}

function populateSuggestProductSelect() {
    const sel = $('#suggestProduct');
    sel.innerHTML = DATA.products.map(p => `<option value="${p.id}">${p.name} (${p.category})</option>`).join('');
}

async function loadStoreTempSeries(store, useLiveApi) {
    if (useLiveApi && !getFgApiKey()) {
        $('#syncStatus').textContent = 'Enter a FortyGuard API key above to fetch live data.';
        useLiveApi = false;
    }
    $('#syncStatus').textContent = useLiveApi ? 'Fetching live data from FortyGuard...' : 'Loading (simulated data)...';
    const series = await getStoreTemperatureSeries(store, {
        useLiveApi,
        onProgress: (done, total) => {
            $('#syncStatus').textContent = useLiveApi
                ? `Fetching live data from FortyGuard... (${done}/${total})`
                : `Loading... (${done}/${total})`;
        }
    });
    $('#syncStatus').textContent = useLiveApi
        ? 'Live FortyGuard data loaded.'
        : 'Using simulated data (click "Sync" for live readings).';
    return series;
}

function renderKpis(store, storeScore) {
    const today = storeScore.breakdown.length
        ? storeScore.breakdown.reduce((a, b) => a + b.effectiveTempToday, 0) / storeScore.breakdown.length
        : (currentTempSeries[0] ? currentTempSeries[0].temp : 0);

    $('#kpiStoreScore').textContent = round(storeScore.totalScore, 0);
    $('#kpiProductCount').textContent = storeScore.breakdown.length;
    $('#kpiAtRisk').textContent = storeScore.breakdown.filter(b => b.withstandDays < 2).length;
    $('#kpiAvgTemp').textContent = round(today, 1);
}

function renderTempTrendChart() {
    const ctx = $('#tempTrendChart').getContext('2d');
    const labels = currentTempSeries.map(d => d.date);
    const values = currentTempSeries.map(d => d.temp);
    const todayStr = formatDate(todayUTC());
    const todayIdx = labels.indexOf(todayStr);

    if (charts.trend) charts.trend.destroy();
    charts.trend = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Ambient Temp (°C)',
                data: values,
                borderColor: '#2563eb',
                backgroundColor: 'rgba(37,99,235,0.1)',
                pointBackgroundColor: labels.map((_, i) => i < todayIdx ? '#2563eb' : i === todayIdx ? '#16a34a' : '#d97706'),
                tension: 0.3,
                fill: true
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 90, minRotation: 45 } } } }
    });
}

function renderWithstandChart(storeScore) {
    const ctx = $('#withstandChart').getContext('2d');
    const sorted = [...storeScore.breakdown].sort((a, b) => a.withstandDays - b.withstandDays);
    if (charts.withstand) charts.withstand.destroy();
    charts.withstand = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: sorted.map(b => b.product.name),
            datasets: [{
                label: 'Withstand Days',
                data: sorted.map(b => b.withstandDays),
                backgroundColor: sorted.map(b => b.withstandDays < 2 ? '#dc2626' : b.withstandDays < 5 ? '#d97706' : '#16a34a')
            }]
        },
        options: { responsive: true, indexAxis: 'y', plugins: { legend: { display: false } } }
    });
}

function renderStoreLeaderboard() {
    // Fast simulated-only scoring across all stores (avoids firing live API calls per store).
    const today = todayUTC();
    const simpleSeries = [];
    for (let i = -15; i <= 10; i++) {
        const dateStr = formatDate(addDays(today, i));
        simpleSeries.push({ date: dateStr }); // temp filled per-store below
    }

    const scores = DATA.stores.map(store => {
        const series = simpleSeries.map(d => ({ date: d.date, temp: mockTemperature(store, d.date) }));
        const { totalScore } = computeStoreScore(store, DATA.placements, productsById, series);
        return { store, totalScore };
    });
    scores.sort((a, b) => b.totalScore - a.totalScore);
    const top = scores.slice(0, 8);
    const bottom = scores.slice(-8).reverse();
    const combined = [...top, ...bottom];

    const ctx = $('#storeLeaderboardChart').getContext('2d');
    if (charts.leaderboard) charts.leaderboard.destroy();
    charts.leaderboard = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: combined.map(c => c.store.name),
            datasets: [{
                label: 'Total Withstanding Score (days)',
                data: combined.map(c => c.totalScore),
                backgroundColor: combined.map((c, i) => i < top.length ? '#16a34a' : '#dc2626')
            }]
        },
        options: { responsive: true, plugins: { legend: { display: false } }, scales: { x: { ticks: { maxRotation: 90, minRotation: 60 } } } }
    });
}

function renderAisleGrids(store) {
    const container = $('#aisleGrids');
    container.innerHTML = '';
    const storePlacements = DATA.placements.filter(p => p.storeId === store.id);
    const placementAt = {};
    for (const p of storePlacements) placementAt[`${p.x},${p.y},${p.z}`] = p.productId;

    const storeBaseline = currentTempSeries.length ? currentTempSeries[0].temp : 0;
    const todayTemp = currentTempSeries.find(d => d.date === formatDate(todayUTC()));
    const dayTemp = todayTemp ? todayTemp.temp : storeBaseline;

    for (let z = 0; z < GRID.Z; z++) {
        const levelDiv = document.createElement('div');
        levelDiv.className = 'aisle-level';
        levelDiv.innerHTML = `<h3>Shelf Level Z=${z}</h3>`;
        for (let y = 0; y < GRID.Y; y++) {
            const rowDiv = document.createElement('div');
            rowDiv.className = 'aisle-row';
            for (let x = 0; x < GRID.X; x++) {
                const base = positionBaseTemp(store, x, y, z);
                const effTemp = base + (dayTemp - storeBaseline);
                const cell = document.createElement('div');
                cell.className = 'aisle-cell';
                cell.style.background = tempToColor(effTemp);
                cell.title = `Position (${x},${y},${z}) — ${round(effTemp, 1)}°C`;
                const productId = placementAt[`${x},${y},${z}`];
                if (productId) cell.textContent = productId.replace('PR', 'P');
                rowDiv.appendChild(cell);
            }
            levelDiv.appendChild(rowDiv);
        }
        container.appendChild(levelDiv);
    }
}

function tempToColor(temp) {
    // Blue (cold) -> green -> yellow -> red (hot), roughly -20°C to 35°C
    const t = clamp((temp + 20) / 55, 0, 1);
    const hue = (1 - t) * 220; // 220=blue, 0=red
    return `hsl(${hue}, 70%, 65%)`;
}

// Builds the per-position dataset (temperature, occupancy, selection/neighbor state) for one day,
// shared by both the 3D view and its click-driven neighbor highlighting.
function buildAisleCells(store, dayIndex) {
    const day = currentTempSeries[dayIndex];
    const storeBaseline = currentTempSeries.length ? currentTempSeries[0].temp : 0;
    const dayTemp = day ? day.temp : storeBaseline;

    const storePlacements = DATA.placements.filter(p => p.storeId === store.id);
    const placementAt = {};
    for (const p of storePlacements) placementAt[`${p.x},${p.y},${p.z}`] = p;

    let neighborKeys = new Set();
    if (selectedCellKey && placementAt[selectedCellKey]) {
        const neighbors = neighborsOf(placementAt[selectedCellKey], DATA.placements);
        neighborKeys = new Set(neighbors.map(n => `${n.x},${n.y},${n.z}`));
    }

    const cells = [];
    for (let x = 0; x < GRID.X; x++) {
        for (let y = 0; y < GRID.Y; y++) {
            for (let z = 0; z < GRID.Z; z++) {
                const key = `${x},${y},${z}`;
                const base = positionBaseTemp(store, x, y, z);
                const placement = placementAt[key];
                cells.push({
                    x, y, z,
                    temp: round(base + (dayTemp - storeBaseline), 1),
                    product: placement ? productsById[placement.productId] : null,
                    placement: placement || null,
                    isSelected: key === selectedCellKey,
                    isNeighbor: neighborKeys.has(key)
                });
            }
        }
    }
    return cells;
}

function renderAisle3DInfoPanel(store, cell) {
    const panel = $('#aisle3dInfo');
    if (!cell || !cell.product) {
        panel.innerHTML = '<p class="hint">Click an occupied cell (solid cube) to inspect a product and its neighbors.</p>';
        return;
    }
    const product = cell.product;
    const { withstandDays } = computeWithstandDays(store, product, cell.placement, currentTempSeries, DATA.placements, productsById);
    const status = statusFor(withstandDays);
    const neighbors = neighborsOf(cell.placement, DATA.placements).map(n => productsById[n.productId]).filter(Boolean);

    panel.innerHTML = `
        <h3>${product.name} <span class="${status.cls}">(${status.label})</span></h3>
        <p>Category: ${product.category} &middot; Ideal Temp: ${product.idealTemp}&deg;C &middot;
           Effective Temp: ${cell.temp}&deg;C &middot; Withstand Days: ${withstandDays}
           &middot; Position: (${cell.x}, ${cell.y}, ${cell.z})</p>
        <p><strong>Neighboring products (within 1 cell):</strong></p>
        ${neighbors.length
            ? '<ul>' + neighbors.map(n => `<li>${n.name} &mdash; ideal ${n.idealTemp}&deg;C (${n.category})</li>`).join('') + '</ul>'
            : '<p class="hint">No neighboring products placed.</p>'}
    `;
}

function render3DView(store) {
    const slider = $('#aisle3dDateSlider');
    slider.max = String(Math.max(0, currentTempSeries.length - 1));
    const dayIndex = clamp(parseInt(slider.value, 10) || 0, 0, currentTempSeries.length - 1);
    const day = currentTempSeries[dayIndex];
    $('#aisle3dDateLabel').textContent = day ? day.date : '';

    const cells = buildAisleCells(store, dayIndex);
    if (!window.Aisle3D) return; // module still loading
    window.Aisle3D.render({
        grid: GRID,
        cells,
        onCellSelect: (cell) => {
            selectedCellKey = cell.product ? `${cell.x},${cell.y},${cell.z}` : null;
            renderAisle3DInfoPanel(store, cell);
            render3DView(store);
        }
    });
}

function renderProductTable(store, storeScore) {
    const category = $('#categorySelect').value;
    const search = $('#productSearch').value.trim().toLowerCase();
    const tbody = $('#productTableBody');
    tbody.innerHTML = '';

    const rows = storeScore.breakdown.filter(b => {
        if (category && b.product.category !== category) return false;
        if (search && !b.product.name.toLowerCase().includes(search)) return false;
        return true;
    });

    if (rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="color:var(--muted);text-align:center;padding:16px;">No products match the current filters for this store.</td></tr>`;
        return;
    }

    for (const row of rows) {
        const { product, placement, withstandDays } = row;
        const status = statusFor(withstandDays);
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${product.name}</td>
            <td>${product.category}</td>
            <td>$${product.price.toFixed(2)}</td>
            <td>${product.idealTemp}</td>
            <td>
                <div class="pos-inputs">
                    <input type="number" min="0" max="${GRID.X - 1}" value="${placement.x}" data-axis="x" data-product="${product.id}">
                    <input type="number" min="0" max="${GRID.Y - 1}" value="${placement.y}" data-axis="y" data-product="${product.id}">
                    <input type="number" min="0" max="${GRID.Z - 1}" value="${placement.z}" data-axis="z" data-product="${product.id}">
                </div>
            </td>
            <td>${withstandDays}</td>
            <td class="${status.cls}">${status.label}</td>
            <td><button class="btn btn-small" data-apply="${product.id}">Apply</button></td>
        `;
        tbody.appendChild(tr);
    }

    $$('button[data-apply]', tbody).forEach(btn => {
        btn.addEventListener('click', () => applyReposition(btn.dataset.apply));
    });
}

function applyReposition(productId) {
    const row = $(`button[data-apply="${productId}"]`).closest('tr');
    const x = clamp(parseInt($(`input[data-axis="x"][data-product="${productId}"]`, row).value, 10) || 0, 0, GRID.X - 1);
    const y = clamp(parseInt($(`input[data-axis="y"][data-product="${productId}"]`, row).value, 10) || 0, 0, GRID.Y - 1);
    const z = clamp(parseInt($(`input[data-axis="z"][data-product="${productId}"]`, row).value, 10) || 0, 0, GRID.Z - 1);

    const placement = DATA.placements.find(p => p.productId === productId);
    placement.x = x; placement.y = y; placement.z = z;
    savePlacements(DATA.placements);
    refreshStoreView(false);
}

async function refreshStoreView(useLiveApi) {
    const storeId = $('#storeSelect').value;
    const store = storesById[storeId];
    if (!store) return;

    if (useLiveApi || !currentTempSeries.length || currentTempSeries.storeId !== storeId) {
        currentTempSeries = await loadStoreTempSeries(store, useLiveApi);
        currentTempSeries.storeId = storeId;
    }

    const storeScore = computeStoreScore(store, DATA.placements, productsById, currentTempSeries);
    renderKpis(store, storeScore);
    renderTempTrendChart();
    renderWithstandChart(storeScore);
    renderAisleGrids(store);
    renderProductTable(store, storeScore);
    render3DView(store);
}

function renderSuggestions() {
    const productId = $('#suggestProduct').value;
    const product = productsById[productId];
    const storeId = $('#storeSelect').value;
    const store = storesById[storeId];
    if (!product || !store || !currentTempSeries.length) return;

    const suggestions = suggestPlacements(product, store, currentTempSeries, { topN: 5 });
    const container = $('#suggestionResults');
    container.innerHTML = suggestions.map(s => `
        <div class="suggestion-card">
            If <strong>${product.name}</strong> is kept at <strong>${round(s.effectiveTemp, 1)}&deg;C</strong>
            at store position (${s.x},${s.y},${s.z}) on <strong>${s.date}</strong>,
            it can yield an estimated profit of <span class="profit">${s.profitPercent}%</span>.
        </div>
    `).join('') || '<p class="hint">No suggestions available.</p>';
}

function init() {
    DATA = initData();
    productsById = byId(DATA.products);
    storesById = byId(DATA.stores);

    populateStoreSelect();
    populateCategorySelect();
    populateSuggestProductSelect();

    $('#apiKeyInput').value = getFgApiKey();
    $('#apiKeyInput').addEventListener('change', () => setFgApiKey($('#apiKeyInput').value));

    $('#storeSelect').addEventListener('change', () => { selectedCellKey = null; refreshStoreView(false); });
    $('#categorySelect').addEventListener('change', () => refreshStoreView(false));
    $('#productSearch').addEventListener('input', () => refreshStoreView(false));
    $('#syncApiBtn').addEventListener('click', () => refreshStoreView(true));
    $('#suggestBtn').addEventListener('click', renderSuggestions);
    $('#aisle3dDateSlider').addEventListener('input', () => {
        const store = storesById[$('#storeSelect').value];
        if (store) render3DView(store);
    });

    renderStoreLeaderboard();
    refreshStoreView(false);
}

window.addEventListener('DOMContentLoaded', init);
