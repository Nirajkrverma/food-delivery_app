const express = require('express');
const cors = require('cors');
const http = require('http');
const path = require('path');
const dns = require('dns');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

// Some networks block DNS resolution for Neon hosts via local resolver.
// Prefer public resolvers for local development.
try {
  dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch (error) {
  console.warn('⚠️ Could not set custom DNS servers:', error.message);
}

// Debug: Check if environment variables are loaded
console.log('🔍 Environment check:');
console.log('- DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('- POSTGRES_URL exists:', !!process.env.POSTGRES_URL);
console.log('- CLERK_PUBLISHABLE_KEY exists:', !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
console.log('- CLERK_PUBLISHABLE_KEY value:', process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? `${process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.substring(0, 20)}...` : 'Not found');

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

function getConnectionStringCandidates() {
  const candidates = [
    sanitizeConnectionString(process.env.DATABASE_URL),
    sanitizeConnectionString(process.env.POSTGRES_URL),
  ].filter(Boolean);

  return candidates.filter((candidate) => {
    try {
      new URL(candidate);
      return true;
    } catch (_) {
      return false;
    }
  });
}

const dbConnectionStringCandidates = getConnectionStringCandidates();

async function createPoolForConnectionString(connectionString) {
  const url = new URL(connectionString);
  const originalHost = url.hostname;

  try {
    await dns.promises.lookup(originalHost);
    return new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10,
      maxUses: 7500,
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

    const fallbackUrl = new URL(connectionString);
    fallbackUrl.hostname = resolvedIps[0];
    fallbackUrl.searchParams.delete('sslmode');
    fallbackUrl.searchParams.delete('channel_binding');

    console.warn(`⚠️ DNS fallback in use for DB host ${originalHost} -> ${resolvedIps[0]}`);

    return new Pool({
      connectionString: fallbackUrl.toString(),
      ssl: {
        rejectUnauthorized: false,
        servername: originalHost,
      },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10,
      maxUses: 7500,
    });
  }
}

async function createDatabasePool() {
  if (!dbConnectionStringCandidates.length) {
    throw new Error('DATABASE_URL/POSTGRES_URL is not configured');
  }

  let lastError = null;
  for (const candidate of dbConnectionStringCandidates) {
    try {
      const pool = await createPoolForConnectionString(candidate);
      await pool.query('SELECT 1');
      return pool;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('Failed to connect using configured database URLs');
}

let poolPromise = createDatabasePool();
const db = {
  async query(text, params) {
    try {
      const pool = await poolPromise;
      return await pool.query(text, params);
    } catch (error) {
      const transientCodes = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT']);
      const code = error && error.code ? String(error.code) : '';
      if (!transientCodes.has(code)) {
        throw error;
      }

      const oldPool = await poolPromise.catch(() => null);
      poolPromise = createDatabasePool();
      const retryPool = await poolPromise;
      const result = await retryPool.query(text, params);
      if (oldPool && typeof oldPool.end === 'function') {
        oldPool.end().catch(() => {});
      }
      return result;
    }
  },
  async connect() {
    const pool = await poolPromise;
    return pool.connect();
  },
};

const DEFAULT_PRODUCT_IMAGE = 'https://placehold.co/200x200/e0e0e0/333?text=No+Image';

const normalizeProductName = (name = '') => String(name).trim().toLowerCase().replace(/\s+/g, ' ');

const isValidImageUrl = (image) => {
  if (typeof image !== 'string') return false;
  const normalized = image.trim().toLowerCase();
  return normalized.length > 0 && normalized !== 'null' && normalized !== 'undefined';
};

const normalizeProducts = (items = []) => {
  const productsByName = new Map();

  items.forEach((item) => {
    if (!item || !item.name || !Array.isArray(item.variants) || item.variants.length === 0) {
      return;
    }

    const key = normalizeProductName(item.name);
    if (!key) return;

    const existing = productsByName.get(key);
    const candidateHasImage = isValidImageUrl(item.image);
    const existingHasImage = existing ? isValidImageUrl(existing.image) : false;

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

// Test database connection on startup
(async () => {
  try {
    const client = await db.connect();
    console.log('✅ Database connected successfully');
    client.release();
  } catch (err) {
    console.error('❌ Database connection failed:', err.message);
  }
})();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Friendly page route aliases
app.get('/payment', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

// Simple mock API endpoints
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    message: 'Food Delivery API is running (Development Mode)',
    timestamp: new Date().toISOString(),
    environment: 'Development'
  });
});

// Config endpoint for client-side environment variables
app.get('/api/config', (req, res) => {
  console.log('🔑 Config endpoint called');
  console.log('- Sending CLERK_PUBLISHABLE_KEY:', process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? `${process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.substring(0, 20)}...` : 'Not found');
  
  res.json({
    CLERK_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || '',
    CLERK_FRONTEND_API: process.env.NEXT_PUBLIC_CLERK_FRONTEND_API || ''
  });
});

app.get('/api/products', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM products ORDER BY id');
    if (result.rows.length > 0) {
      return res.json(normalizeProducts(result.rows));
    }
  } catch (error) {
    console.error('Database error, falling back to sample products:', error.message);
  }

  const fallbackProducts = [
    { id: 1, name: 'Fresh Apples', image: 'https://images.unsplash.com/photo-1579613832125-5d34a13ffe2a?ixlib=rb-4.0.3&q=85&fm=jpg&crop=entropy&cs=srgb&w=400', category: 'Fruits', variants: [{unit: '500 g', price: 75}, {unit: '1 kg', price: 150}] },
    { id: 2, name: 'Bananas', image: 'https://images.unsplash.com/photo-1528825871115-3581a5387919?ixlib=rb-4.0.3&q=85&fm=jpg&crop=entropy&cs=srgb&w=400', category: 'Fruits', variants: [{unit: '6 pcs', price: 30}, {unit: '1 dozen', price: 50}] },
    { id: 3, name: 'Tomatoes', image: 'https://cdn.zeptonow.com/production/tr:w-403,ar-1024-1024,pr-true,f-auto,q-80/cms/product_variant/04a3037a-04a3-47f3-9db4-23ae268177aa.jpeg', category: 'Vegetables', variants: [{unit: '250 g', price: 24}, {unit: '500 g', price: 42}] },
    { id: 4, name: 'Organic Milk', image: 'https://images.unsplash.com/photo-1559598467-f8b76c8155d0?ixlib=rb-4.0.3&q=85&fm=jpg&crop=entropy&cs=srgb&w=400', category: 'Dairy', variants: [{unit: '500 ml', price: 25}, {unit: '1 litre', price: 48}] },
    { id: 5, name: 'Whole Wheat Bread', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/68de0f15-ba46-4a79-95ec-0e2a33ce9dcc.jpeg', category: 'Bakery', variants: [{unit: '1 loaf', price: 45}] },
    { id: 6, name: 'Eggs', image: 'https://cdn.zeptonow.com/production/tr:w-1280,ar-1200-1200,pr-true,f-auto,q-80/cms/product_variant/35241f67-e64e-4f15-8c9e-175186993049.jpeg', category: 'Dairy', variants: [{unit: '6 pack', price: 40}, {unit: '12 pack', price: 70}] }
  ];

  res.json(normalizeProducts(fallbackProducts));
});

// Mock orders storage
let mockOrders = [];
let orderIdCounter = 1;

// Route to get orders for specific user (must be before general /api/orders route)
app.get('/api/orders/user/:userId', async (req, res) => {
  const { userId } = req.params;
  
  try {
    const result = await db.query(
      'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC',
      [userId]
    );
    
    const orders = result.rows;
    
    const formattedOrders = orders.map(order => ({
      id: order.id,
      _id: order.id,
      userId: order.user_id,
      items: order.items,
      total: order.total_amount,
      totalAmount: order.total_amount,
      status: order.status,
      paymentMethod: order.payment_method,
      orderDate: order.created_at,
      createdAt: order.created_at,
      deliveryAddress: order.delivery_address
    }));
    
    res.status(200).json(formattedOrders);
  } catch (error) {
    console.error('Database error:', error.message);
    res.status(500).json({ error: 'Failed to fetch orders', details: error.message });
  }
});

app.get('/api/orders', async (req, res) => {
  const { userId } = req.query;
  
  try {
    let query, params;
    if (userId) {
      query = 'SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC';
      params = [userId];
    } else {
      query = 'SELECT * FROM orders ORDER BY created_at DESC';
      params = [];
    }
    
    const result = await db.query(query, params);
    const orders = result.rows;
    
    const formattedOrders = orders.map(order => ({
      id: order.id,
      _id: order.id,
      userId: order.user_id,
      items: order.items,
      total: order.total_amount,
      totalAmount: order.total_amount,
      status: order.status,
      paymentMethod: order.payment_method,
      orderDate: order.created_at,
      createdAt: order.created_at,
      deliveryAddress: order.delivery_address
    }));
    
    res.status(200).json(formattedOrders);
  } catch (error) {
    console.error('Database error, using fallback storage:', error.message);
    
    // Fallback to in-memory storage
    if (userId) {
      const userOrders = mockOrders.filter(order => order.user_id === userId);
      res.json(userOrders.map(order => ({
        id: order.id,
        userId: order.user_id,
        items: order.items,
        total: order.total_amount,
        status: order.status,
        paymentMethod: order.payment_method,
        orderDate: order.created_at
      })));
    } else {
      res.json(mockOrders);
    }
  }
});

app.post('/api/orders', async (req, res) => {
  const { userId, items, total, totalAmount, paymentMethod = 'COD', paymentId, deliveryAddress } = req.body;
  
  const orderTotal = total || totalAmount;
  
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Items are required and must be a non-empty array' });
  }
  
  if (!orderTotal || isNaN(orderTotal) || orderTotal <= 0) {
    return res.status(400).json({ error: 'Valid total amount is required' });
  }
  
  try {
    // Save to Neon database
    const result = await db.query(
      `INSERT INTO orders (user_id, items, total_amount, payment_method, payment_id, delivery_address) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId || 'guest-user', JSON.stringify(items), parseFloat(orderTotal), paymentMethod, paymentId, JSON.stringify(deliveryAddress)]
    );
    
    const newOrder = result.rows[0];
    
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
        deliveryTime: '12 minutes'
      },
      message: 'Order placed successfully and saved to database'
    });
  } catch (error) {
    console.error('Database error:', error.message);
    
    // Fallback to in-memory storage
    const newOrder = {
      id: orderIdCounter++,
      user_id: userId || 'guest-user',
      items: items,
      total_amount: parseFloat(orderTotal),
      status: 'pending',
      payment_method: paymentMethod,
      payment_id: paymentId,
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
        deliveryTime: '12 minutes'
      },
      message: 'Order placed successfully (fallback storage)'
    });
  }
});

app.post('/api/payment-verify', (req, res) => {
  res.json({
    success: true,
    message: 'Payment verified successfully (Development Mode)',
    paymentId: req.body.razorpay_payment_id
  });
});

// Mock users storage
let mockUsers = {};

function normalizeAddressPayload(payload = {}) {
  const addressLine1 = payload.addressLine1 || payload.line1 || '';
  const addressLine2 = payload.addressLine2 || payload.line2 || '';
  const city = payload.city || '';
  const state = payload.state || '';
  const pincode = payload.pincode || payload.postalCode || '';
  const country = payload.country || 'India';

  const parts = [addressLine1, addressLine2, [city, state].filter(Boolean).join(', ')].filter(Boolean);
  if (country) parts.push(country);

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

app.get('/api/users', async (req, res) => {
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
      return res.json(result.rows);
    } catch (error) {
      console.error('Database error for users list, using fallback storage:', error.message);
      return res.json(Object.values(mockUsers).slice(0, maxLimit));
    }
  }

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const result = await db.query('SELECT * FROM users WHERE user_id = $1', [userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Database error for user lookup, using fallback storage:', error.message);

    const user = mockUsers[userId];
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    return res.json(user);
  }
});

app.post('/api/users', async (req, res) => {
  const { userId, name, email } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }

  try {
    const normalizedAddress = normalizeAddressPayload(req.body);

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

    return res.json(result.rows[0]);
  } catch (error) {
    console.error('Database error for user write, using fallback storage:', error.message);

    const user = {
      id: Date.now(),
      user_id: userId,
      name,
      email,
      ...normalizeAddressPayload(req.body),
      created_at: new Date().toISOString()
    };

    mockUsers[userId] = user;
    return res.json(user);
  }
});

// Payment API endpoint
const paymentStorage = new Map();

app.get('/api/payment', (req, res) => {
  const { transactionId } = req.query;
  
  if (!transactionId) {
    return res.status(400).json({ error: 'Transaction ID is required' });
  }
  
  const payment = paymentStorage.get(transactionId);
  
  if (!payment) {
    return res.status(404).json({ error: 'Transaction not found' });
  }
  
  res.json({ success: true, payment });
});

app.post('/api/payment', async (req, res) => {
  const { 
    orderId, 
    amount, 
    paymentMethod, 
    cardDetails, 
    upiId, 
    walletType, 
    bankCode,
    customerEmail,
    customerPhone 
  } = req.body;
  
  // Validation
  if (!orderId || !amount || !paymentMethod) {
    return res.status(400).json({ 
      success: false, 
      error: 'Order ID, amount, and payment method are required' 
    });
  }
  
  if (amount <= 0) {
    return res.status(400).json({ 
      success: false, 
      error: 'Amount must be greater than 0' 
    });
  }
  
  try {
    let paymentResult;
    
    // Process based on payment method
    switch (paymentMethod) {
      case 'card':
        paymentResult = await processCardPayment(cardDetails, amount);
        break;
      case 'upi':
        paymentResult = await processUPIPayment(upiId, amount);
        break;
      case 'wallet':
        paymentResult = await processWalletPayment(walletType, amount);
        break;
      case 'netbanking':
        paymentResult = await processNetBankingPayment(bankCode, amount);
        break;
      default:
        return res.status(400).json({ 
          success: false, 
          error: 'Invalid payment method' 
        });
    }
    
    if (paymentResult.success) {
      const transactionId = generateTransactionId();
      const paymentRecord = {
        transactionId,
        orderId,
        amount,
        paymentMethod,
        status: 'success',
        timestamp: new Date().toISOString(),
        customerEmail,
        customerPhone
      };
      
      paymentStorage.set(transactionId, paymentRecord);
      
      res.json({
        success: true,
        transactionId,
        orderId,
        amount,
        paymentMethod,
        timestamp: paymentRecord.timestamp,
        message: 'Payment processed successfully'
      });
    } else {
      res.status(400).json({
        success: false,
        error: paymentResult.error || 'Payment processing failed',
        orderId
      });
    }
  } catch (error) {
    console.error('Payment processing error:', error);
    res.status(500).json({
      success: false,
      error: 'Internal server error during payment processing'
    });
  }
});

// Payment processing functions (simulated)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function generateTransactionId() {
  return `TXN${Date.now()}${Math.floor(Math.random() * 10000)}`;
}

function detectCardType(cardNumber) {
  const firstDigit = cardNumber.charAt(0);
  if (firstDigit === '4') return 'Visa';
  if (firstDigit === '5') return 'Mastercard';
  if (firstDigit === '3') return 'American Express';
  if (firstDigit === '6') return 'Discover';
  return 'Unknown';
}

function maskUPIId(upiId) {
  const [username, domain] = upiId.split('@');
  if (username.length <= 4) return upiId;
  return `${username.slice(0, 2)}${'*'.repeat(username.length - 4)}${username.slice(-2)}@${domain}`;
}

function getBankName(bankCode) {
  const banks = {
    'sbi': 'State Bank of India',
    'hdfc': 'HDFC Bank',
    'icici': 'ICICI Bank',
    'axis': 'Axis Bank',
    'kotak': 'Kotak Mahindra Bank',
    'pnb': 'Punjab National Bank',
    'bob': 'Bank of Baroda'
  };
  return banks[bankCode] || bankCode.toUpperCase();
}

async function processCardPayment(cardDetails, amount) {
  if (!cardDetails || !cardDetails.number || !cardDetails.cvv) {
    return { success: false, error: 'Invalid card details' };
  }
  
  // Simulate processing delay
  await sleep(1500);
  
  // 90% success rate simulation
  const success = Math.random() < 0.9;
  
  if (success) {
    return {
      success: true,
      cardType: detectCardType(cardDetails.number),
      last4: cardDetails.number.slice(-4)
    };
  } else {
    return { success: false, error: 'Card declined - Insufficient funds' };
  }
}

async function processUPIPayment(upiId, amount) {
  if (!upiId || !upiId.includes('@')) {
    return { success: false, error: 'Invalid UPI ID' };
  }
  
  // Simulate processing delay
  await sleep(2000);
  
  // 95% success rate simulation
  const success = Math.random() < 0.95;
  
  if (success) {
    return {
      success: true,
      maskedUpiId: maskUPIId(upiId)
    };
  } else {
    return { success: false, error: 'UPI transaction failed' };
  }
}

async function processWalletPayment(walletType, amount) {
  if (!walletType) {
    return { success: false, error: 'Invalid wallet type' };
  }
  
  // Simulate processing delay
  await sleep(1000);
  
  // 95% success rate simulation
  const success = Math.random() < 0.95;
  
  if (success) {
    return {
      success: true,
      wallet: walletType
    };
  } else {
    return { success: false, error: 'Wallet payment failed - Insufficient balance' };
  }
}

async function processNetBankingPayment(bankCode, amount) {
  if (!bankCode) {
    return { success: false, error: 'Invalid bank code' };
  }
  
  // Simulate processing delay
  await sleep(2500);
  
  // 92% success rate simulation
  const success = Math.random() < 0.92;
  
  if (success) {
    return {
      success: true,
      bankName: getBankName(bankCode)
    };
  } else {
    return { success: false, error: 'Net banking transaction failed' };
  }
}

// Serve the main HTML file for root route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function isAppRunningOnPort(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/api/health`, (res) => {
      resolve(res.statusCode === 200);
      res.resume();
    });

    req.setTimeout(800, () => {
      req.destroy();
      resolve(false);
    });

    req.on('error', () => resolve(false));
  });
}

function listenOnPort(port) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);

    server.once('error', (error) => {
      server.close();
      reject(error);
    });

    server.listen(port, () => resolve(server));
  });
}

