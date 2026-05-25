const db = require('./_db');

// Fallback in-memory storage for when database is not available
let mockOrders = [];
let orderIdCounter = 1;

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method === 'GET') {
            await handleGetOrders(req, res);
        } else if (req.method === 'POST') {
            await handleCreateOrder(req, res);
        } else if (req.method === 'PUT') {
            await handleUpdateOrder(req, res);
        } else {
            res.status(405).json({ error: 'Method not allowed' });
        }
    } catch (error) {
        console.error('Error handling orders:', error.message);
        res.status(500).json({ error: 'Internal server error', details: error.message });
    }
}

const handleGetOrders = async (req, res) => {
    const { userId } = req.query;
    
    try {
        // Try database first
        let query, params;
        if (userId) {
            query = `
                SELECT o.*, 
                    COALESCE(json_agg(
                        json_build_object(
                            'unit', pv.unit_value || ' ' || pv.unit_measure,
                            'price', oi.unit_price,
                            'quantity', oi.quantity,
                            'name', p.name
                        )
                    ) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
                FROM orders o
                LEFT JOIN order_items oi ON o.id = oi.order_id
                LEFT JOIN product_variants pv ON oi.product_variant_id = pv.id
                LEFT JOIN products p ON pv.product_id = p.id
                WHERE o.user_id = $1
                GROUP BY o.id
                ORDER BY o.created_at DESC
            `;
            params = [userId];
        } else {
            query = `
                SELECT o.*, 
                    COALESCE(json_agg(
                        json_build_object(
                            'unit', pv.unit_value || ' ' || pv.unit_measure,
                            'price', oi.unit_price,
                            'quantity', oi.quantity,
                            'name', p.name
                        )
                    ) FILTER (WHERE oi.id IS NOT NULL), '[]') as items
                FROM orders o
                LEFT JOIN order_items oi ON o.id = oi.order_id
                LEFT JOIN product_variants pv ON oi.product_variant_id = pv.id
                LEFT JOIN products p ON pv.product_id = p.id
                GROUP BY o.id
                ORDER BY o.created_at DESC
            `;
            params = [];
        }
        
        const result = await db.query(query, params);
        const orders = result.rows.map(order => ({
            id: order.id,
            userId: order.user_id,
            items: order.items,
            total: order.total_amount,
            status: order.status,
            paymentMethod: order.payment_method,
            orderDate: order.created_at
        }));
        
        res.status(200).json(orders);
    } catch (error) {
        console.error('Database error, using fallback storage:', error.message);
        
        // Fallback to in-memory storage
        if (userId) {
            const userOrders = mockOrders.filter(order => order.user_id === userId);
            const formattedOrders = userOrders.map(order => ({
                id: order.id,
                userId: order.user_id,
                items: order.items,
                total: order.total_amount,
                status: order.status,
                paymentMethod: order.payment_method,
                orderDate: order.created_at
            }));
            res.status(200).json(formattedOrders);
        } else {
            res.status(200).json(mockOrders);
        }
    }
};

const handleCreateOrder = async (req, res) => {
    const { userId, items, total, totalAmount, paymentMethod = 'COD', paymentId, deliveryAddress, estimatedDeliveryMinutes } = req.body;
    
    // Handle both 'total' and 'totalAmount' field names for compatibility
    const orderTotal = total || totalAmount;
    const parsedEtaMinutes = Number.parseInt(estimatedDeliveryMinutes, 10);
    const normalizedEtaMinutes = Number.isFinite(parsedEtaMinutes) && parsedEtaMinutes > 0
        ? Math.max(5, Math.min(parsedEtaMinutes, 180))
        : 12;
    
    // Validate required fields
    if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ error: 'Items are required and must be a non-empty array' });
    }
    
    if (!orderTotal || isNaN(orderTotal) || orderTotal <= 0) {
        return res.status(400).json({ error: 'Valid total amount is required' });
    }
    
    try {
        const client = await db.query('BEGIN'); // Start transaction if possible, or just ignore for simple wrapper
        
        const parsedAddress = typeof deliveryAddress === 'string' ? deliveryAddress : JSON.stringify(deliveryAddress);

        // Insert Order
        const orderResult = await db.query(
            `INSERT INTO orders (user_id, total_amount, payment_method, payment_id, delivery_address) 
             VALUES ($1, $2, $3, $4, $5) RETURNING *`,
            [userId || 'guest-user', parseFloat(orderTotal), paymentMethod, paymentId, parsedAddress]
        );
        
        const newOrder = orderResult.rows[0];

        // Insert Order Items
        for (const item of items) {
             const quantity = item.quantity || 1;
             const price = parseFloat(item.price) || 0;
             // Here we use a fake product_variant_id temporarily if real ones aren't mapped
             await db.query(`
                INSERT INTO order_items (order_id, quantity, unit_price, total_price)
                VALUES ($1, $2, $3, $4)
             `, [newOrder.id, quantity, price, quantity * price]);
        }
        
        // Return full structure for UI
        res.status(201).json({
            success: true,
            _id: newOrder.id,
            order: {
                id: newOrder.id,
                userId: newOrder.user_id,
                items: items, // mirror frontend items array
                total: newOrder.total_amount,
                status: newOrder.status,
                paymentMethod: newOrder.payment_method,
                orderDate: newOrder.created_at,
                deliveryTime: `${normalizedEtaMinutes} minutes`
            },
            message: 'Order placed successfully'
        });
    } catch (error) {
        console.error('Database error, using fallback storage:', error.message);
        
        // Fallback to in-memory storage
        const newOrder = {
            id: orderIdCounter++,
            user_id: userId || 'guest-user',
            items: items,
            total_amount: parseFloat(orderTotal),
            status: 'pending',
            payment_method: paymentMethod,
            payment_id: paymentId,
            delivery_address: deliveryAddress,
            created_at: new Date().toISOString()
        };
        
        mockOrders.push(newOrder);
        
        res.status(201).json({
            success: true,
            _id: newOrder.id,
            order: {
                id: newOrder.id,
                userId: newOrder.user_id,
                items: newOrder.items,
                total: newOrder.total_amount,
                status: newOrder.status,
                paymentMethod: newOrder.payment_method,
                orderDate: newOrder.created_at,
                deliveryTime: `${normalizedEtaMinutes} minutes`
            },
            message: 'Order placed successfully'
        });
    }
};

const handleUpdateOrder = async (req, res) => {
    const { id } = req.query;
    const { status } = req.body;
    
    if (!id) {
        return res.status(400).json({ error: 'Order ID is required' });
    }
    
    try {
        // Try database first
        const result = await db.query(
            'UPDATE orders SET status = $1 WHERE id = $2 RETURNING *',
            [status, id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Database error, using fallback storage:', error.message);
        
        // Fallback to in-memory storage
        const orderIndex = mockOrders.findIndex(order => order.id == id);
        if (orderIndex === -1) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        mockOrders[orderIndex].status = status;
        res.status(200).json(mockOrders[orderIndex]);
    }
};