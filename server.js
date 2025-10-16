const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(cors());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Too many requests' }
});

app.use('/api/', limiter);

// MongoDB Connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/loanapp', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ MongoDB connected');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error.message);
    process.exit(1);
  }
};

// ==================== SCHEMAS ====================

// User Schema (Loan Providers)
const userSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  name: { type: String, required: true },
  businessName: String,
  phone: String,
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastSync: { type: Date, default: Date.now }
});

userSchema.index({ email: 1 });

const User = mongoose.model('User', userSchema);

// Partial Repayment Sub-Schema
const partialRepaymentSchema = new mongoose.Schema({
  amount: { type: Number, required: true },
  date: { type: Date, required: true },
  daysSinceLoan: { type: Number, required: true }
}, { _id: false });

// Loan Schema
const loanSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  loanId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  date: { type: Date, required: true },
  nepaliDateString: String,
  duration: { type: Number, required: true },
  interestRate: { type: Number, required: true },
  type: { type: String, required: true },
  jewelleryName: { type: String, required: true },
  serialNumber: { type: String, required: true },
  phone: { type: String, required: true },
  address: { type: String, required: true },
  description: String,
  amountGiven: { type: Number, required: true },
  amountReceived: { type: Number, default: 0 },
  partialRepayments: [partialRepaymentSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  isDeleted: { type: Boolean, default: false }
});

loanSchema.index({ userId: 1, serialNumber: 1 });
loanSchema.index({ userId: 1, loanId: 1 });
loanSchema.index({ userId: 1, isDeleted: 1 });

const Loan = mongoose.model('Loan', loanSchema);

// Deposit Transaction Sub-Schema
const depositTransactionSchema = new mongoose.Schema({
  type: { type: String, required: true },
  amount: { type: Number, required: true },
  dateNepali: { type: String, required: true },
  description: String,
  balanceAfter: { type: Number, required: true },
  dateAD: Date
}, { _id: false });

// Deposit Schema
const depositSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  depositId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  address: { type: String, required: true },
  phone: { type: String, required: true },
  interestRate: { type: Number, required: true },
  description: String,
  transactions: [depositTransactionSchema],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  isDeleted: { type: Boolean, default: false }
});

depositSchema.index({ userId: 1, depositId: 1 });
depositSchema.index({ userId: 1, isDeleted: 1 });

const Deposit = mongoose.model('Deposit', depositSchema);

// Sync Log Schema (for tracking sync history)
const syncLogSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  deviceId: String,
  syncType: { type: String, enum: ['full', 'incremental'], default: 'incremental' },
  loansCount: { type: Number, default: 0 },
  depositsCount: { type: Number, default: 0 },
  timestamp: { type: Date, default: Date.now }
});

const SyncLog = mongoose.model('SyncLog', syncLogSchema);

// ==================== MIDDLEWARE ====================

// Auth Middleware
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
      return res.status(401).json({ success: false, message: 'Access token required' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key-change-in-production');
    
    const user = await User.findById(decoded.userId);
    if (!user || !user.isActive) {
      return res.status(403).json({ success: false, message: 'User not found or inactive' });
    }

    req.userId = decoded.userId;
    req.user = user;
    next();
  } catch (error) {
    return res.status(403).json({ success: false, message: 'Invalid token' });
  }
};

// ==================== AUTH ROUTES ====================

// Admin: Create User
app.post('/api/admin/create-user', async (req, res) => {
  try {
    const { email, password, name, businessName, phone, adminKey } = req.body;

    // Simple admin key check (replace with proper admin auth)
    if (adminKey !== process.env.ADMIN_KEY) {
      return res.status(403).json({ success: false, message: 'Invalid admin key' });
    }

    if (!email || !password || !name) {
      return res.status(400).json({ success: false, message: 'Email, password, and name are required' });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ success: false, message: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    const user = new User({
      email,
      password: hashedPassword,
      name,
      businessName,
      phone
    });

    await user.save();

    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: {
        userId: user._id,
        email: user.email,
        name: user.name
      }
    });
  } catch (error) {
    console.error('Error creating user:', error);
    res.status(500).json({ success: false, message: 'Failed to create user' });
  }
});

// Login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Account is inactive' });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ success: false, message: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user._id, email: user.email },
      process.env.JWT_SECRET || 'your-secret-key-change-in-production',
      { expiresIn: '30d' }
    );

    // Update last sync
    user.lastSync = new Date();
    await user.save();

    res.json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        userId: user._id,
        email: user.email,
        name: user.name,
        businessName: user.businessName
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Login failed' });
  }
});

// ==================== LOAN ROUTES ====================

