const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

const initDatabase = async () => {
    try {
        console.log('🔍 Connecting to Neon database...');
        
        // Test connection
        const client = await pool.connect();
        console.log('✅ Connected to Neon PostgreSQL database');
        
        // Create products table
        await client.query(`
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                image VARCHAR(500),
                category VARCHAR(100),
                variants JSONB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Products table created/verified');

        // Create orders table
        await client.query(`
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(100) NOT NULL,
                items JSONB NOT NULL,
                total_amount DECIMAL(10,2) NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                payment_method VARCHAR(50) DEFAULT 'COD',
                payment_id VARCHAR(100),
                delivery_address JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Orders table created/verified');

        // Create users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                user_id VARCHAR(100) UNIQUE NOT NULL,
                name VARCHAR(255),
                email VARCHAR(255),
                address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Users table created/verified');

        // Insert sample products if table is empty
        const productCount = await client.query('SELECT COUNT(*) FROM products');
        if (parseInt(productCount.rows[0].count) === 0) {
            await insertSampleProducts(client);
        }

        client.release();
        console.log('🎉 Database initialization completed successfully!');
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        throw error;
    }
};

const insertSampleProducts = async (client) => {
    const sampleProducts = [
        // Fruits
        { name: 'Fresh Apples', image: 'https://images.unsplash.com/photo-1579613832125-5d34a13ffe2a?ixlib=rb-4.0.3&q=85&fm=jpg&crop=entropy&cs=srgb&w=400', category: 'Fruits', variants: [{unit: '500 g', price: 75}, {unit: '1 kg', price: 150}] },
        { name: 'Bananas', image: 'https://images.unsplash.com/photo-1528825871115-3581a5387919?ixlib=rb-4.0.3&q=85&fm=jpg&crop=entropy&cs=srgb&w=400', category: 'Fruits', variants: [{unit: '6 pcs', price: 30}, {unit: '1 dozen', price: 50}] },
        { name: 'Mangoes', image: 'https://images.unsplash.com/photo-1553279768-865429fa0078?ixlib=rb-4.0.3&q=85&fm=jpg&crop=entropy&cs=srgb&w=400', category: 'Fruits', variants: [{unit: '500 g', price: 200}, {unit: '1 kg', price: 380}] },
        
        // Vegetables
        { name: 'Tomatoes', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1024-1024,pr-true,f-auto,q-80/cms/product_variant/04a3037a-04a3-47f3-9db4-23ae268177aa.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 24}, {unit: '500 g', price: 42}] },
        { name: 'Onion (Pyaz)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/49dcc487-39ac-45a3-8ed6-654ff0afa825.jpeg', category: 'Vegetables', variants: [{unit: '500 g', price: 15}, {unit: '1 kg', price: 31}] },
        { name: 'Carrots', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/0ee41064-38af-4d97-ba56-2b26ee7cc9f9.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 15}, {unit: '500 g', price: 28}] },
        
        // Dairy
        { name: 'Organic Milk', image: 'https://images.unsplash.com/photo-1559598467-f8b76c8155d0?ixlib=rb-4.0.3&q=85&fm=jpg&crop=entropy&cs=srgb&w=400', category: 'Dairy', variants: [{unit: '500 ml', price: 25}, {unit: '1 litre', price: 48}] },
        { name: 'Eggs', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/35241f67-e64e-4f15-8c9e-175186993049.jpeg', category: 'Dairy', variants: [{unit: '6 pack', price: 40}, {unit: '12 pack', price: 70}] },
        { name: 'Cheddar Cheese', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/19b40e18-47b0-40bb-806c-f8e9319f6f16.jpeg', category: 'Dairy', variants: [{unit: '100 g', price: 110}, {unit: '200 g', price: 200}] },
        
        // Bakery
        { name: 'Whole Wheat Bread', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/68de0f15-ba46-4a79-95ec-0e2a33ce9dcc.jpeg', category: 'Bakery', variants: [{unit: '1 loaf', price: 45}] }
    ];

    for (const product of sampleProducts) {
        await client.query(
            'INSERT INTO products (name, image, category, variants) VALUES ($1, $2, $3, $4)',
            [product.name, product.image, product.category, JSON.stringify(product.variants)]
        );
    }
    console.log('✅ Sample products inserted');
};

// Run initialization
if (require.main === module) {
    initDatabase()
        .then(() => {
            console.log('Database setup completed!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('Database setup failed:', error);
            process.exit(1);
        });
}

module.exports = { pool, initDatabase };