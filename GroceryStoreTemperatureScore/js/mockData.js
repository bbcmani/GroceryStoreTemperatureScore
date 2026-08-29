// =====================================================
// Mock data generation: 100 stores, 100 products, aisle grid, product placements
// Data is generated once and persisted to localStorage so it stays stable across reloads.
// =====================================================

const GRID = { X: 5, Y: 5, Z: 3 }; // aisle position space per store: x (aisle), y (bay), z (shelf level 0=floor..2=top)

const CATEGORY_PROFILES = {
    Dairy: { idealTemp: 4, shelfLifeDays: 10, sensitivity: 0.06 },
    Meat: { idealTemp: 2, shelfLifeDays: 5, sensitivity: 0.09 },
    Frozen: { idealTemp: -18, shelfLifeDays: 60, sensitivity: 0.08 },
    Produce: { idealTemp: 8, shelfLifeDays: 7, sensitivity: 0.05 },
    Bakery: { idealTemp: 20, shelfLifeDays: 4, sensitivity: 0.04 },
    Beverage: { idealTemp: 15, shelfLifeDays: 90, sensitivity: 0.01 },
    Snacks: { idealTemp: 20, shelfLifeDays: 120, sensitivity: 0.005 },
    Household: { idealTemp: 20, shelfLifeDays: 365, sensitivity: 0.001 },
    Deli: { idealTemp: 3, shelfLifeDays: 6, sensitivity: 0.07 },
    FrozenDessert: { idealTemp: -12, shelfLifeDays: 45, sensitivity: 0.07 }
};
const CATEGORIES = Object.keys(CATEGORY_PROFILES);

const CITIES = [
    ['New York', 'NY', 40.7128, -74.0060], ['Los Angeles', 'CA', 34.0522, -118.2437],
    ['Chicago', 'IL', 41.8781, -87.6298], ['Houston', 'TX', 29.7604, -95.3698],
    ['Phoenix', 'AZ', 33.4484, -112.0740], ['Philadelphia', 'PA', 39.9526, -75.1652],
    ['San Antonio', 'TX', 29.4241, -98.4936], ['San Diego', 'CA', 32.7157, -117.1611],
    ['Dallas', 'TX', 32.7767, -96.7970], ['Austin', 'TX', 30.2672, -97.7431],
    ['Seattle', 'WA', 47.6062, -122.3321], ['Denver', 'CO', 39.7392, -104.9903],
    ['Boston', 'MA', 42.3601, -71.0589], ['Miami', 'FL', 25.7617, -80.1918],
    ['Atlanta', 'GA', 33.7490, -84.3880], ['Minneapolis', 'MN', 44.9778, -93.2650],
    ['Portland', 'OR', 45.5051, -122.6750], ['Detroit', 'MI', 42.3314, -83.0458],
    ['Nashville', 'TN', 36.1627, -86.7816], ['Salt Lake City', 'UT', 40.7608, -111.8910]
];
const STREETS = ['Main St', 'Oak Ave', 'Market St', 'Broadway', 'Elm St', 'Highland Ave', 'Park Blvd', '5th Ave', 'Sunset Blvd', 'River Rd'];
const BRANDS = ['FreshFarms', 'ValuMart', 'GreenLeaf', 'Homestead', 'PurePantry', 'DailyGoods', 'Northline', 'HarvestCo', 'BlueRiver', 'CedarPoint'];
const NOUNS = {
    Dairy: ['Whole Milk', 'Greek Yogurt', 'Cheddar Cheese', 'Butter', 'Cream Cheese'],
    Meat: ['Ground Beef', 'Chicken Breast', 'Pork Chops', 'Bacon', 'Turkey Slices'],
    Frozen: ['Frozen Peas', 'Frozen Pizza', 'Ice Cubes', 'Frozen Berries', 'Frozen Fries'],
    Produce: ['Bananas', 'Spinach', 'Tomatoes', 'Apples', 'Carrots'],
    Bakery: ['Sourdough Bread', 'Bagels', 'Croissants', 'Muffins', 'Dinner Rolls'],
    Beverage: ['Orange Juice', 'Cola 12pk', 'Sparkling Water', 'Iced Tea', 'Energy Drink'],
    Snacks: ['Potato Chips', 'Trail Mix', 'Pretzels', 'Granola Bars', 'Popcorn'],
    Household: ['Paper Towels', 'Dish Soap', 'Laundry Pods', 'Trash Bags', 'Batteries'],
    Deli: ['Sliced Ham', 'Rotisserie Chicken', 'Potato Salad', 'Hummus', 'Sushi Pack'],
    FrozenDessert: ['Ice Cream Tub', 'Popsicles', 'Frozen Yogurt', 'Sorbet', 'Ice Cream Sandwiches']
};

