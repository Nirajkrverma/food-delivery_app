#!/usr/bin/env node

// Auto-generate Product IDs for existing website products
// Reads from index.html and generates unique IDs with QR codes

const fs = require('fs');
const path = require('path');
const { generateProductQRCode, generatePrintableLabel } = require('../utils/qr-code-generator');

console.log('\n╔════════════════════════════════════════════════════════╗');
console.log('║   Auto Product ID Generator for Website Products      ║');
console.log('╚════════════════════════════════════════════════════════╝\n');

// Sample products from the website (you can expand this list)
const websiteProducts = [
    // Fruits
    { id: 1, name: 'Fresh Apples', category: 'Fruits', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1024-1024,pr-true,f-auto,q-80/cms/product_variant/8758d987-e101-46d3-9c9b-f2babc5d6389.jpeg' },
    { id: 2, name: 'Bananas', category: 'Fruits', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/2ce10ffc-348b-4f20-a0c4-6f004c162c90.jpeg' },
    { id: 13, name: 'Mangoes', category: 'Fruits', image: 'https://www.bbassets.com/media/uploads/p/m/10000343_9-fresho-mango-neelam.jpg?tr=w-154,q-80' },
    { id: 14, name: 'Pineapple', category: 'Fruits', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1024-1536,pr-true,f-auto,q-80/cms/product_variant/088cb923-8d1a-431f-98ea-2f01259b3545.png' },
    { id: 15, name: 'Papaya', category: 'Fruits', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/14beced9-a7d1-4a3f-b9bb-ab0a150876f6.jpeg' },
    
    // Vegetables
    { id: 24, name: 'Tomatoes', category: 'Vegetables', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1024-1024,pr-true,f-auto,q-80/cms/product_variant/04a3037a-04a3-47f3-9db4-23ae268177aa.jpeg' },
    { id: 25, name: 'Onion (Pyaz)', category: 'Vegetables', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/49dcc487-39ac-45a3-8ed6-654ff0afa825.jpeg' },
    { id: 26, name: 'Green Chilli (Hari Mirch)', category: 'Vegetables', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-500-500,pr-true,f-auto,q-80/inventory/product/dfae6a29-0a76-410c-8e70-c4dad230fe03-4a396220-0f35-438b-a3fd-b3a0fc9364f9.jpeg' },
    { id: 27, name: 'Ginger (Adrak)', category: 'Vegetables', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-3000-3000,pr-true,f-auto,q-80/cms/product_variant/5e0e4e72-7b21-4d85-a825-0ad8e665ccf4.jpeg' },
    { id: 28, name: 'Garlic (Lahsun)', category: 'Vegetables', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1024-1024,pr-true,f-auto,q-80/cms/product_variant/8d450361-f0d4-4118-a0c5-13552116ee58.jpeg' },
    
    // Dairy
    { id: 51, name: 'Organic Milk', category: 'Dairy', image: 'https://images.unsplash.com/photo-1559598467-f8b76c8155d0?ixlib=rb-4.0.3&q=85&fm=jpg&crop=entropy&cs=srgb&w=400' },
    { id: 52, name: 'Eggs', category: 'Dairy', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/35241f67-e64e-4f15-8c9e-175186993049.jpeg' },
    { id: 53, name: 'Cheddar Cheese', category: 'Dairy', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1000-1000,pr-true,f-auto,q-80/cms/product_variant/19b40e18-47b0-40bb-806c-f8e9319f6f16.jpeg' },
    
    // Bakery
    { id: 56, name: 'Whole Wheat Bread', category: 'Bakery', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/68de0f15-ba46-4a79-95ec-0e2a33ce9dcc.jpeg' },
];

// Generate product code
function generateProductCode(name, id) {
    const prefix = name.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 10);
    const timestamp = Date.now().toString(36).toUpperCase();
    const productNum = id.toString().padStart(4, '0');
    return `${prefix}_${productNum}_${timestamp.substring(0, 6)}`;
}

async function main() {
    const outputDir = path.join(__dirname, '../qr-codes/website-products');
    
    // Create output directory
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }

    console.log('📦 Processing', websiteProducts.length, 'website products...\n');

    const results = [];

    for (const product of websiteProducts) {
        try {
            // Generate unique product ID
            const uniqueId = generateProductCode(product.name, product.id);
            const trackingUrl = `http://localhost:3000/public/profile.html?track=${uniqueId}`;

            console.log(`\n📝 Processing: ${product.name}`);
            console.log(`   ID: ${uniqueId}`);

            // Generate QR code
            const qrDataUrl = await generateProductQRCode(uniqueId);
            
            // Save QR code as PNG
            const qrPath = path.join(outputDir, `${uniqueId}.png`);
            const base64Data = qrDataUrl.replace(/^data:image\/png;base64,/, '');
            fs.writeFileSync(qrPath, base64Data, 'base64');
            console.log(`   ✅ QR Code: ${qrPath}`);

            // Generate printable label
            const label = await generatePrintableLabel({
                productId: uniqueId,
                name: product.name,
                category: product.category,
                origin: 'Food Delivery App'
            });
            
            const labelPath = path.join(outputDir, `${uniqueId}_label.html`);
            fs.writeFileSync(labelPath, label);
            console.log(`   ✅ Label: ${labelPath}`);

            // Save product data
            const productData = {
                originalId: product.id,
                uniqueId: uniqueId,
                name: product.name,
                category: product.category,
                image: product.image,
                trackingUrl: trackingUrl,
                qrCodePath: qrPath,
                labelPath: labelPath,
                generatedAt: new Date().toISOString()
            };

            results.push(productData);

        } catch (error) {
            console.log(`   ❌ Error: ${error.message}`);
        }
    }

    // Save master catalog
    const catalogPath = path.join(outputDir, 'product_catalog.json');
    fs.writeFileSync(catalogPath, JSON.stringify({
        generated: new Date().toISOString(),
        totalProducts: results.length,
        products: results
    }, null, 2));

    // Save CSV
    const csvPath = path.join(outputDir, 'product_catalog.csv');
    const csvHeaders = 'Original ID,Unique ID,Name,Category,Tracking URL,QR Code Path,Label Path\n';
    const csvRows = results.map(p => 
        `${p.originalId},"${p.uniqueId}","${p.name}",${p.category},${p.trackingUrl},${p.qrCodePath},${p.labelPath}`
    ).join('\n');
    fs.writeFileSync(csvPath, csvHeaders + csvRows);

    console.log('\n╔════════════════════════════════════════════════════════╗');
    console.log('║   Generation Complete!                                 ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    console.log('📊 Summary:');
    console.log(`   Total Products: ${results.length}`);
    console.log(`   QR Codes Generated: ${results.length}`);
    console.log(`   Labels Generated: ${results.length}`);
    console.log(`\n📁 Output Directory: ${outputDir}`);
    console.log(`\n📋 Files Created:`);
    console.log(`   - ${results.length} QR code images (.png)`);
    console.log(`   - ${results.length} Printable labels (.html)`);
    console.log(`   - 1 Product catalog (JSON)`);
    console.log(`   - 1 Product catalog (CSV)`);

    console.log('\n🎯 Next Steps:');
    console.log('   1. Open qr-manager.html in browser:');
    console.log('      http://localhost:3000/public/qr-manager.html');
    console.log('   2. Search and filter products');
    console.log('   3. Generate more QR codes as needed');
    console.log('   4. Print labels for products\n');
}

main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
