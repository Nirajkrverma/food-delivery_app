# Grocery Mart - Food Delivery App

A modern, responsive grocery delivery application built with vanilla JavaScript, Tailwind CSS, Clerk Authentication, and Vercel serverless functions.

## ✨ Features

- **🎨 Modern UI**: Clean, responsive design with dark/light theme support
- **🔐 Authentication**: Secure user authentication via Clerk
- **🛒 Real-time Cart**: Add/remove items with instant updates
- **💳 Fast Checkout**: Streamlined order process
- **📦 Order Tracking**: View order history and status
- **👤 User Profiles**: Complete profile management with favorites and loyalty points
- **📱 Mobile Responsive**: Works perfectly on all devices
- **⚡ Serverless Backend**: Scalable API with PostgreSQL database

## � Quick Start

### Prerequisites
- Node.js (v14 or higher)
- A Clerk account (free at [clerk.com](https://clerk.com))

### Setup in 5 Minutes

1. **Clone and install**:
   ```bash
   git clone <your-repo-url>
   cd grocery-mart-delivery
   npm install
   ```

2. **Set up Clerk** (see [QUICK_START_CLERK.md](./QUICK_START_CLERK.md)):
   - Create Clerk account at https://clerk.com
   - Get your API keys from dashboard
   - Create `.env.local` file with your keys

3. **Start development server**:
   ```bash
   node local-server.js
   ```

4. **Open in browser**:
   ```
   http://localhost:3000
   ```

## 📚 Documentation

### Getting Started
- **[Quick Start - Clerk Setup](./QUICK_START_CLERK.md)** ⚡ - 5-minute guide to get authentication working
- **[Complete Clerk Setup](./CLERK_SETUP.md)** 📖 - Detailed setup guide with troubleshooting
- **[Theme Customization](./CLERK_THEME_GUIDE.md)** 🎨 - Match Clerk UI to your app's theme
- **[Integration Overview](./CLERK_INTEGRATION.md)** 📋 - Summary of what's built and how it works

## 📁 Project Structure

```
grocery-mart-delivery/
├── public/                        # Frontend files
│   ├── index.html                 # Main app with products & cart
│   ├── login.html                 # Login flow
│   ├── profile.html               # User profile page
│   └── payment.html               # Checkout payment page
├── api/                           # Serverless API functions
│   ├── config.js                  # Clerk configuration endpoint
│   ├── products.js                # Product management
│   ├── orders.js                  # Order management
│   ├── users.js                   # User management
│   ├── payment-verify.js          # Payment verification
│   └── health.js                  # Health check
├── database/                      # Database initialization
│   └── init.js                    # PostgreSQL setup
├── Documentation/                 # Setup guides
│   ├── QUICK_START_CLERK.md       # ⚡ 5-min Clerk setup
│   ├── CLERK_SETUP.md             # 📖 Complete guide
│   ├── CLERK_THEME_GUIDE.md       # 🎨 Theme customization
│   └── CLERK_INTEGRATION.md       # 📋 Technical overview
├── .env.example                   # Environment variables template
├── .gitignore                     # Git ignore file
├── local-server.js                # Local development server
├── package.json                   # Dependencies
├── vercel.json                    # Vercel config
└── README.md                      # This file
```

## 🔧 Local Development

### Option 1: Using Node Server (Recommended)
```bash
node local-server.js
# Opens at http://localhost:3000
```

### Option 2: Using Vercel CLI
```bash
vercel dev
# Opens at http://localhost:3000
```

### Option 3: Simple HTTP Server (Frontend only)
```bash
python -m http.server 8000 --directory public
# Opens at http://localhost:8000
```

## 📊 API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/health` | GET | Health check |
| `/api/products` | GET | Get all products |
| `/api/orders` | GET | Get all orders |
| `/api/orders` | POST | Create new order |
| `/api/orders?userId=X` | GET | Get orders by user |
| `/api/orders?id=X` | PUT | Update order status |
| `/api/users` | POST | Create/update user |
| `/api/users?userId=X` | GET | Get user profile |
| `/api/payment-verify` | POST | Verify payment |

## 🎨 Customization

### Theme Colors
Edit CSS variables in the HTML files to change the color scheme:

```css
:root {
    --accent-color-1: #84cc16; /* Primary green */
    --accent-color-2: #a3e635; /* Secondary green */
    --bg-light: #f7fee7;       /* Light background */
    --text-light: #1a2e05;     /* Dark text */
}
```

### Add New Products
Modify the products array in the API or frontend files to add new items.

### Database Schema
The application automatically creates the following tables:
- `products`: Product catalog
- `orders`: Order records
- `users`: User profiles

## 🔒 Security Notes

- All API endpoints include CORS configuration
- Database connections use SSL by default
- User input is sanitized for SQL injection prevention
- Environment variables are used for sensitive data

## 🐛 Troubleshooting

### Common Issues

1. **Database Connection Errors**:
   - Verify your `DATABASE_URL` is correct
   - Ensure your database allows external connections
   - Check if SSL is required

2. **API Not Working**:
   - Check Vercel function logs in the dashboard
   - Verify environment variables are set
   - Ensure API routes match the frontend calls

3. **Frontend Not Loading**:
   - Check browser console for errors
   - Verify all file paths are correct
   - Ensure Tailwind CSS is loading from CDN

### Debug Mode

Add `console.log` statements in your API functions and check the Vercel function logs in your dashboard.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📝 License

This project is licensed under the MIT License.

## 🆘 Support

If you encounter any issues during deployment:

1. Check Vercel's [deployment documentation](https://vercel.com/docs)
2. Review the [troubleshooting guide](https://vercel.com/docs/troubleshooting)
3. Check your database provider's documentation
4. Open an issue in this repository

---

**Happy Coding! 🚀**