function generateStores(count) {
    const stores = [];
    for (let i = 0; i < count; i++) {
        const r = rngFor('store', i);
        const [city, state, baseLat, baseLon] = CITIES[i % CITIES.length];
        const street = STREETS[Math.floor(r() * STREETS.length)];
        stores.push({
            id: `ST${String(i + 1).padStart(3, '0')}`,
            name: `${city} ${street.split(' ')[0]} Store #${i + 1}`,
            address: `${100 + Math.floor(r() * 899)} ${street}, ${city}, ${state}`,
            latitude: round(baseLat + (r() - 0.5) * 0.6, 4),
            longitude: round(baseLon + (r() - 0.5) * 0.6, 4)
        });
    }
    return stores;
}

function generateProducts(count) {
    const products = [];
    for (let i = 0; i < count; i++) {
        const r = rngFor('product', i);
        const category = CATEGORIES[Math.floor(r() * CATEGORIES.length)];
        const profile = CATEGORY_PROFILES[category];
        const brand = BRANDS[Math.floor(r() * BRANDS.length)];
        const noun = NOUNS[category][Math.floor(r() * NOUNS[category].length)];
        products.push({
            id: `PR${String(i + 1).padStart(3, '0')}`,
            name: `${brand} ${noun}`,
            category,
            price: round(2 + r() * 28, 2),
            stock: Math.floor(10 + r() * 190),
            idealTemp: profile.idealTemp,
            shelfLifeDays: profile.shelfLifeDays,
            sensitivity: profile.sensitivity
        });
    }
    return products;
}

// Baseline ambient temperature (deg C) for a store position, before daily weather variation is applied.
function positionBaseTemp(store, x, y, z) {
    const r = rngFor('pos', store.id, x, y, z);
    const latitudeFactor = (40 - Math.abs(store.latitude)) * 0.3; // stores closer to equator run warmer
    const zOffset = z === 0 ? -3 : z === 1 ? 0 : 4; // floor level (near coolers) cooler, top shelf near lighting warmer
    return round(18 + latitudeFactor + zOffset + (r() - 0.5) * 2, 1);
}

function generatePlacements(stores, products) {
    const placements = [];
    for (let i = 0; i < products.length; i++) {
        const r = rngFor('placement', products[i].id);
        const store = stores[Math.floor(r() * stores.length)];
        placements.push({
            productId: products[i].id,
            storeId: store.id,
            x: Math.floor(r() * GRID.X),
            y: Math.floor(r() * GRID.Y),
            z: Math.floor(r() * GRID.Z)
        });
    }
    return placements;
}

const DATA_VERSION = 'v1';

function initData() {
    let stores = Store.get(`fg_stores_${DATA_VERSION}`, null);
    let products = Store.get(`fg_products_${DATA_VERSION}`, null);
    let placements = Store.get(`fg_placements_${DATA_VERSION}`, null);

    if (!stores) { stores = generateStores(100); Store.set(`fg_stores_${DATA_VERSION}`, stores); }
    if (!products) { products = generateProducts(100); Store.set(`fg_products_${DATA_VERSION}`, products); }
    if (!placements) { placements = generatePlacements(stores, products); Store.set(`fg_placements_${DATA_VERSION}`, placements); }

    return { stores, products, placements };
}

function savePlacements(placements) {
    Store.set(`fg_placements_${DATA_VERSION}`, placements);
}
