const db = require('./_db');

// Fallback in-memory storage for when database is not available
let mockUsers = {};

function normalizeAddressPayload(payload = {}) {
    const addressLine1 = payload.addressLine1 || payload.line1 || '';
    const addressLine2 = payload.addressLine2 || payload.line2 || '';
    const city = payload.city || '';
    const state = payload.state || '';
    const pincode = payload.pincode || payload.postalCode || '';
    const country = payload.country || 'India';

    const parts = [addressLine1, addressLine2, [city, state].filter(Boolean).join(', '), country].filter(Boolean);
    const fallbackFromString = typeof payload.address === 'string' ? payload.address : '';
    const address = parts.length > 0 ? parts.join('<br>') : fallbackFromString;

    return {
        address,
        addressLine1,
        addressLine2,
        city,
        state,
        pincode,
        country
    };
}

export default async function handler(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method === 'GET') {
            await handleGetUser(req, res);
        } else if (req.method === 'POST') {
            await handleCreateOrUpdateUser(req, res);
        } else if (req.method === 'DELETE') {
            await handleDeleteUser(req, res);
        } else {
            res.status(405).json({ error: 'Method not allowed' });
        }
    } catch (error) {
        console.error('Error handling users:', error.message);
        res.status(500).json({ error: 'Internal server error' });
    }
}

const handleGetUser = async (req, res) => {
    const { userId, list, limit } = req.query;

    const shouldListUsers = String(list || '').toLowerCase() === '1' || String(list || '').toLowerCase() === 'true';

    if (shouldListUsers) {
        const maxLimit = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);

        try {
            const result = await db.query(
                `SELECT user_id, name, email, address, address_line1, address_line2, city, state, pincode, country, created_at
                 FROM users
                 ORDER BY created_at DESC
                 LIMIT $1`,
                [maxLimit]
            );

            return res.status(200).json(result.rows);
        } catch (error) {
            console.error('Database error while listing users, using fallback storage:', error.message);
            const fallbackUsers = Object.values(mockUsers).slice(0, maxLimit);
            return res.status(200).json(fallbackUsers);
        }
    }

    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    
    try {
        // Try database first
        const result = await db.query('SELECT * FROM users WHERE user_id = $1', [userId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Database error, using fallback storage:', error.message);
        
        // Fallback to in-memory storage
        const user = mockUsers[userId];
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        res.status(200).json(user);
    }
};

const handleCreateOrUpdateUser = async (req, res) => {
    const { userId, name, email } = req.body;
    
    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }
    
    try {
        const normalizedAddress = normalizeAddressPayload(req.body);

        // Try database first
        const result = await db.query(
            `INSERT INTO users (user_id, name, email, address, address_line1, address_line2, city, state, pincode, country) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) 
             ON CONFLICT (user_id) 
             DO UPDATE SET name = $2, email = $3, address = $4, address_line1 = $5, address_line2 = $6, city = $7, state = $8, pincode = $9, country = $10 
             RETURNING *`,
            [
                userId,
                name,
                email,
                normalizedAddress.address,
                normalizedAddress.addressLine1,
                normalizedAddress.addressLine2,
                normalizedAddress.city,
                normalizedAddress.state,
                normalizedAddress.pincode,
                normalizedAddress.country
            ]
        );
        
        res.status(200).json(result.rows[0]);
    } catch (error) {
        console.error('Database error, using fallback storage:', error.message);
        
        // Fallback to in-memory storage
        const user = {
            id: Date.now(),
            user_id: userId,
            name,
            email,
            ...normalizeAddressPayload(req.body),
            created_at: new Date().toISOString()
        };
        
        mockUsers[userId] = user;
        res.status(200).json(user);
    }
};

const handleDeleteUser = async (req, res) => {
    const { userId } = req.body;

    if (!userId) {
        return res.status(400).json({ error: 'User ID is required' });
    }

    try {
        // Try database first
        await db.query('DELETE FROM users WHERE user_id = $1', [userId]);
        return res.status(200).json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
        console.error('Database error during deletion, using fallback storage:', error.message);
        
        // Fallback to in-memory storage
        if (mockUsers[userId]) {
            delete mockUsers[userId];
            return res.status(200).json({ success: true, message: 'User deleted successfully' });
        }
        
        return res.status(404).json({ error: 'User not found' });
    }
};