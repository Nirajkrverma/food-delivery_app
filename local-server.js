const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config({ path: '.env.local' });

// Debug: Check if environment variables are loaded
console.log('🔍 Environment check:');
console.log('- DATABASE_URL exists:', !!process.env.DATABASE_URL);
console.log('- POSTGRES_URL exists:', !!process.env.POSTGRES_URL);
console.log('- CLERK_PUBLISHABLE_KEY exists:', !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
console.log('- CLERK_PUBLISHABLE_KEY value:', process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? `${process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY.substring(0, 20)}...` : 'Not found');

// Database connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL || process.env.POSTGRES_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

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
pool.connect((err, client, release) => {
    if (err) {
        console.error('❌ Database connection failed:', err.message);
    } else {
        console.log('✅ Database connected successfully');
        release();
    }
});

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
    const result = await pool.query('SELECT * FROM products ORDER BY id');
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
    const result = await pool.query(
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
    
    const result = await pool.query(query, params);
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
    const result = await pool.query(
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

app.get('/api/users', (req, res) => {
  const { userId } = req.query;
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  
  const user = mockUsers[userId];
  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }
  
  res.json(user);
});

app.post('/api/users', (req, res) => {
  const { userId, name, email, address } = req.body;
  
  if (!userId) {
    return res.status(400).json({ error: 'User ID is required' });
  }
  
  const user = {
    id: Date.now(),
    user_id: userId,
    name,
    email,
    address,
    created_at: new Date().toISOString()
  };
  
  mockUsers[userId] = user;
  res.json(user);
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

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Development Server running on http://localhost:${PORT}`);
  console.log(`📡 API endpoints available at http://localhost:${PORT}/api/`);
  console.log(`🩺 Health check: http://localhost:${PORT}/api/health`);
  console.log(`📱 Frontend available at http://localhost:${PORT}`);
});

module.exports = app;