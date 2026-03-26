const db = require('./_db');

const DEFAULT_PRODUCT_IMAGE = 'https://placehold.co/200x200/e0e0e0/333?text=No+Image';

const normalizeName = (name = '') => String(name).trim().toLowerCase().replace(/\s+/g, ' ');

const hasUsableImage = (image) => {
    if (typeof image !== 'string') return false;
    const normalized = image.trim().toLowerCase();
    return normalized.length > 0 && normalized !== 'null' && normalized !== 'undefined';
};

const normalizeProductList = (items = []) => {
    const productsByName = new Map();

    items.forEach((item) => {
        if (!item || !item.name || !Array.isArray(item.variants) || item.variants.length === 0) {
            return;
        }

        const key = normalizeName(item.name);
        if (!key) return;

        const existing = productsByName.get(key);
        const candidateHasImage = hasUsableImage(item.image);
        const existingHasImage = existing ? hasUsableImage(existing.image) : false;

        const candidate = {
            ...item,
            image: candidateHasImage ? item.image : (existingHasImage ? existing.image : DEFAULT_PRODUCT_IMAGE)
        };

        if (!existing) {
            productsByName.set(key, candidate);
            return;
        }

        const shouldReplace =
            (!existingHasImage && candidateHasImage) ||
            ((item.variants?.length || 0) > (existing.variants?.length || 0));

        if (shouldReplace) {
            productsByName.set(key, {
                ...candidate,
                image: candidateHasImage ? item.image : existing.image
            });
            return;
        }

        if (!existingHasImage) {
            productsByName.set(key, {
                ...existing,
                image: candidateHasImage ? item.image : DEFAULT_PRODUCT_IMAGE
            });
        }
    });

    return Array.from(productsByName.values());
};

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Try to get products from database
        const result = await db.query('SELECT * FROM products ORDER BY id');
        res.status(200).json(normalizeProductList(result.rows));
    } catch (error) {
        console.error('Database error, falling back to sample data:', error.message);
        
        // Fallback to sample data if database is not available
        const fallbackProducts = [
            { id: 1, name: 'Fresh Apples', image: 'https://images.unsplash.com/photo-1579613832125-5d34a13ffe2a?ixlib=rb-4.0.3&q=85&fm=jpg&crop=entropy&cs=srgb&w=400', category: 'Fruits', variants: [{unit: '500 g', price: 75}, {unit: '1 kg', price: 150}] },
            { id: 2, name: 'Bananas', image: 'https://images.unsplash.com/photo-1528825871115-3581a5387919?ixlib=rb-4.0.3&q=85&fm=jpg&crop=entropy&cs=srgb&w=400', category: 'Fruits', variants: [{unit: '6 pcs', price: 30}, {unit: '1 dozen', price: 50}] },
            { id: 3, name: 'Tomatoes', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1024-1024,pr-true,f-auto,q-80/cms/product_variant/04a3037a-04a3-47f3-9db4-23ae268177aa.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 24}, {unit: '500 g', price: 42}] },
            { id: 4, name: 'Organic Milk', image: 'https://images.unsplash.com/photo-1559598467-f8b76c8155d0?ixlib=rb-4.0.3&q=85&fm=jpg&crop=entropy&cs=srgb&w=400', category: 'Dairy', variants: [{unit: '500 ml', price: 25}, {unit: '1 litre', price: 48}] },
            { id: 5, name: 'Whole Wheat Bread', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/68de0f15-ba46-4a79-95ec-0e2a33ce9dcc.jpeg', category: 'Bakery', variants: [{unit: '1 loaf', price: 45}] },
            { id: 6, name: 'Eggs', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/35241f67-e64e-4f15-8c9e-175186993049.jpeg', category: 'Dairy', variants: [{unit: '6 pack', price: 40}, {unit: '12 pack', price: 70}] }
        ];
        
        res.status(200).json(normalizeProductList(fallbackProducts));
    }
}