async function startServer(port) {
  const maxAttempts = 10;

  for (let offset = 0; offset < maxAttempts; offset++) {
    const candidatePort = port + offset;

    const alreadyRunning = await isAppRunningOnPort(candidatePort);
    if (alreadyRunning) {
      console.log(`ℹ️ Server already running at http://localhost:${candidatePort}`);
      console.log(`📱 Reuse this URL: http://localhost:${candidatePort}`);
      return;
    }

    try {
      await listenOnPort(candidatePort);
      console.log(`🚀 Development Server running on http://localhost:${candidatePort}`);
      console.log(`📡 API endpoints available at http://localhost:${candidatePort}/api/`);
      console.log(`🩺 Health check: http://localhost:${candidatePort}/api/health`);
      console.log(`📱 Frontend available at http://localhost:${candidatePort}`);
      return;
    } catch (error) {
      if (error.code === 'EADDRINUSE') {
        console.warn(`⚠️ Port ${candidatePort} is in use. Retrying on ${candidatePort + 1}...`);
        continue;
      }

      console.error('❌ Server failed to start:', error.message);
      process.exit(1);
    }
  }

  console.error(`❌ Could not find a free port in range ${port}-${port + maxAttempts - 1}`);
  process.exit(1);
}

// Start server
startServer(PORT);

module.exports = app;