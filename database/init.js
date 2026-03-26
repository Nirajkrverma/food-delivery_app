const { Pool } = require('pg');
const dns = require('dns');
require('dotenv').config({ path: '.env.local' });

// Use public DNS resolvers for local Neon hostname lookups when local DNS blocks them.
try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (error) {
    console.warn('⚠️ Could not set custom DNS servers:', error.message);
}

function sanitizeConnectionString(value = '') {
    const trimmed = String(value).trim();
    if (!trimmed) return '';
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
        (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
}

function pickConnectionString() {
    const candidates = [
        sanitizeConnectionString(process.env.DATABASE_URL),
        sanitizeConnectionString(process.env.POSTGRES_URL)
    ].filter(Boolean);

    for (const candidate of candidates) {
        try {
            new URL(candidate);
            return candidate;
        } catch (_) {
            // Keep trying next candidate.
        }
    }

    return '';
}

const rawDbConnectionString = pickConnectionString();

async function createDatabasePool() {
    if (!rawDbConnectionString) {
        throw new Error('DATABASE_URL/POSTGRES_URL is not configured');
    }

    const url = new URL(rawDbConnectionString);
    const originalHost = url.hostname;

    try {
        await dns.promises.lookup(originalHost);
        return new Pool({
            connectionString: rawDbConnectionString,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000
        });
    } catch (error) {
        let resolvedIps = [];
        try {
            resolvedIps = await dns.promises.resolve4(originalHost);
        } catch (_) {
            // Try IPv6 when IPv4 records are unavailable.
        }

        if (!resolvedIps.length) {
            try {
                const resolvedIpv6 = await dns.promises.resolve6(originalHost);
                resolvedIps = resolvedIpv6;
            } catch (_) {
                // Fall through and rethrow the original DNS error.
            }
        }

        if (!resolvedIps.length) {
            throw error;
        }

        const fallbackUrl = new URL(rawDbConnectionString);
        fallbackUrl.hostname = resolvedIps[0];
        fallbackUrl.searchParams.delete('sslmode');
        fallbackUrl.searchParams.delete('channel_binding');

        console.warn(`⚠️ DNS fallback in use for DB host ${originalHost} -> ${resolvedIps[0]}`);

        return new Pool({
            connectionString: fallbackUrl.toString(),
            ssl: {
                rejectUnauthorized: false,
                servername: originalHost
            },
            connectionTimeoutMillis: 10000,
            idleTimeoutMillis: 30000
        });
    }
}

const initDatabase = async () => {
    try {
        console.log('🔍 Connecting to Neon database...');
        const pool = await createDatabasePool();
        
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
                address_line1 TEXT,
                address_line2 TEXT,
                city VARCHAR(120),
                state VARCHAR(120),
                pincode VARCHAR(20),
                country VARCHAR(120),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('✅ Users table created/verified');

        // Keep legacy databases in sync with the current address parameters.
        await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line1 TEXT');
        await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS address_line2 TEXT');
        await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS city VARCHAR(120)');
        await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS state VARCHAR(120)');
        await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS pincode VARCHAR(20)');
        await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS country VARCHAR(120)');

        // Keep one row per user_id before enforcing uniqueness on legacy tables.
        await client.query(`
            DELETE FROM users u
            USING users dup
            WHERE u.user_id = dup.user_id
              AND u.id < dup.id
        `);
        await client.query('CREATE UNIQUE INDEX IF NOT EXISTS users_user_id_unique_idx ON users (user_id)');

        // Ensure product catalog is fully present even when table is partially populated.
        await upsertSampleProducts(client);

        client.release();
        await pool.end();
        console.log('🎉 Database initialization completed successfully!');
        
    } catch (error) {
        console.error('❌ Database initialization failed:', error.message);
        throw error;
    }
};

const upsertSampleProducts = async (client) => {
    const sampleProducts = [
            // Fruits
        { id: 1, name: 'Fresh Apples', image: 'https://cdn.grofers.com/cdn-cgi/image/f=auto,fit=scale-down,q=70,metadata=none,w=360/da/cms-assets/cms/product/8304edd4-bfcb-44f4-87de-c8faa6aeb3fa.png', category: 'Fruits', variants: [{unit: '500 g', price: 75}, {unit: '1 kg', price: 150}] },
        { id: 2, name: 'Bananas', image: 'https://cdn.grofers.com/cdn-cgi/image/f=auto,fit=scale-down,q=70,metadata=none,w=360/da/cms-assets/cms/product/b89fe4bd-2018-4502-a80e-d8dc274955b8.png', category: 'Fruits', variants: [{unit: '6 pcs', price: 30}, {unit: '1 dozen', price: 50}] },
        { id: 13, name: 'Mangoes', image: 'https://cdn.grofers.com/cdn-cgi/image/f=auto,fit=scale-down,q=70,metadata=none,w=360/da/cms-assets/cms/product/cf5d2c0d-c3f7-4b34-938b-4ce11b9d7cb7.png', category: 'Fruits', variants: [{unit: '500 g', price: 200}, {unit: '1 kg', price: 380}] },
        { id: 14, name: 'Pineapple', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1024-1536,pr-true,f-auto,q-80/cms/product_variant/088cb923-8d1a-431f-98ea-2f01259b3545.png', category: 'Fruits', variants: [{unit: '1 piece', price: 45}, {unit: '1 kg', price: 35}] },
        { id: 15, name: 'Papaya', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/14beced9-a7d1-4a3f-b9bb-ab0a150876f6.jpeg', category: 'Fruits', variants: [{unit: '500 g', price: 30}, {unit: '1 kg', price: 55}] },
        { id: 16, name: 'Coconut', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/fe8840b1-211d-4fca-9420-23703e653c7e.jpeg', category: 'Fruits', variants: [{unit: '2 pc', price: 100}, {unit: '3 pieces', price: 120}] },
        { id: 17, name: 'Guava', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/ea93a3d6-86dc-4a08-a514-39e10ef0d2da.jpeg', category: 'Fruits', variants: [{unit: '250 g', price: 30}, {unit: '500 g', price: 55}] },
        { id: 18, name: 'Pomegranate', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/b5087a3e-1d5f-4840-8110-5c16ba1d7592.jpeg', category: 'Fruits', variants: [{unit: '2 pc', price: 80}, {unit: '5 pc', price: 180}] },
        { id: 19, name: 'Sitaphal', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1000-1000,pr-true,f-auto,q-80/inventory/product/7a9de189-99b9-4dfe-93ca-7e097e462f0d-c2b59324-e5cf-4eca-8de9-d6b37b5f33f6.jpeg', category: 'Fruits', variants: [{unit: '250 g', price: 60}, {unit: '500 g', price: 110}] },
        { id: 20, name: 'Chiku', image: 'https://media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,w_252,h_272/4d6bafea4ef76eb9abcfb1cf00cbe776', category: 'Fruits', variants: [{unit: '250 g', price: 40}, {unit: '500 g', price: 89}] },
        { id: 21, name: 'Amla', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/aca5a7f6-ffbf-4c8c-bd24-58fd4b695f62.jpeg', category: 'Fruits', variants: [{unit: '250 g', price: 35}, {unit: '500 g', price: 65}] },
        { id: 22, name: 'Green grapes', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/3f86ac58-4a55-4b7e-9775-25afa7e74734.jpeg', category: 'Fruits', variants: [{unit: '250 g', price: 53}, {unit: '500 g', price: 100}] },
        { id: 23, name: 'Mousami', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/411b71aa-da3c-48f8-823e-f0f39dcbf3e8.jpeg', category: 'Fruits', variants: [{unit: '4 pcs', price: 36}, {unit: '6 pcs', price: 70}] },

        
        // Vegetables
        { id: 24, name: 'Tomatoes', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1024-1024,pr-true,f-auto,q-80/cms/product_variant/04a3037a-04a3-47f3-9db4-23ae268177aa.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 24}, {unit: '500 g', price: 42}] },
        { id: 25, name: 'Onion (Pyaz)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/49dcc487-39ac-45a3-8ed6-654ff0afa825.jpeg', category: 'Vegetables', variants: [{unit: '500 g', price: 15}, {unit: '1 kg', price: 31}] },
        { id: 26, name: 'Green Chilli (Hari Mirch)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-500-500,pr-true,f-auto,q-80/inventory/product/dfae6a29-0a76-410c-8e70-c4dad230fe03-4a396220-0f35-438b-a3fd-b3a0fc9364f9.jpeg', category: 'Vegetables', variants: [{unit: '100 g', price: 11}, {unit: '250 g', price: 25}] },
        { id: 27, name: 'Ginger (Adrak)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/5e0e4e72-7b21-4d85-a825-0ad8e665ccf4.jpeg', category: 'Vegetables', variants: [{unit: '100 g', price: 23}] },
        { id: 28, name: 'Garlic (Lahsun)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1024-1024,pr-true,f-auto,q-80/cms/product_variant/8d450361-f0d4-4118-a0c5-13552116ee58.jpeg', category: 'Vegetables', variants: [{unit: '100 g', price: 12}, {unit: '250 g', price: 24}] },
        { id: 29, name: 'Carrots', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/0ee41064-38af-4d97-ba56-2b26ee7cc9f9.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 15}, {unit: '500 g', price: 28}] },
        { id: 30, name: 'Cucumbers', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/36ebbe87-6b53-4425-9cef-a3387f5c51f1.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 18}, {unit: '500 g', price: 30}] },
        { id: 31, name: 'Potatoes (Aloo)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-500-500,pr-true,f-auto,q-80/inventory/product/62ec10c9-6f56-4013-8642-df23c1b6fdeb-/tmp/20230103-100111.jpeg', category: 'Vegetables', variants: [{unit: '500 g', price: 13}, {unit: '1 kg', price: 27}] },
        { id: 32, name: 'Cabbage (Patta Gobi)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1024-1024,pr-true,f-auto,q-80/cms/product_variant/ac80085e-346f-436b-83d2-3c9ee8186b54.jpeg', category: 'Vegetables', variants: [{unit: '1 pc', price: 46}, {unit: '3 pc', price: 96}] },
        { id: 33, name: 'Cauliflower (Phool Gobi)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/fa93ba68-203d-4b3a-9971-93bed8ef633c.jpeg', category: 'Vegetables', variants: [{unit: '1 pc', price: 20}, {unit: '3 pc', price: 65}] },
        { id: 34, name: 'Brinjal (Baingan)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/bf245c16-8506-4f79-a389-d4968d535add.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 21}, {unit: '500 g', price: 41}] },
        { id: 35, name: 'Green Frozen Peas (Hari Matar)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-900-900,pr-true,f-auto,q-80/cms/product_variant/07334ac7-7510-46c6-802b-be6ae4952ed3.jpeg', category: 'Vegetables', variants: [{unit: '1 kg', price: 201}] },
        { id: 36, name: 'Radish (Mooli)', image: 'https://www.bbassets.com/media/uploads/p/l/10000164_17-fresho-radish-white.jpg', category: 'Vegetables', variants: [{unit: '250 g', price: 12}, {unit: '500 g', price: 23}] },
        { id: 37, name: 'Ladyfingers (Bhindi)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1184-864,pr-true,f-auto,q-80/cms/product_variant/cb4e5871-fad2-4600-9922-76d06e3c3302.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 15}, {unit: '500 g', price: 35}] },
        { id: 38, name: 'Bottle Gourd (Lauki)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/393d5fc9-cc25-48cd-a3d7-700f06ee20be.jpeg', category: 'Vegetables', variants: [{unit: '1 pc', price: 33}, {unit: '3 pc', price: 90}] },
        { id: 39, name: 'Capsicum (Shimla Mirch)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/254ecf06-127d-4e0b-948c-bc15aba40b3f.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 26}, {unit: '500 g', price: 52}] },
        { id: 40, name: 'Beetroot (Chukandar)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/4c638db5-3382-4cd5-99f3-91252d14540c.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 14}, {unit: '500 g', price: 28}] },
        { id: 41, name: 'Broccoli', image: 'https://www.bbassets.com/media/uploads/p/m/40016101_6-fresho-broccoli-florets.jpg?tr=w-154,q-80', category: 'Vegetables', variants: [{unit: '200 g', price: 85}] },
        { id: 42, name: 'Green Beans (French Beans)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/fd0cd769-5cdd-4c03-ae44-244a186d2b89.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 24}, {unit: '500 g', price: 50}] },
        { id: 43, name: 'Sweet Corn (Bhutta)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/dcc5110c-5812-46ae-abf1-0edd1480f4af.jpeg', category: 'Vegetables', variants: [{unit: '2 pcs', price: 52}, {unit: '4 pcs', price: 100}] },
        { id: 44, name: 'Drumstick (Sahjan)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-2400-3000,pr-true,f-auto,q-80/cms/product_variant/5fcec90e-6eae-4185-aae3-c5db96d62cbf.jpeg', category: 'Vegetables', variants: [{unit: '200 g', price: 93}, {unit: '1 kg', price: 290}] },
        { id: 45, name: 'Pumpkin (Kaddu)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-225-225,pr-true,f-auto,q-80/cms/product_variant/2b507494-3a63-4b40-a14f-15f0722cf211.jpg', category: 'Vegetables', variants: [{unit: '500 g', price: 24}] },
        { id: 46, name: 'Mushroom (Khumbi)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/27fa1e35-9ca9-4eea-8b45-0f8850b07813.jpeg', category: 'Vegetables', variants: [{unit: '200 g', price: 69}] },
        { id: 47, name: 'Pointed Gourd (Parwal)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-490-490,pr-true,f-auto,q-80/cms/product_variant/0eadfcca-6600-418c-8e1a-7d63ff0814c9.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 12}, {unit: '500 g', price: 25}] },
        { id: 48, name: 'Ridged Gourd (Turai)', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/a3311107-ea9b-40a0-864b-b7ef0307d9aa.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 16}, {unit: '500 g', price: 26}] },
        { id: 49, name: 'Apple Gourd (Tinda)', image: 'https://www.bbassets.com/media/uploads/p/m/10000371_13-fresho-tinda.jpg?tr=w-154,q-80', category: 'Vegetables', variants: [{unit: '250 g', price: 26}, {unit: '500 g', price: 50}] },
        { id: 50, name: 'Spinach (Palak)', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/aaedc2c9-8e42-44cd-b835-c43d1b3913ec.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 25}, {unit: '500 g', price: 50}] },

        // Dairy
        { id: 51, name: 'Amul Milk', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-403,ar-1200-1200,pr-true,f-auto,,q-40,dpr-2/cms/product_variant/2e8a0f88-1038-4fd3-8093-7085a49b473c/Amul-Taaza-Toned-Fresh-Milk-Pouch.jpeg', category: 'Dairy', variants: [{unit: '500 ml', price: 25}, {unit: '1 litre', price: 48}] },
        { id: 52, name: 'Eggs', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/35241f67-e64e-4f15-8c9e-175186993049.jpeg', category: 'Dairy', variants: [{unit: '6 pack', price: 40}, {unit: '12 pack', price: 70}] },
        { id: 53, name: 'Cheddar Cheese', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/19b40e18-47b0-40bb-806c-f8e9319f6f16.jpeg', category: 'Dairy', variants: [{unit: '100 g', price: 110}, {unit: '200 g', price: 200}] },
        { id: 54, name: 'Misti Doi', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/f05477e8-2eb0-42d7-bcf8-b724e69e57c6.jpg', category: 'Dairy', variants: [{unit: '80 g', price: 15}, {unit: '400 g', price: 70}] },
        { id: 55, name: 'Aam Misti Doi', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-2400-2400,pr-true,f-auto,q-80/cms/product_variant/d3f9c6cc-f09f-43df-a98d-c33d3ca531d6.jpeg', category: 'Dairy', variants: [{unit: '100 g', price: 17}, {unit: '200 g', price: 80}] },
        
        // Bakery
        { id: 56, name: 'Whole Wheat Bread', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/68de0f15-ba46-4a79-95ec-0e2a33ce9dcc.jpeg', category: 'Bakery', variants: [{unit: '1 loaf', price: 45}] },

        

        // Beauty & wellness 

        { id: 600, name: 'Bronson Professional Face Pack Brush', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/788aef31-0cd2-4ed6-afbe-eb545bab8484.jpeg', category: 'Beauty & wellness', variants: [{unit: '1 pc', price: 84}, {unit: '2 pc', price: 159}] },
        { id: 601, name: 'Maybelline New York Colossal Kajal Black Fix With Aloe Vera', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/1b71153b-c3ce-4eb8-bd63-1c7aa01dc980.jpeg', category: 'Beauty & wellness', variants: [{unit: '0.35 g', price: 141}] },
        { id: 602, name: 'Lakme 9 To 5 Weightless Mousse Foundation | Rose | Ivory', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/ab21bb27-0d63-4c59-87a1-b6f792938ae9/Lakme-9-To-5-Weightless-Mousse-Foundation-Rose-Ivory.jpeg', category: 'Beauty & wellness', variants: [{unit: '6 g', price: 182}] },
        { id: 603, name: 'Maybelline New York Compact Powder - Ivory | Resists Humidity', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/795942fd-2830-4c50-af0e-475e53c1fc35/Maybelline-New-York-Compact-Powder-Ivory-Resists-Humidity.jpeg', category: 'Beauty & wellness', variants: [{unit: '6 g', price: 269}] },
        { id: 604, name: 'Elle 18 Color Pop Matte Lip Color | B4 Almond Butter', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-2000-2000,pr-true,f-auto,q-80/cms/product_variant/8418d1c7-d53c-46ae-aae0-0b84710e1a72.jpg', category: 'Beauty & wellness', variants: [{unit: '4.31 g', price: 105}] },
        { id: 605, name: 'Love Earth Multipot-Got Your Back Coral', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1080-1080,pr-true,f-auto,q-80/cms/product_variant/19e7fc50-0132-49a0-b64a-b6f5b32bc320.jpeg', category: 'Beauty & wellness', variants: [{unit: ' 8 g', price: 240}] },
        { id: 606, name: 'SUGAR POP Quick Drying Ultra Long-Wear Glossy Finish Nail Lacquer -Silk Stockings 08', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-2000-2000,pr-true,f-auto,q-80/cms/product_variant/655e2867-1edc-4e34-8c5c-bfa5b7348319.jpeg', category: 'Beauty & wellness', variants: [{unit: '10 ml', price: 102}] },
        { id: 607, name: 'Ponds Natural Glow Face Powder Bb Glow', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-600-600,pr-true,f-auto,q-80/cms/product_variant/aebeddeb-07cc-4ccb-a4da-c928fbc26ef1.jpg', category: 'Beauty & wellness', variants: [{unit: '30g', price: 133}] },
        { id: 608, name: 'Bronson Professional Beauty Blender Sponge ', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-912-904,pr-true,f-auto,q-80/cms/product_variant/86e6b675-a83e-4a41-92c4-0472cc8c9c76.jpg', category: 'Beauty & wellness', variants: [{unit: '1 pc', price: 104}] },
        { id: 609, name: 'Lacto Calamine Makeup Remover Wipes With Aloe Vera, Cucumber And Vitamin E', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1500-1500,pr-true,f-auto,q-80/cms/product_variant/31e0c3a2-d3f8-42f6-bdc6-b9fdc8500e74/Lacto-Calamine-Makeup-Remover-Wipes-With-Aloe-Vera-Cucumber-And-Vitamin-E.jpeg', category: 'Beauty & wellness', variants: [{unit: '1 Pack (25 pc)', price: 65}] },
        { id: 610, name: 'Insight Cosmetics Non Transfer Liquid Lipstick - Molten Pink | Cruelty Free', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/6fcad1b2-375a-45a3-8bda-2f976e6917b5/Insight-Cosmetics-Non-Transfer-Liquid-Lipstick-Molten-Pink-Cruelty-Free.jpeg', category: 'Beauty & wellness', variants: [{unit: '4 ml', price: 114}] },
        { id: 611, name: 'Blue Heaven Lash Twist Curling Mascara Black', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/a4307307-0603-4566-88b0-d4e2b1e75d03/Blue-Heaven-Lash-Twist-Curling-Mascara-Black.jpeg', category: 'Beauty & wellness', variants: [{unit: '12 ml', price: 119}] },
        { id: 612, name: 'Faces Canada Eyeliner - Black | Waterproof', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/792163d0-4a63-41f9-aef7-b272e4775479.jpeg', category: 'Beauty & wellness', variants: [{unit: '3.5 ml', price: 200}] },
        { id: 613, name: 'VEGA Round Hair Brush for Men and Women | R3-RB', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1500-1500,pr-true,f-auto,q-80/cms/product_variant/f38d3b63-6d48-4993-958d-27fee5293f20/VEGA-Round-Hair-Brush-for-Men-and-Women-R3-RB.jpeg', category: 'Beauty & wellness', variants: [{unit: '1 piece', price: 190}] },
        { id: 614, name: 'Elle 18 Ace Base Primer', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/b73ed1b8-952b-435d-9f8a-399653502244.jpg', category: 'Beauty & wellness', variants: [{unit: '10 ml', price: 118}] },
        { id: 615, name: 'Lakme Liquid Nail Polish Remover With Vitamin E', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/3f9b4479-c3c8-45b9-afa4-c081a209a678.jpeg', category: 'Beauty & wellness', variants: [{unit: '27 ml', price: 94}] },
        { id: 616, name: 'Lakme Unreal Blurfect Primer, Mattifies & Blurs Pores', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/c5776b76-9507-4d70-b763-8995b5b1295f/Lakme-Unreal-Blurfect-Primer-Mattifies-Blurs-Pores.jpeg', category: 'Beauty & wellness', variants: [{unit: '10 g', price: 326}] },
        { id: 617, name: 'SUGAR Cosmetics Matte Attack Transferproof Lipstick - 01 Boldplay (Cardinal Pink)', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-631-861,pr-true,f-auto,q-80/cms/product_variant/0585c70a-6487-4452-ac0b-4c1692a2dd89/SUGAR-Cosmetics-Matte-Attack-Transferproof-Lipstick-01-Boldplay-Cardinal-Pink-.jpeg', category: 'Beauty & wellness', variants: [{unit: '2 g', price: 622}] },
        { id: 618, name: 'Insight Cosmetics Blush - Strawberry Drip | Easy To Blend', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-619-832,pr-true,f-auto,q-80/cms/product_variant/8f37e733-bcb0-43e1-bb30-163bae25d846/Insight-Cosmetics-Blush-Strawberry-Drip-Easy-To-Blend.jpeg', category: 'Beauty & wellness', variants: [{unit: '1 pc', price: 91}] },
        { id: 619, name: 'Insight Cosmetics Eyebrow Pencil - Brown | Waterproof', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/0227ad59-af0b-432b-a3df-4ba45c617c60/Insight-Cosmetics-Eyebrow-Pencil-Brown-Waterproof.jpeg', category: 'Beauty & wellness', variants: [{unit: '1 pc', price: 148}] },
        { id: 620, name: 'Colouressence Nail Paint Kit | Free Nail Paint Remover | Naturally Yours - MultiColour', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1100-1100,pr-true,f-auto,q-80/cms/product_variant/5c5cacbc-04e5-49f0-951a-16e2d6f80d97/Colouressence-Nail-Paint-Kit-Free-Nail-Paint-Remover-Naturally-Yours-MultiColour.jpeg', category: 'Beauty & wellness', variants: [{unit: '1 pack (5 pcs)', price: 223}] },
        { id: 621, name: 'Swiss Beauty Cheek-A-Boo 3 In One Blusher Contour And Highlighter ', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/6a34f5ae-64e7-4c0a-8cdd-10e67e53338e/Swiss-Beauty-Cheek-A-Boo-3-In-One-Blusher-Contour-And-Highlighter-2.jpeg', category: 'Beauty & wellness', variants: [{unit: '1 set (8 g)', price: 315}] },
        { id: 622, name: 'Bronson Professional Premium Makeup Brush Set For Professional Home Use', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/5cfecb2b-0f99-413f-9959-3395d8a81dff/Bronson-Professional-Premium-Makeup-Brush-Set-For-Professional-Home-Use.jpeg', category: 'Beauty & wellness', variants: [{unit: '1 pack (10 pcs)', price: 300}] },
        { id: 623, name: 'Lakme 9to5 Powerplay Priming Matte Lipstick, Lasts 16hrs, Burgundy Passion', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1000-1000,pr-true,f-auto,q-80/inventory/product/de2fd650-1669-4de9-a32a-f57b6c0028ed-/tmp/20230313-1016331/Lakme-9to5-Powerplay-Priming-Matte-Lipstick-Lasts-16hrs-Burgundy-Passion.jpeg', category: 'Beauty & wellness', variants: [{unit: '3.6 g', price: 495}] },
        { id: 624, name: 'Spinz BB Brightening & Beauty Fairness Cream Gives 2X Instant Glow Sun Protection Dark Spots Correction', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/53113ab6-5fb7-4493-a189-5e875079ef77/Spinz-BB-Brightening-Beauty-Fairness-Cream-Gives-2X-Instant-Glow-Sun-Protection-Dark-Spots-Correction.jpeg', category: 'Beauty & wellness', variants: [{unit: '29 g', price: 89}] },
        { id: 625, name: 'SUGAR POP Matte Eyeliner - Black', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-2000-2000,pr-true,f-auto,q-80/cms/product_variant/a1bb4704-fa18-45cc-bca6-889e95dc12ef/SUGAR-POP-Matte-Eyeliner-Black.jpeg', category: 'Beauty & wellness', variants: [{unit: '4.5 ml', price: 174}] },
        { id: 626, name: 'Lakme Forever Matte Face Powder, Matte Finish, Oil Cointrol, for rosy glow, Soft Pink', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-2000-2000,pr-true,f-auto,q-80/cms/product_variant/dd80343b-fd23-476f-8270-d902d9b2fe96/Lakme-Forever-Matte-Face-Powder-Matte-Finish-Oil-Cointrol-for-rosy-glow-Soft-Pink.jpeg', category: 'Beauty & wellness', variants: [{unit: '40 g', price: 223}] },

        //Pharmacy


        { id: 401, name: 'Himalaya Liv. 52 Liver Care Supplement Tablets', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-5000-5000,pr-true,f-auto,q-80/cms/product_variant/a181aeec-c785-43f1-85cf-8df97d025820/Himalaya-Liv-52-Liver-Care-Supplement-Tablets.jpeg', category: 'Pharmacy', variants: [{unit: '1 pack (100 pcs)', price: 215}] },
        { id: 402, name: 'Vicks Vaporub Xtra Strong - Extra Strong Cold Relief', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/89cd61c8-f3b0-4f8e-97ea-238d532ad33f/Vicks-Vaporub-Xtra-Strong-Extra-Strong-Cold-Relief.jpeg', category: 'Pharmacy', variants: [{unit: '25 ml', price: 116}] },
        { id: 403, name: 'Moov Pain Relief Specialist', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/0ddf1325-6312-40e7-a896-a6c16bbc0f33/Moov-Pain-Relief-Specialist.jpeg', category: 'Pharmacy', variants: [{unit: '30 g', price: 162}] },
        { id: 404, name: 'Cetaphil Gentle Skin Cleanser', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/527bcc0d-5bbc-4b52-ae67-fc6d1cacf3db/Cetaphil-Gentle-Skin-Cleanser.jpeg', category: 'Pharmacy', variants: [{unit: '250 ml', price: 716}] },
        { id: 405, name: 'La Shield SPF 40+ & PA+++ Anti Acne Sunscreen Gel', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1100-1100,pr-true,f-auto,q-80/cms/product_variant/1d31efa0-a04f-4f6f-9a6c-08de3efa1d04/La-Shield-SPF-40-PA-Anti-Acne-Sunscreen-Gel.jpeg', category: 'Pharmacy', variants: [{unit: '50 g', price: 782}] },
        { id: 406, name: 'Neutrogena Hydro Boost Water Gel Face Moisturizer', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-800-800,pr-true,f-auto,q-80/cms/product_variant/4ed4bc60-33ac-4ec7-a1c1-b9e17c5d4144/Neutrogena-Hydro-Boost-Water-Gel-Face-Moisturizer.jpeg', category: 'Pharmacy', variants: [{unit: '50 g', price: 1071}] },
        { id: 407, name: 'Dolo 650mg Strip Of 15 Tablets', image: 'https://cdn.grofers.com/cdn-cgi/image/f=auto,fit=scale-down,q=70,metadata=none,w=450/da/cms-assets/cms/product/f461918c-e2fa-4287-b546-98647fe67175.png', category: 'Pharmacy', variants: [{unit: '15 tablets', price: 31}] },
        { id: 408, name: 'Boroline Suthol Skin Antiseptic Liquid - Neem', image: 'https://cdn.grofers.com/cdn-cgi/image/f=auto,fit=scale-down,q=70,metadata=none,w=450/da/cms-assets/cms/product/2602f114-e5de-4677-b094-afb5c8899415.png', category: 'Pharmacy', variants: [{unit: '100 ml', price: 47}] },
        { id: 409, name: 'ENO - Lemon Fruit Salt Sixer Pack', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/dcefe038-e4ce-4d54-9f93-87412cb89f1c/ENO-Lemon-Fruit-Salt-Sixer-Pack.jpeg', category: 'Pharmacy', variants: [{unit: '1 pack (6 pcs)', price: 66}] },
        { id: 410, name: 'Hansaplast Washproof Anti-Septic Adhesive Bandage', image: 'https://cdn.grofers.com/cdn-cgi/image/f=auto,fit=scale-down,q=70,metadata=none,w=450/da/cms-assets/cms/product/5ca61a04-2613-4f70-845a-6189173225f0.png', category: 'Pharmacy', variants: [{unit: '20 pieces', price: 55}] },
        { id: 411, name: 'Prolyte Mixed Fruit ORS', image: 'https://cdn.grofers.com/cdn-cgi/image/f=auto,fit=scale-down,q=70,metadata=none,w=450/da/cms-assets/cms/product/de73e7aa-c7c6-410b-87d9-e73082f1f092.png', category: 'Pharmacy', variants: [{unit: '200 ml', price: 32}] },
        { id: 412, name: 'Honitus Cough Syrup', image: 'https://cdn.grofers.com/cdn-cgi/image/f=auto,fit=scale-down,q=70,metadata=none,w=450/da/cms-assets/cms/product/359f7a64-1aff-482e-87aa-d04c1864ec99.png', category: 'Pharmacy', variants: [{unit: '100 ml', price: 109}] },
        { id: 413, name: 'Dettol Antiseptic Liquid', image: 'https://cdn.grofers.com/cdn-cgi/image/f=auto,fit=scale-down,q=70,metadata=none,w=450/da/cms-assets/cms/product/28e22703-546d-4db7-a48a-6011c455a24d.png', category: 'Pharmacy', variants: [{unit: '250 ml', price: 159}] },
        { id: 414, name: 'Tata 1mg Flexible Tip Digital Thermometer (with One Touch Operation)', image: 'https://cdn.grofers.com/cdn-cgi/image/f=auto,fit=scale-down,q=70,metadata=none,w=450/da/cms-assets/cms/product/b4c67125-141a-4bed-8e7c-15fcfa55ed51.png', category: 'Pharmacy', variants: [{unit: '1 unit', price: 197}] },
        { id: 415, name: 'Otrivin Oxy Fast Relief Adult Bottle Of 10ml Nasal Spray', image: 'https://cdn.grofers.com/cdn-cgi/image/f=auto,fit=scale-down,q=70,metadata=none,w=450/da/cms-assets/cms/product/698841c5-f72e-4946-9052-890ba0e6c7a3.png', category: 'Pharmacy', variants: [{unit: '10 ml', price: 120}] },

        //Packaged Foods

        { id: 501, name: 'MAGGI 2-Minute Instant Noodles ', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/7f32128e-0b71-41d4-afb3-7d0eeb9ea095.jpeg', category: 'Packaged Foods', variants: [{unit: '280 g', price: 58}, {unit: '560 g', price: 107}] },
        { id: 502, name: 'Haldirams Aloo Bhujia', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1286,pr-true,f-auto,q-80/cms/product_variant/8a6f103c-a2f4-4ce9-abcd-fcd36bdd788f/Haldiram-s-Bhujia-Sev.jpg', category: 'Packaged Foods', variants: [{unit: '200 g', price: 57}, {unit: '600g', price: 140}] },
        { id: 503, name: 'MTR Rava Idli Mix', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-2400-2400,pr-true,f-auto,q-80/cms/product_variant/c3ad35e9-7d3d-4935-b352-ec0cde8b1784/MTR-Masala-Rava-Idli-Mix.jpeg', category: 'Packaged Foods', variants: [{unit: '500 g', price: 136}] },
        { id: 504, name: 'Kissan Mixed Fruit Jam', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-2000-2000,pr-true,f-auto,q-80/cms/product_variant/8522e705-a615-4fa4-99c7-6ef237c532eb/Kissan-Mixed-Fruit-Jam.jpeg', category: 'Packaged Foods', variants: [{unit: '200 g', price: 75}, {unit: '700 g', price: 212}] },
        { id: 505, name: 'Britannia Good Day Chocochip Cookies', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/17e53a36-71c2-4a8f-89de-72b017f21f2e/Britannia-Good-Day-Chocochip-Cookies.jpeg', category: 'Packaged Foods', variants: [{unit: '200 g', price: 53}, {unit: '400 g', price: 107}] },
        { id: 506, name: 'Kelloggs Almond and Honey Corn Flakes', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-2430-3570,pr-true,f-auto,q-80/cms/product_variant/87937fe2-1a95-4485-b960-d1af83b47866/Kellogg-s-Almond-and-Honey-Corn-Flakes.jpeg', category: 'Packaged Foods', variants: [{unit: '300 g', price: 201}] },
        { id: 507, name: 'Amul Chocominis Chocolate', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/243fc502-4954-4e20-8f1b-ff848de90911/Amul-Chocominis-Chocolate.jpg', category: 'Packaged Foods', variants: [{unit: '250 g', price: 140}] },
        { id: 508, name: 'Sunfeast Dark Fantasy Yumfills Rich Chocolate Pie Cake', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-2560-2560,pr-true,f-auto,q-80/cms/product_variant/a139bce6-9141-4632-939b-bf0d4b09ff20/Sunfeast-Dark-Fantasy-Yumfills-Rich-Chocolate-Pie-Cake.jpeg', category: 'Packaged Foods', variants: [{unit: '1 Pack (11 x 22 g)', price: 90}] },
        { id: 509, name: 'Cadbury Bournville Rich Cocoa Dark Chocolate Bar', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1100-1100,pr-true,f-auto,q-80/cms/product_variant/bfb2e94e-2d3f-41c7-8463-2b9a9ceb7afe/Cadbury-Bournville-Rich-Cocoa-70-Dark-Chocolate-Bar.jpeg', category: 'Packaged Foods', variants: [{unit: '75 g', price: 115}, {unit: '1kg', price: 99}] },
        { id: 510, name: 'Mothers Recipe Mango Pickle', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/b30bf27f-cd26-4d70-b7de-5360f1534442/Mother-s-Recipe-Mango-Pickle.jpeg', category: 'Packaged Foods', variants: [{unit: '300 g', price: 110}] },
        { id: 511, name: 'Amul Salted Butter', image: 'https://cdn.zeptonow.com/production/ik-seo/tr:w-470,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/e15c0b10-0367-4675-a5ab-6da2abf9bee1/Amul-Salted-Butter.jpeg', category: 'Packaged Foods', variants: [{unit: '100g', price: 62}, {unit: '500g', price: 285}] },
        { id: 512, name: 'Top Ramen Curry Noodles', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-2500-2500,pr-true,f-auto,q-80/cms/product_variant/0ba1e77e-6c7e-4aea-9f23-7089b68c2804.jpg', category: 'Packaged Foods', variants: [{unit: '280g', price: 55}, {unit: '560g', price: 105}] },
        { id: 513, name: 'Saffola Masala Oats', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1500-1500,pr-true,f-auto,q-80/cms/product_variant/b9aaafd2-a94e-4359-a6fb-e4e4a5431e76.jpeg', category: 'Packaged Foods', variants: [{unit: '400g', price: 82}, {unit: '1kg', price: 185}] },
        { id: 514, name: 'Nutella Hazelnut Spread', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/4567a987-982d-41fe-8f15-ce8c0d3555d9.jpeg', category: 'Packaged Foods', variants: [{unit: '350g', price: 325}] },
        { id: 515, name: 'Nestle Milkmaid', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/5c431f65-c7fc-4a6a-abd7-712006fdd482.jpeg', category: 'Packaged Foods', variants: [{unit: '380g', price: 139}] },

        // Beverages

        { id: 301, name: 'Coca Cola', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/NI_CATALOG/IMAGES/CIW/2024/3/8/0b274a34-bdc5-45d9-b137-c69f790a5e72_softdrinks-juiceandsoda_S1DCB6HNUV_MN.png', category: 'Beverages', variants: [{unit: '750 ml', price: 35}, {unit: '2 litre', price: 87}] },
        { id: 302, name: 'Pepsi', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/NI_CATALOG/IMAGES/CIW/2025/5/22/74e02e75-b7db-4895-a4c6-89b39c2813f6_791_1.png', category: 'Beverages', variants: [{unit: '750 ml', price: 40}, {unit: '1.5 litre', price: 70}] },
        { id: 303, name: 'Sprite', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/NI_CATALOG/IMAGES/CIW/2024/3/8/9fedc0ca-6634-4752-8d87-a9fc8bac8b82_softdrinks-juiceandsoda_KWZRDPUQ9B_MN.png', category: 'Beverages', variants: [{unit: '750 ml', price: 40}, {unit: '1.5 litre', price: 70}] }, 
        { id: 304, name: 'Thums Up', image: 'https://www.bbassets.com/media/uploads/p/l/251014_12-thums-up-soft-drink.jpg', category: 'Beverages', variants: [{unit: '750 ml', price: 38}, {unit: '1.5 litre', price: 70}] },
        { id: 305, name: 'Fanta Orange', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/sskecws8rslwfklv6zwr', category: 'Beverages', variants: [{unit: '750 ml', price: 36}, {unit: '1.5 litre', price: 75}] },
        { id: 306, name: 'Mountain Dew', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/NI_CATALOG/IMAGES/CIW/2024/11/15/b16905b2-d60d-4280-bde5-585e0dec558a_1326_1.png', category: 'Beverages', variants: [{unit: '750 ml', price: 40}, {unit: '1.5 litre', price: 70}] },
        { id: 307, name: 'Red Bull Energy Drink', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/NI_CATALOG/IMAGES/CIW/2024/11/21/e4d12aae-4c8a-4a0f-9dde-98a0c6ec12a5_1784.png', category: 'Beverages', variants: [{unit: '250 ml', price: 125}, {unit: '500 ml', price: 200}] },
        { id: 308, name: 'Sting Energy Drink', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/NI_CATALOG/IMAGES/CIW/2024/10/10/2540695e-ba98-4394-a9c9-b3cf7c272517_8980_1.png', category: 'Beverages', variants: [{unit: '250 ml', price: 20}, {unit: '500 ml', price: 35}] },
        { id: 309, name: 'Campa Cola', image: 'https://www.bbassets.com/media/uploads/p/l/40329395_1-campa-cola.jpg', category: 'Beverages', variants: [{unit: '250 ml', price: 10}, {unit: '500 ml', price: 20}] },
        { id: 310, name: 'Campa lemon', image: 'https://www.bbassets.com/media/uploads/p/l/40329397_1-campa-lemon-flavoured.jpg', category: 'Beverages', variants: [{unit: '250 ml', price: 10}, {unit: '500 ml', price: 20}] },
        { id: 311, name: 'Campa orange', image: 'https://www.bbassets.com/media/uploads/p/l/40329396_1-campa-orange.jpg', category: 'Beverages', variants: [{unit: '250 ml', price: 10}, {unit: '500 ml', price: 20}] },   
        { id: 312, name: 'Maaza Mango Drink', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/tutgmvizenb68sertwcg', category: 'Beverages', variants: [{unit: '600 ml', price: 40}, {unit: '1.2 litre', price: 75}] },
        { id: 313, name: 'Frooti Mango Drink', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/NI_CATALOG/IMAGES/CIW/2024/5/10/2f4da923-e964-4939-a4da-744ad7e5cb10_softdrinks-juiceandsoda_S1TOPDG0V7_MN.png', category: 'Beverages', variants: [{unit: '200 ml', price: 10}, {unit: '1 litre', price: 60}] },
        { id: 314, name: 'Slice Mango Drink', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/NI_CATALOG/IMAGES/CIW/2024/7/20/5e84e7e8-2847-4291-b94f-3d7bae3262c4_softdrinks-juiceandsoda_AP4UMDOZL8_MN.png', category: 'Beverages', variants: [{unit: '600 ml', price: 40}, {unit: '1.2 litre', price: 75}] },
        { id: 315, name: 'Tropicana Orange Juice', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/NI_CATALOG/IMAGES/CIW/2025/6/24/6b8f60e5-384b-4ce4-a103-3fe8beffdded_347_1.png', category: 'Beverages', variants: [{unit: '200 ml', price: 20}, {unit: '1 litre', price: 110}] },
        { id: 316, name: 'Real Fruit Power Cranberry Juice', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/094dc30c-e82e-4899-95b9-2e8d5d399f0a.jpeg', category: 'Beverages', variants: [{unit: '200 ml', price: 20}, {unit: '1 litre', price: 100}] },
        { id: 317, name: 'Bisleri Water', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/NI_CATALOG/IMAGES/CIW/2025/9/23/d52b08df-7a3e-44fd-9660-514d8dc5d152_560_1.png', category: 'Beverages', variants: [{unit: '1 litre', price: 20}, {unit: '5 litre', price: 80}] },
        { id: 318, name: 'Kinley Water', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/NI_CATALOG/IMAGES/CIW/2025/9/23/95cbe0de-57e2-45a3-84fd-b8356aef33fc_561_1.png', category: 'Beverages', variants: [{unit: '1 litre', price: 20}, {unit: '5 litre', price: 75}] },
        { id: 319, name: 'Limca', image: 'https://instamart-media-assets.swiggy.com/swiggy/image/upload/fl_lossy,f_auto,q_auto,h_544,w_504/iegvddhilgghljtwyoug', category: 'Beverages', variants: [{unit: '750 ml', price: 40}, {unit: '1.5 litre', price: 70}] },
    ];

    await client.query('CREATE UNIQUE INDEX IF NOT EXISTS products_name_category_unique_idx ON products (LOWER(name), category)');

    let insertedCount = 0;
    let updatedCount = 0;

    for (const product of sampleProducts) {
        const existing = await client.query(
            'SELECT id, image, variants FROM products WHERE LOWER(name) = LOWER($1) AND category = $2 LIMIT 1',
            [product.name, product.category]
        );

        if (existing.rows.length === 0) {
            await client.query(
                'INSERT INTO products (name, image, category, variants) VALUES ($1, $2, $3, $4)',
                [product.name, product.image, product.category, JSON.stringify(product.variants)]
            );
            insertedCount += 1;
            continue;
        }

        const row = existing.rows[0];
        const currentVariants = JSON.stringify(row.variants);
        const nextVariants = JSON.stringify(product.variants);
        const currentImage = typeof row.image === 'string' ? row.image.trim() : '';
        const nextImage = typeof product.image === 'string' ? product.image.trim() : '';

        if (currentVariants !== nextVariants || (!currentImage && nextImage)) {
            await client.query(
                'UPDATE products SET image = $1, variants = $2 WHERE id = $3',
                [nextImage || row.image, nextVariants, row.id]
            );
            updatedCount += 1;
        }
    }

    const dbCountResult = await client.query('SELECT COUNT(*) FROM products');
    const dbCount = Number(dbCountResult.rows[0].count || 0);
    console.log(`✅ Product sync completed (inserted: ${insertedCount}, updated: ${updatedCount}, total in table: ${dbCount}, expected seed size: ${sampleProducts.length})`);
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

module.exports = { initDatabase };