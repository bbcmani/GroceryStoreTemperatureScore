// =====================================================
// Scoring engine: temperature withstanding score + future placement profit suggestions
//
// Model (illustrative, documented in README):
//   effectiveTemp = positionBaseTemp + (dayAmbientTemp - storeBaselineTemp) + neighborInfluence
//   excess        = max(0, effectiveTemp - product.idealTemp)
//   dailyDamage   = excess * product.sensitivity        (fraction of shelf life consumed per day)
//   withstandDays = number of days until cumulative dailyDamage reaches 1.0 (100% degraded),
//                   capped at product.shelfLifeDays if never reached within the date range.
// =====================================================

function neighborsOf(placement, allPlacements) {
    return allPlacements.filter(p =>
        p.storeId === placement.storeId &&
        p.productId !== placement.productId &&
        Math.abs(p.x - placement.x) <= 1 &&
        Math.abs(p.y - placement.y) <= 1 &&
        Math.abs(p.z - placement.z) <= 1
    );
}

// Average pull/push on ambient temperature exerted by neighboring products' ideal temps.
function neighborInfluence(placement, allPlacements, productsById, store) {
    const neighbors = neighborsOf(placement, allPlacements);
    if (neighbors.length === 0) return 0;
    const base = positionBaseTemp(store, placement.x, placement.y, placement.z);
    const deltas = neighbors.map(n => {
        const np = productsById[n.productId];
        return np ? (np.idealTemp - base) * 0.15 : 0;
    });
    return deltas.reduce((a, b) => a + b, 0) / deltas.length;
}

function computeWithstandDays(store, product, placement, tempSeries, allPlacements, productsById) {
    const base = positionBaseTemp(store, placement.x, placement.y, placement.z);
    const storeBaseline = tempSeries.length ? tempSeries[0].temp : base;
    const influence = neighborInfluence(placement, allPlacements, productsById, store);

    let cumulative = 0;
    let withstandDays = 0;
    const daily = [];

    for (const day of tempSeries) {
        const effectiveTemp = round(base + (day.temp - storeBaseline) + influence, 1);
        const excess = Math.max(0, effectiveTemp - product.idealTemp);
        const damage = excess * product.sensitivity;
        cumulative += damage;
        daily.push({ date: day.date, effectiveTemp, excess: round(excess, 1), cumulative: round(cumulative, 3) });
        if (cumulative >= 1) break;
        withstandDays++;
    }

    if (cumulative < 1) withstandDays = product.shelfLifeDays;
    withstandDays = Math.min(withstandDays, product.shelfLifeDays);

    return { withstandDays, daily, effectiveTempToday: daily.length ? daily[0].effectiveTemp : base };
}

function computeStoreScore(store, placements, productsById, tempSeries) {
    const storePlacements = placements.filter(p => p.storeId === store.id);
    let total = 0;
    const breakdown = storePlacements.map(placement => {
        const product = productsById[placement.productId];
        const { withstandDays, effectiveTempToday } = computeWithstandDays(store, product, placement, tempSeries, placements, productsById);
        total += withstandDays;
        return { placement, product, withstandDays, effectiveTempToday };
    });
    return { totalScore: total, breakdown };
}

// Traffic/visibility weighting used purely for the illustrative profit model: eye-level, central
// aisle positions are assumed to sell better than floor/ceiling or corner positions.
function trafficScore(x, y, z) {
    const zScore = z === 1 ? 1 : 0.6; // z=1 is eye level
    const centerY = 1 - Math.abs(y - (GRID.Y - 1) / 2) / (GRID.Y / 2);
    const centerX = 1 - Math.abs(x - (GRID.X - 1) / 2) / (GRID.X / 2);
    return clamp(zScore * (0.5 + 0.5 * centerY) * (0.5 + 0.5 * centerX), 0, 1);
}

// Illustrative profit-uplift estimate for placing `product` at `position` on a day with `dayTemp`.
function estimateProfitPercent(product, store, position, dayTemp, storeBaseline) {
    const base = positionBaseTemp(store, position.x, position.y, position.z);
    const effectiveTemp = base + (dayTemp - storeBaseline);
    const excess = Math.max(0, effectiveTemp - product.idealTemp);
    const traffic = trafficScore(position.x, position.y, position.z);
    const baseProfitPercent = 8 * traffic;         // up to 8% uplift from prime shelf visibility
    const spoilagePenaltyPercent = excess * 0.3;   // profit erodes as the product runs hotter than ideal
    return { profitPercent: round(clamp(baseProfitPercent - spoilagePenaltyPercent, -20, 20), 1), effectiveTemp: round(effectiveTemp, 1) };
}

// Suggest the best (position, date) combinations within a store for a given product across its forecast window.
function suggestPlacements(product, store, tempSeries, { topN = 5 } = {}) {
    const storeBaseline = tempSeries.length ? tempSeries[0].temp : 0;
    const futureDays = tempSeries.filter(d => new Date(d.date) >= todayUTC());
    const candidates = [];

    for (const day of futureDays) {
        for (let x = 0; x < GRID.X; x++) {
            for (let y = 0; y < GRID.Y; y++) {
                for (let z = 0; z < GRID.Z; z++) {
                    const { profitPercent, effectiveTemp } = estimateProfitPercent(product, store, { x, y, z }, day.temp, storeBaseline);
                    candidates.push({ date: day.date, x, y, z, profitPercent, effectiveTemp });
                }
            }
        }
    }

    candidates.sort((a, b) => b.profitPercent - a.profitPercent);
    return candidates.slice(0, topN);
}
