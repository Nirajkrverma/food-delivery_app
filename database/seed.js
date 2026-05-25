const db = require('../api/_db');

async function seedDatabase() {
    try {
        console.log('🌱 Starting Database Seed...');

        // 1. Insert a Category
        const catRes = await db.query(`
            INSERT INTO categories (name, slug, image_url)
            VALUES ('Fresh Fruits', 'fresh-fruits', 'https://placehold.co/200x200/e0e0e0/333?text=Fruits')
            ON CONFLICT (slug) DO NOTHING RETURNING id;
        `);
        
        let categoryId;
        if (catRes.rows.length > 0) {
            categoryId = catRes.rows[0].id;
        } else {
            const existingCat = await db.query("SELECT id FROM categories WHERE slug = 'fresh-fruits'");
            categoryId = existingCat.rows[0].id;
        }
        console.log(`✅ Category Ready (ID: ${categoryId})`);

        // 2. Insert a Product
        const prodRes = await db.query(`
            INSERT INTO products (category_id, name, brand, image_url)
            VALUES ($1, 'Apples', 'Farm Fresh', 'https://images.unsplash.com/photo-1579613832125-5d34a13ffe2a?ixlib=rb-4.0.3&w=400')
            RETURNING id;
        `, [categoryId]);
        
        const productId = prodRes.rows[0].id;
        console.log(`✅ Product Ready (ID: ${productId})`);

        // 3. Insert Product Variants
        await db.query(`
            INSERT INTO product_variants (product_id, sku, unit_value, unit_measure, price, stock_quantity)
            VALUES 
                ($1, 'APP-500G', 500, 'g', 75.00, 100),
                ($1, 'APP-1KG', 1, 'kg', 150.00, 50)
        `, [productId]);
        console.log(`✅ Product Variants Ready`);

        console.log('🎉 Seeding completed! You can now test the API.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Seeding failed:', error.message);
        process.exit(1);
    }
}

seedDatabase();