// Sync Loans (Upload from device)
app.post('/api/loans/sync', authenticateToken, async (req, res) => {
  try {
    const { loans, deviceId } = req.body;

    if (!Array.isArray(loans)) {
      return res.status(400).json({ success: false, message: 'Loans must be an array' });
    }

    let created = 0;
    let updated = 0;

    for (const loanData of loans) {
      // Compute amountReceived from partialRepayments (exclude negative top-ups)
      const pr = Array.isArray(loanData.partialRepayments)
        ? loanData.partialRepayments
        : [];
      const computedReceived = pr
        .filter(e => Number(e?.amount || 0) > 0)
        .reduce((s, e) => s + Number(e.amount), 0);
      const existingLoan = await Loan.findOne({
        userId: req.userId,
        loanId: loanData.loanId
      });

      if (existingLoan) {
        // Update existing loan
        Object.assign(existingLoan, {
          ...loanData,
          userId: req.userId,
          amountReceived: computedReceived,
          updatedAt: new Date()
        });
        await existingLoan.save();
        updated++;
      } else {
        // Create new loan
        const newLoan = new Loan({
          ...loanData,
          userId: req.userId,
          amountReceived: computedReceived,
          createdAt: new Date(),
          updatedAt: new Date()
        });
        await newLoan.save();
        created++;
      }
    }

    // Log sync
    await new SyncLog({
      userId: req.userId,
      deviceId,
      syncType: 'incremental',
      loansCount: loans.length,
      depositsCount: 0
    }).save();

    req.user.lastSync = new Date();
    await req.user.save();

    res.json({
      success: true,
      message: 'Loans synced successfully',
      data: { created, updated, total: loans.length }
    });
  } catch (error) {
    console.error('Loan sync error:', error);
    res.status(500).json({ success: false, message: 'Failed to sync loans' });
  }
});

