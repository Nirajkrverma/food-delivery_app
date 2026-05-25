const db = require('../api/_db');

async function resetAndInit() {
    try {
        console.log('⚠️ Dropping all tables...');
        await db.query(`
            DROP TABLE IF EXISTS order_items CASCADE;
            DROP TABLE IF EXISTS orders CASCADE;
            DROP TABLE IF EXISTS user_addresses CASCADE;
            DROP TABLE IF EXISTS product_variants CASCADE;
            DROP TABLE IF EXISTS products CASCADE;
            DROP TABLE IF EXISTS categories CASCADE;
            DROP TABLE IF EXISTS users CASCADE;
        `);
        console.log('✅ Tables dropped');
        
        // Re-run the initialization script logic
        require('./init');
    } catch (e) {
        console.log(e);
        process.exit(1);
    }
}

resetAndInit();