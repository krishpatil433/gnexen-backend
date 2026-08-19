// ============================================================
// GNEXEN REWARD - BACKEND
// Supabase + FaucetPay Automatic Payments
// ============================================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================================
// SUPABASE CONFIG
// ============================================================
const supabaseUrl = process.env.SUPABASE_URL || 'https://ogkavpsfbihxbodvzppj.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'sb_publishable_W4JV0K8shyAgOE0BUG6WPw_teElLVsE';
const supabase = createClient(supabaseUrl, supabaseKey);

// Coin System: 1 USD = 10,000 Coins
const USD_TO_COINS = 10000;

app.use(cors());
app.use(express.json());

// ============================================================
// 1. HEALTH CHECK
// ============================================================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        service: 'GNEXEN Backend', 
        timestamp: new Date().toISOString() 
    });
});

// ============================================================
// 2. REGISTER
// ============================================================
app.post('/api/register', async (req, res) => {
    try {
        const { name, email, password, referral } = req.body;
        
        // Check if user already exists
        const { data: existingUser } = await supabase
            .from('users')
            .select('email')
            .eq('email', email)
            .single();

        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'Email already registered'
            });
        }

        // Create user in Supabase Auth
        const { data, error } = await supabase.auth.signUp({
            email: email,
            password: password,
            options: { 
                data: { 
                    name: name,
                    coins: 0
                } 
            }
        });
        
        if (error) throw error;
        
        const user = data.user;
        const refCode = 'GNX' + Math.random().toString(36).substring(2, 8).toUpperCase();
        
        // Save user to database with coins
        await supabase.from('users').insert({
            uid: user.id,
            name: name,
            email: email,
            coins: 0,
            balance: 0,
            total_earned: 0,
            total_withdrawn: 0,
            completed_tasks: 0,
            referral_code: refCode,
            referred_by: referral || null,
            referral_earnings: 0,
            status: 'active',
            created_at: new Date().toISOString()
        });

        // Create transaction for welcome bonus
        await supabase.from('transactions').insert({
            user_id: user.id,
            type: 'welcome_bonus',
            amount: 0,
            coins: 0,
            currency: 'USDT',
            description: 'Welcome to GNEXEN REWARD!',
            status: 'completed',
            created_at: new Date().toISOString()
        });

        res.json({ 
            success: true, 
            user: { 
                id: user.id, 
                name, 
                email, 
                referralCode: refCode,
                coins: 0
            } 
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 3. LOGIN
// ============================================================
app.post('/api/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const { data, error } = await supabase.auth.signInWithPassword({
            email: email,
            password: password
        });
        
        if (error) throw error;
        
        const { data: userProfile } = await supabase
            .from('users')
            .select('*')
            .eq('email', email)
            .single();
            
        if (!userProfile) {
            return res.status(404).json({
                success: false,
                error: 'User profile not found'
            });
        }
        
        res.json({ 
            success: true, 
            user: userProfile, 
            session: data.session 
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 4. GET USER DATA
// ============================================================
app.get('/api/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        
        const { data: user, error } = await supabase
            .from('users')
            .select('*')
            .eq('uid', uid)
            .single();
            
        if (error) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        res.json({ 
            success: true, 
            user: user 
        });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 5. UPDATE USER
// ============================================================
app.put('/api/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { name } = req.body;
        
        const { data, error } = await supabase
            .from('users')
            .update({ name: name })
            .eq('uid', uid)
            .select();
            
        if (error) throw error;
        
        res.json({ 
            success: true, 
            user: data[0] 
        });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 6. CREATE WITHDRAWAL
// ============================================================
app.post('/api/withdraw', async (req, res) => {
    try {
        const { userId, method, account, amount, giftValue } = req.body;
        
        // Check user and coins
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('coins, balance')
            .eq('uid', userId)
            .single();
            
        if (userError || !user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const requiredCoins = Math.round(amount * USD_TO_COINS);
        
        if (user.coins < requiredCoins) {
            return res.status(400).json({
                success: false,
                error: `Insufficient coins! You have ${user.coins}, need ${requiredCoins}`
            });
        }
        
        // Create withdrawal
        const { data: withdrawal, error } = await supabase
            .from('withdrawals')
            .insert({
                user_id: userId,
                method: method,
                account: account,
                amount: amount,
                coins_deducted: requiredCoins,
                gift_value: giftValue || null,
                status: 'pending',
                created_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (error) throw error;
        
        // Deduct coins
        await supabase
            .from('users')
            .update({
                coins: user.coins - requiredCoins,
                total_withdrawn: (user.total_withdrawn || 0) + amount
            })
            .eq('uid', userId);
            
        // Create transaction
        await supabase.from('transactions').insert({
            user_id: userId,
            type: 'withdrawal_request',
            amount: amount,
            coins: requiredCoins,
            currency: method === 'faucetpay' ? 'USDT' : 'INR',
            description: `Withdrawal request via ${method}`,
            status: 'pending',
            reference_id: withdrawal.id,
            created_at: new Date().toISOString()
        });
        
        // If FaucetPay, process automatically
        if (method === 'faucetpay') {
            processFaucetPayment(withdrawal.id, userId, account, amount);
        }
        
        res.json({ 
            success: true, 
            withdrawal: withdrawal 
        });
        
    } catch (error) {
        console.error('Withdrawal error:', error);
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 7. PROCESS FAUCETPAY PAYMENT (AUTOMATIC)
// ============================================================
async function processFaucetPayment(withdrawalId, userId, account, amount) {
    console.log(`💰 Processing FaucetPay payment #${withdrawalId}`);
    
    try {
        // Get FaucetPay settings
        const { data: settings } = await supabase
            .from('settings')
            .select('value')
            .eq('key', 'faucetpay')
            .single();
            
        const config = settings?.value || {};
        
        if (!config.api_key) {
            console.error('❌ FaucetPay API Key not configured');
            await supabase
                .from('withdrawals')
                .update({
                    status: 'failed',
                    error: 'FaucetPay API Key not configured'
                })
                .eq('id', withdrawalId);
            return;
        }
        
        // Update status to processing
        await supabase
            .from('withdrawals')
            .update({
                status: 'processing',
                processed_at: new Date().toISOString()
            })
            .eq('id', withdrawalId);
            
        // Call FaucetPay API
        const response = await axios.post('https://faucetpay.io/api/v1/send', null, {
            params: {
                api_key: config.api_key,
                to: account,
                amount: amount,
                currency: config.currency || 'USDT',
                referrer: config.username || '',
                memo: `GNEXEN Withdrawal #${withdrawalId}`
            },
            timeout: 30000
        });
        
        console.log('📥 FaucetPay Response:', response.data);
        
        if (response.data && response.data.status === 'success') {
            // Payment successful
            await supabase
                .from('withdrawals')
                .update({
                    status: 'paid',
                    transaction_id: response.data.txn_id || 'fp_' + Date.now(),
                    paid_at: new Date().toISOString()
                })
                .eq('id', withdrawalId);
                
            // Update transaction
            await supabase
                .from('transactions')
                .update({
                    status: 'completed',
                    transaction_id: response.data.txn_id || 'fp_' + Date.now()
                })
                .eq('reference_id', withdrawalId);
                
            console.log(`✅ Payment successful #${withdrawalId}`);
            
        } else {
            // Payment failed
            const errorMsg = response.data?.message || 'Unknown error';
            console.error('❌ FaucetPay failed:', errorMsg);
            
            await supabase
                .from('withdrawals')
                .update({
                    status: 'failed',
                    error: errorMsg
                })
                .eq('id', withdrawalId);
                
            // Refund coins to user
            const wDoc = await supabase
                .from('withdrawals')
                .select('coins_deducted, user_id')
                .eq('id', withdrawalId)
                .single();
                
            if (wDoc.data) {
                const { data: user } = await supabase
                    .from('users')
                    .select('coins')
                    .eq('uid', wDoc.data.user_id)
                    .single();
                    
                if (user) {
                    await supabase
                        .from('users')
                        .update({
                            coins: (user.coins || 0) + (wDoc.data.coins_deducted || 0)
                        })
                        .eq('uid', wDoc.data.user_id);
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Payment error:', error);
        
        await supabase
            .from('withdrawals')
            .update({
                status: 'failed',
                error: error.message
            })
            .eq('id', withdrawalId);
            
        // Refund coins
        const wDoc = await supabase
            .from('withdrawals')
            .select('coins_deducted, user_id')
            .eq('id', withdrawalId)
            .single();
            
        if (wDoc.data) {
            const { data: user } = await supabase
                .from('users')
                .select('coins')
                .eq('uid', wDoc.data.user_id)
                .single();
                
            if (user) {
                await supabase
                    .from('users')
                    .update({
                        coins: (user.coins || 0) + (wDoc.data.coins_deducted || 0)
                    })
                    .eq('uid', wDoc.data.user_id);
            }
        }
    }
}

// ============================================================
// 8. GET WITHDRAWALS
// ============================================================
app.get('/api/withdrawals/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        const { data: withdrawals, error } = await supabase
            .from('withdrawals')
            .select('*')
            .eq('user_id', userId)
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({ 
            success: true, 
            withdrawals: withdrawals 
        });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 9. GET SHORTLINKS
// ============================================================
app.get('/api/shortlinks', async (req, res) => {
    try {
        const { data: shortlinks, error } = await supabase
            .from('shortlinks')
            .select('*')
            .eq('status', 'active');
            
        if (error) throw error;
        
        res.json({ 
            success: true, 
            shortlinks: shortlinks 
        });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 10. GET PTC ADS
// ============================================================
app.get('/api/ptc-ads', async (req, res) => {
    try {
        const { data: ptcAds, error } = await supabase
            .from('ptc_ads')
            .select('*')
            .eq('status', 'active');
            
        if (error) throw error;
        
        res.json({ 
            success: true, 
            ptcAds: ptcAds 
        });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 11. GET TASKS
// ============================================================
app.get('/api/tasks', async (req, res) => {
    try {
        const { data: tasks, error } = await supabase
            .from('tasks')
            .select('*')
            .eq('status', 'active');
            
        if (error) throw error;
        
        res.json({ 
            success: true, 
            tasks: tasks 
        });
        
    } catch (error) {
        res.status(400).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================
// 12. COMPLETE TASK (AUTO VERIFY)
// ============================================================
app.post('/api/complete-task', async (req, res) => {
    try {
        const { userId, taskId, reward } = req.body;
        
        console.log('📝 Complete Task Request:', { userId, taskId, reward });
        
        // Validate
        if (!userId) {
            return res.status(400).json({
                success: false,
                error: 'User ID required'
            });
        }
        
        if (!taskId) {
            return res.status(400).json({
                success: false,
                error: 'Task ID required'
            });
        }
        
        // Get user
        const { data: user, error: userError } = await supabase
            .from('users')
            .select('coins, total_earned, completed_tasks')
            .eq('uid', userId)
            .single();
            
        if (userError || !user) {
            console.log('❌ User not found:', userId);
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const coinsToAdd = Math.round(reward * USD_TO_COINS);
        
        // Update user with coins
        const { error: updateError } = await supabase
            .from('users')
            .update({
                coins: (user.coins || 0) + coinsToAdd,
                total_earned: (user.total_earned || 0) + reward,
                completed_tasks: (user.completed_tasks || 0) + 1
            })
            .eq('uid', userId);
            
        if (updateError) {
            console.log('❌ Update error:', updateError);
            return res.status(400).json({
                success: false,
                error: updateError.message
            });
        }
        
        // Create transaction record with coins
        await supabase.from('transactions').insert({
            user_id: userId,
            type: 'task_reward',
            amount: reward,
            coins: coinsToAdd,
            currency: 'USDT',
            description: `Task completed: ${taskId}`,
            status: 'completed',
            reference_id: taskId,
            created_at: new Date().toISOString()
        });
        
        // Get updated user data
        const { data: updatedUser } = await supabase
            .from('users')
            .select('*')
            .eq('uid', userId)
            .single();
        
        console.log(`✅ Task completed! User ${userId} earned ${coinsToAdd} coins`);
        
        res.json({
            success: true,
            message: 'Task completed!',
            coins: coinsToAdd,
            newBalance: updatedUser?.coins || 0
        });
        
    } catch (error) {
        console.error('❌ Complete task error:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 13. GET USER TASKS FOR TODAY (Daily Limit Check)
// ============================================================
app.get('/api/user-tasks/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { date, taskId } = req.query;
        
        if (!userId || !taskId) {
            return res.status(400).json({
                success: false,
                error: 'User ID and Task ID required'
            });
        }
        
        const startDate = new Date(date);
        startDate.setHours(0, 0, 0, 0);
        const endDate = new Date(date);
        endDate.setHours(23, 59, 59, 999);
        
        console.log(`📊 Checking daily limit for user ${userId}, task ${taskId}`);
        console.log(`📅 Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
        
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('reference_id', taskId)
            .eq('type', 'task_reward')
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());
            
        if (error) {
            console.error('❌ Daily limit check error:', error);
            return res.status(400).json({
                success: false,
                error: error.message
            });
        }
        
        const count = data ? data.length : 0;
        console.log(`📊 User ${userId} completed task ${taskId} ${count} times today`);
        
        res.json({
            success: true,
            count: count
        });
        
    } catch (error) {
        console.error('❌ Daily limit check error:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 14. ADMIN - GET ALL USERS
// ============================================================
app.get('/api/admin/users', async (req, res) => {
    try {
        const { data: users, error } = await supabase
            .from('users')
            .select('*')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({
            success: true,
            users: users
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 15. ADMIN - UPDATE USER STATUS
// ============================================================
app.put('/api/admin/user/:uid', async (req, res) => {
    try {
        const { uid } = req.params;
        const { status } = req.body;
        
        const { data, error } = await supabase
            .from('users')
            .update({ status: status })
            .eq('uid', uid)
            .select();
            
        if (error) throw error;
        
        res.json({
            success: true,
            user: data[0]
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 16. ADMIN - GET ALL WITHDRAWALS
// ============================================================
app.get('/api/admin/withdrawals', async (req, res) => {
    try {
        const { data: withdrawals, error } = await supabase
            .from('withdrawals')
            .select('*, users(name, email)')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        
        res.json({
            success: true,
            withdrawals: withdrawals
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 17. ADMIN - UPDATE WITHDRAWAL STATUS
// ============================================================
app.put('/api/admin/withdrawal/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, giftCardCode } = req.body;
        
        const updateData = {
            status: status,
            processed_at: new Date().toISOString()
        };
        
        if (giftCardCode) {
            updateData.gift_card_code = giftCardCode;
        }
        
        if (status === 'paid') {
            updateData.paid_at = new Date().toISOString();
        }
        
        const { data, error } = await supabase
            .from('withdrawals')
            .update(updateData)
            .eq('id', id)
            .select();
            
        if (error) throw error;
        
        // If rejected, refund coins
        if (status === 'rejected') {
            const wDoc = await supabase
                .from('withdrawals')
                .select('coins_deducted, user_id')
                .eq('id', id)
                .single();
                
            if (wDoc.data && wDoc.data.coins_deducted) {
                const { data: user } = await supabase
                    .from('users')
                    .select('coins')
                    .eq('uid', wDoc.data.user_id)
                    .single();
                    
                if (user) {
                    await supabase
                        .from('users')
                        .update({
                            coins: (user.coins || 0) + (wDoc.data.coins_deducted || 0)
                        })
                        .eq('uid', wDoc.data.user_id);
                }
            }
        }
        
        res.json({
            success: true,
            withdrawal: data[0]
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 18. START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 GNEXEN REWARD Backend`);
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🔑 Supabase connected: ${supabaseUrl}`);
    console.log(`🪙 Coin System: 1 USD = ${USD_TO_COINS} Coins`);
    console.log(`💰 1,000 Coins = ₹10`);
    console.log(`⚡ FaucetPay: AUTO`);
    console.log(`✅ Server ready!`);
});

// ============================================================
// ERROR HANDLING
// ============================================================
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection:', reason);
});