// Get All Loans
app.get('/api/loans', authenticateToken, async (req, res) => {
  try {
    const { lastSync } = req.query;

    let query = { userId: req.userId, isDeleted: false };

    // Incremental sync: only get loans updated after lastSync
    if (lastSync) {
      query.updatedAt = { $gt: new Date(lastSync) };
    }

    const loans = await Loan.find(query).select('-__v').lean();

    // Enrich with derived fields so clients always see correct due/principal
    const enriched = loans.map((loan) => {
      try {
        const asOf = new Date();
        const dailyRate = (loan.interestRate || 0) / 365 / 100;
        let principal = Number(loan.amountGiven || 0);
        let accrued = 0;
        let interestPaid = 0;
        let extraInterestPaid = 0;

        const events = Array.isArray(loan.partialRepayments)
          ? [...loan.partialRepayments]
              .filter(e => e && e.date)
              .sort((a, b) => new Date(a.date) - new Date(b.date))
          : [];

        let lastDate = new Date(loan.date);
        for (const ev of events) {
          const evDate = new Date(ev.date);
          const days = Math.max(0, Math.floor((evDate - lastDate) / (1000 * 60 * 60 * 24)));
          if (days > 0 && principal > 0) {
            accrued += (principal * dailyRate * days);
          }

          let payment = Number(ev.amount || 0);
          if (payment < 0) {
            // top-up increases principal
            principal += (-payment);
            payment = 0;
          } else if (payment > 0) {
            const interestPortion = Math.min(payment, accrued);
            accrued -= interestPortion;
            interestPaid += interestPortion;
            payment -= interestPortion;

            if (payment > 0) {
              const principalPortion = Math.min(payment, principal);
              principal -= principalPortion;
              payment -= principalPortion;
            }

            if (payment > 0) {
              extraInterestPaid += payment;
            }
          }
          lastDate = evDate;
        }

        const tailDays = Math.max(0, Math.floor((asOf - lastDate) / (1000 * 60 * 60 * 24)));
        if (tailDays > 0 && principal > 0) {
          accrued += (principal * dailyRate * tailDays);
        }

        // Enforce 30-day minimum interest for settlement-now view
        const daysSinceStart = Math.max(0, Math.floor((asOf - new Date(loan.date)) / (1000 * 60 * 60 * 24)));
        if (daysSinceStart < 30) {
          const minInterest = (Number(loan.amountGiven || 0) * dailyRate * 30);
          const paidSoFar = interestPaid + extraInterestPaid + accrued;
          if (minInterest > paidSoFar) {
            accrued += (minInterest - paidSoFar);
          }
        }

        const amountReceived = events
          .filter(e => Number(e.amount || 0) > 0)
          .reduce((s, e) => s + Number(e.amount), 0);

        const dueAmount = principal + accrued;

        return {
          ...loan,
          amountReceived,
          remainingPrincipal: principal,
          dueAmount
        };
      } catch (_) {
        return {
          ...loan,
          remainingPrincipal: loan.amountGiven,
          dueAmount: loan.amountGiven
        };
      }
    });

    res.json({
      success: true,
      message: 'Loans retrieved successfully',
      data: {
        loans: enriched,
        count: enriched.length,
        serverTime: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Get loans error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve loans' });
  }
});

// Get All Deposits
app.get('/api/deposits', authenticateToken, async (req, res) => {
  try {
    const { lastSync } = req.query;

    let query = { userId: req.userId, isDeleted: false };

    if (lastSync) {
      query.updatedAt = { $gt: new Date(lastSync) };
    }

    const deposits = await Deposit.find(query).select('-__v').lean();
    const enriched = deposits.map(d => {
      let currentBalance = 0;
      try {
        if (Array.isArray(d.transactions) && d.transactions.length) {
          // Prefer last recorded balanceAfter if available
          const sorted = [...d.transactions].sort((a,b) => new Date(a.dateAD || 0) - new Date(b.dateAD || 0));
          const last = sorted[sorted.length - 1];
          if (typeof last.balanceAfter === 'number') {
            currentBalance = last.balanceAfter;
          } else {
            currentBalance = sorted.reduce((bal, t) => {
              if (t.type === 'Deposit') return bal + Number(t.amount || 0);
              if (t.type === 'Withdrawal') return bal - Number(t.amount || 0);
              return bal;
            }, 0);
          }
        }
      } catch(_) {}
      return { ...d, currentBalance };
    });

    res.json({
      success: true,
      message: 'Deposits retrieved successfully',
      data: {
        deposits: enriched,
        count: enriched.length,
        serverTime: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Get deposits error:', error);
    res.status(500).json({ success: false, message: 'Failed to retrieve deposits' });
  }
});

// ... (rest of the code remains the same)
// ==================== BACKUP ROUTES ====================

// Full Backup (for manual backup or restore)
app.get('/api/backup/full', authenticateToken, async (req, res) => {
  try {
    const loans = await Loan.find({ userId: req.userId, isDeleted: false }).lean();
    const deposits = await Deposit.find({ userId: req.userId, isDeleted: false }).lean();

    res.json({
      success: true,
      message: 'Full backup retrieved',
      data: {
        loans,
        deposits,
        backupDate: new Date().toISOString(),
        loansCount: loans.length,
        depositsCount: deposits.length
      }
    });
  } catch (error) {
    console.error('Backup error:', error);
    res.status(500).json({ success: false, message: 'Failed to create backup' });
  }
});

// Restore from Backup
app.post('/api/backup/restore', authenticateToken, async (req, res) => {
  try {
    const { loans, deposits, clearExisting } = req.body;

    if (clearExisting) {
      await Loan.deleteMany({ userId: req.userId });
      await Deposit.deleteMany({ userId: req.userId });
    }

    let loansRestored = 0;
    let depositsRestored = 0;

    if (loans && Array.isArray(loans)) {
      for (const loanData of loans) {
        await Loan.findOneAndUpdate(
          { userId: req.userId, loanId: loanData.loanId },
          { ...loanData, userId: req.userId },
          { upsert: true, new: true }
        );
        loansRestored++;
      }
    }

    if (deposits && Array.isArray(deposits)) {
      for (const depositData of deposits) {
        await Deposit.findOneAndUpdate(
          { userId: req.userId, depositId: depositData.depositId },
          { ...depositData, userId: req.userId },
          { upsert: true, new: true }
        );
        depositsRestored++;
      }
    }

    res.json({
      success: true,
      message: 'Backup restored successfully',
      data: { loansRestored, depositsRestored }
    });
  } catch (error) {
    console.error('Restore error:', error);
    res.status(500).json({ success: false, message: 'Failed to restore backup' });
  }
});

// ==================== HEALTH & STATS ====================

app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Loan Management API is running',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/stats', authenticateToken, async (req, res) => {
  try {
    const loansCount = await Loan.countDocuments({ userId: req.userId, isDeleted: false });
    const depositsCount = await Deposit.countDocuments({ userId: req.userId, isDeleted: false });
    const lastSyncLogs = await SyncLog.find({ userId: req.userId }).sort({ timestamp: -1 }).limit(5).lean();

    res.json({
      success: true,
      data: {
        loansCount,
        depositsCount,
        lastSync: req.user.lastSync,
        recentSyncs: lastSyncLogs
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to get stats' });
  }
});

// 404 Handler
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: 'Endpoint not found' });
});

// Graceful Shutdown
process.on('SIGINT', async () => {
  console.log('\n🔄 Shutting down gracefully...');
  await mongoose.connection.close();
  console.log('📦 MongoDB connection closed');
  process.exit(0);
});

// Start Server
const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
    await connectDB();
    app.listen(PORT, () => {
      console.log(`🚀 updated Server running on port ${PORT}`);
      console.log(`📍 Health: http://localhost:${PORT}/health`);
      console.log(`🔐 Login: POST http://localhost:${PORT}/api/auth/login`);
      console.log(`📊 Sync Loans: POST http://localhost:${PORT}/api/loans/sync`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();
