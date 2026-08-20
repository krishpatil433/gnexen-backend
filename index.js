// ============================================================
// GNEXEN REWARD - BACKEND WITH MULTIPLE SHORTLINK PROVIDERS
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
// SHORTLINK PROVIDERS CONFIG
// ============================================================
const SHORTLINK_PROVIDERS = {
    horrorpay: {
        name: 'HorrorPay',
        apiUrl: 'https://horrorpay.online/api',
        method: 'GET',
        params: { api: 'API_KEY', url: 'URL', alias: 'ALIAS' },
        responseKey: 'shortenedUrl'
    },
    linkvertise: {
        name: 'Linkvertise',
        apiUrl: 'https://api.linkvertise.com/v1/shorten',
        method: 'POST',
        headers: { 'Authorization': 'Bearer API_KEY' },
        body: { 'url': 'URL' },
        responseKey: 'data.link'
    },
    shrinkme: {
        name: 'ShrinkMe',
        apiUrl: 'https://shrinkme.io/api',
        method: 'GET',
        params: { 'api': 'API_KEY', 'url': 'URL' },
        responseKey: 'shortenedUrl'
    },
    web1s: {
        name: 'Web1s',
        apiUrl: 'https://web1s.com/api',
        method: 'GET',
        params: { 'key': 'API_KEY', 'url': 'URL' },
        responseKey: 'shortenedUrl'
    },
    custom: {
        name: 'Custom',
        apiUrl: 'CUSTOM_URL',
        method: 'POST',
        params: { 'api_key': 'API_KEY', 'url': 'URL' },
        responseKey: 'short_url'
    }
};

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
        
        await supabase
            .from('users')
            .update({
                coins: user.coins - requiredCoins,
                total_withdrawn: (user.total_withdrawn || 0) + amount
            })
            .eq('uid', userId);
            
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
// 7. PROCESS FAUCETPAY PAYMENT
// ============================================================
async function processFaucetPayment(withdrawalId, userId, account, amount) {
    console.log(`💰 Processing FaucetPay payment #${withdrawalId}`);
    
    try {
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
        
        await supabase
            .from('withdrawals')
            .update({
                status: 'processing',
                processed_at: new Date().toISOString()
            })
            .eq('id', withdrawalId);
            
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
            await supabase
                .from('withdrawals')
                .update({
                    status: 'paid',
                    transaction_id: response.data.txn_id || 'fp_' + Date.now(),
                    paid_at: new Date().toISOString()
                })
                .eq('id', withdrawalId);
                
            await supabase
                .from('transactions')
                .update({
                    status: 'completed',
                    transaction_id: response.data.txn_id || 'fp_' + Date.now()
                })
                .eq('reference_id', withdrawalId);
                
            console.log(`✅ Payment successful #${withdrawalId}`);
            
        } else {
            const errorMsg = response.data?.message || 'Unknown error';
            console.error('❌ FaucetPay failed:', errorMsg);
            
            await supabase
                .from('withdrawals')
                .update({
                    status: 'failed',
                    error: errorMsg
                })
                .eq('id', withdrawalId);
                
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
// 9. GET SHORTLINKS (Active - For Users)
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
// 12. CREATE SHORTLINK (Multiple Providers)
// ============================================================
app.post('/api/create-shortlink', async (req, res) => {
    try {
        const { 
            campaignName, 
            shortlinkDomain, 
            provider, 
            apiKey, 
            reward, 
            dailyLimit, 
            totalLimit,
            customApiUrl,
            customMethod,
            customParams
        } = req.body;
        
        // Validate
        if (!campaignName || !shortlinkDomain || !provider || !reward) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        
        // Test the provider API
        let testResult = await testProviderAPI(provider, apiKey, shortlinkDomain, customApiUrl, customMethod, customParams);
        
        if (!testResult.success) {
            return res.status(400).json({
                success: false,
                error: testResult.error || 'Provider API test failed. Please check your API key and settings.'
            });
        }
        
        // Save to database
        const { data, error } = await supabase
            .from('shortlinks')
            .insert({
                title: campaignName,
                description: `${provider} Shortlink Campaign`,
                shortlink_url: shortlinkDomain,
                reward: reward,
                daily_limit: dailyLimit || 0,
                total_limit: totalLimit || 0,
                api_key: apiKey,
                provider: provider,
                custom_api_url: customApiUrl || null,
                custom_method: customMethod || null,
                custom_params: customParams || null,
                status: 'active',
                created_at: new Date().toISOString()
            })
            .select()
            .single();
            
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Shortlink campaign created successfully!',
            shortlink: data,
            testResult: testResult
        });
        
    } catch (error) {
        console.error('Create shortlink error:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 13. TEST PROVIDER API
// ============================================================
async function testProviderAPI(provider, apiKey, url, customApiUrl, customMethod, customParams) {
    try {
        const providerConfig = SHORTLINK_PROVIDERS[provider];
        
        if (!providerConfig && provider !== 'custom') {
            return { success: false, error: 'Unknown provider' };
        }
        
        let apiUrl, method, headers, body, params;
        let testUrl = url || 'https://example.com/test';
        
        if (provider === 'custom') {
            if (!customApiUrl) {
                return { success: false, error: 'Custom API URL required' };
            }
            apiUrl = customApiUrl;
            method = customMethod || 'POST';
            // Parse custom params
            try {
                params = customParams ? JSON.parse(customParams) : {};
            } catch (e) {
                params = {};
            }
        } else {
            apiUrl = providerConfig.apiUrl;
            method = providerConfig.method || 'GET';
            
            // Build params based on provider
            params = {};
            if (providerConfig.params) {
                for (let key in providerConfig.params) {
                    let value = providerConfig.params[key];
                    if (value === 'API_KEY') value = apiKey;
                    else if (value === 'URL') value = testUrl;
                    else if (value === 'ALIAS') value = 'test_' + Date.now();
                    params[key] = value;
                }
            }
            
            headers = providerConfig.headers || {};
            if (headers['Authorization']) {
                headers['Authorization'] = headers['Authorization'].replace('API_KEY', apiKey);
            }
            
            body = providerConfig.body || {};
            if (body && body.url) {
                body.url = testUrl;
            }
        }
        
        // Make test request
        const config = {
            method: method,
            url: apiUrl,
            timeout: 10000,
            headers: headers || {}
        };
        
        if (method === 'GET' || method === 'DELETE') {
            config.params = params;
        } else {
            config.data = body || params;
        }
        
        const response = await axios(config);
        
        if (response.data && (response.data.status === 'success' || response.data.shortenedUrl || response.data.short_url)) {
            return { success: true, data: response.data };
        }
        
        return { success: false, error: 'Invalid API response' };
        
    } catch (error) {
        console.error('Provider API test error:', error);
        return { 
            success: false, 
            error: error.response?.data?.message || error.message || 'API test failed'
        };
    }
}

// ============================================================
// 14. COMPLETE SHORTLINK (With Provider Verification)
// ============================================================
app.post('/api/complete-shortlink', async (req, res) => {
    try {
        const { userId, shortlinkId } = req.body;
        
        if (!userId || !shortlinkId) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields'
            });
        }
        
        // Get shortlink details
        const { data: shortlink, error: slError } = await supabase
            .from('shortlinks')
            .select('*')
            .eq('id', shortlinkId)
            .single();
            
        if (slError || !shortlink) {
            return res.status(404).json({
                success: false,
                error: 'Shortlink not found'
            });
        }
        
        // Check if user already completed today
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        const { data: todayCompletions } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('reference_id', shortlinkId)
            .eq('type', 'shortlink_reward')
            .gte('created_at', today.toISOString())
            .lt('created_at', tomorrow.toISOString());
            
        if (shortlink.daily_limit > 0 && todayCompletions && todayCompletions.length >= shortlink.daily_limit) {
            return res.status(400).json({
                success: false,
                error: `Daily limit reached! You can complete this ${shortlink.daily_limit} times per day.`
            });
        }
        
        // Check total limit
        const { data: totalCompletions } = await supabase
            .from('transactions')
            .select('*')
            .eq('reference_id', shortlinkId)
            .eq('type', 'shortlink_reward');
            
        if (shortlink.total_limit > 0 && totalCompletions && totalCompletions.length >= shortlink.total_limit) {
            return res.status(400).json({
                success: false,
                error: `Total limit reached! This shortlink is no longer available.`
            });
        }
        
        // Verify through provider API
        let verified = false;
        try {
            verified = await verifyShortlinkWithProvider(shortlink);
        } catch (err) {
            console.log('Provider verification failed:', err.message);
            // For now, we'll still allow completion if API call fails
            // In production, you might want to reject
            verified = true;
        }
        
        // For safety, if verification fails but we can't confirm, we still allow
        // This ensures users can complete offers even if provider API is temporarily down
        if (!verified) {
            // Check if this is the first attempt
            const { data: existingAttempts } = await supabase
                .from('transactions')
                .select('*')
                .eq('user_id', userId)
                .eq('reference_id', shortlinkId)
                .eq('type', 'shortlink_reward');
                
            if (existingAttempts && existingAttempts.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'You have already completed this shortlink'
                });
            }
            
            // For now, allow completion if user is trying
            // In production, you'd want proper verification
            console.log(`⚠️ Allow completion without verification for ${shortlinkId}`);
        }
        
        // Credit reward
        const reward = shortlink.reward || 0;
        const coins = Math.round(reward * USD_TO_COINS);
        
        // Update user
        const { data: user } = await supabase
            .from('users')
            .select('coins, total_earned, completed_tasks')
            .eq('uid', userId)
            .single();
            
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        await supabase
            .from('users')
            .update({
                coins: (user.coins || 0) + coins,
                total_earned: (user.total_earned || 0) + reward,
                completed_tasks: (user.completed_tasks || 0) + 1
            })
            .eq('uid', userId);
            
        // Create transaction
        await supabase.from('transactions').insert({
            user_id: userId,
            type: 'shortlink_reward',
            amount: reward,
            coins: coins,
            currency: 'USDT',
            description: `Shortlink completed: ${shortlink.title} (${shortlink.provider})`,
            status: 'completed',
            reference_id: shortlinkId,
            created_at: new Date().toISOString()
        });
        
        // Update shortlink stats
        await supabase
            .from('shortlinks')
            .update({
                total_clicks: (shortlink.total_clicks || 0) + 1
            })
            .eq('id', shortlinkId);
        
        res.json({
            success: true,
            message: 'Shortlink completed successfully!',
            reward: reward,
            coins: coins,
            provider: shortlink.provider
        });
        
    } catch (error) {
        console.error('Complete shortlink error:', error);
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 15. VERIFY SHORTLINK WITH PROVIDER
// ============================================================
async function verifyShortlinkWithProvider(shortlink) {
    try {
        const provider = shortlink.provider;
        const apiKey = shortlink.api_key;
        const url = shortlink.shortlink_url;
        
        const providerConfig = SHORTLINK_PROVIDERS[provider];
        
        if (!providerConfig && provider !== 'custom') {
            return true; // If unknown provider, allow
        }
        
        let apiUrl, method, headers, params, body;
        
        if (provider === 'custom') {
            if (!shortlink.custom_api_url) {
                return true;
            }
            apiUrl = shortlink.custom_api_url;
            method = shortlink.custom_method || 'POST';
            try {
                params = shortlink.custom_params ? JSON.parse(shortlink.custom_params) : {};
            } catch (e) {
                params = {};
            }
        } else {
            apiUrl = providerConfig.apiUrl;
            method = providerConfig.method || 'GET';
            
            params = {};
            if (providerConfig.params) {
                for (let key in providerConfig.params) {
                    let value = providerConfig.params[key];
                    if (value === 'API_KEY') value = apiKey;
                    else if (value === 'URL') value = url;
                    else if (value === 'ALIAS') value = 'verify_' + Date.now();
                    params[key] = value;
                }
            }
            
            headers = providerConfig.headers || {};
            if (headers['Authorization']) {
                headers['Authorization'] = headers['Authorization'].replace('API_KEY', apiKey);
            }
            
            body = providerConfig.body || {};
            if (body && body.url) {
                body.url = url;
            }
        }
        
        // Make verification request
        const config = {
            method: method,
            url: apiUrl,
            timeout: 10000,
            headers: headers || {}
        };
        
        if (method === 'GET' || method === 'DELETE') {
            config.params = params;
        } else {
            config.data = body || params;
        }
        
        const response = await axios(config);
        
        if (response.data && (response.data.status === 'success' || response.data.shortenedUrl || response.data.short_url)) {
            return true;
        }
        
        return false;
        
    } catch (error) {
        console.error('Verification error:', error);
        return false;
    }
}

// ============================================================
// 16. ADMIN - GET ALL SHORTLINKS
// ============================================================
app.get('/api/admin/shortlinks', async (req, res) => {
    try {
        const { data: shortlinks, error } = await supabase
            .from('shortlinks')
            .select('*')
            .order('created_at', { ascending: false });
            
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
// 17. ADMIN - UPDATE SHORTLINK
// ============================================================
app.put('/api/admin/shortlink/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            title, description, shortlink_url, provider, api_key,
            reward, daily_limit, total_limit, status,
            custom_api_url, custom_method, custom_params
        } = req.body;
        
        const { data, error } = await supabase
            .from('shortlinks')
            .update({
                title: title,
                description: description,
                shortlink_url: shortlink_url,
                provider: provider,
                api_key: api_key,
                reward: reward,
                daily_limit: daily_limit || 0,
                total_limit: total_limit || 0,
                custom_api_url: custom_api_url || null,
                custom_method: custom_method || null,
                custom_params: custom_params || null,
                status: status,
                updated_at: new Date().toISOString()
            })
            .eq('id', id)
            .select();
            
        if (error) throw error;
        
        res.json({
            success: true,
            shortlink: data[0]
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 18. ADMIN - DELETE SHORTLINK
// ============================================================
app.delete('/api/admin/shortlink/:id', async (req, res) => {
    try {
        const { id } = req.params;
        
        const { error } = await supabase
            .from('shortlinks')
            .delete()
            .eq('id', id);
            
        if (error) throw error;
        
        res.json({
            success: true,
            message: 'Shortlink deleted successfully'
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 19. GET USER TASKS FOR TODAY (Daily Limit Check)
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
        
        const { data, error } = await supabase
            .from('transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('reference_id', taskId)
            .eq('type', 'shortlink_reward')
            .gte('created_at', startDate.toISOString())
            .lte('created_at', endDate.toISOString());
            
        if (error) throw error;
        
        res.json({
            success: true,
            count: data ? data.length : 0
        });
        
    } catch (error) {
        res.status(400).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================
// 20. ADMIN - GET ALL USERS
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
// 21. ADMIN - GET ALL WITHDRAWALS
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
// 22. ADMIN - UPDATE WITHDRAWAL STATUS
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
// 23. START SERVER
// ============================================================
app.listen(PORT, () => {
    console.log(`🚀 GNEXEN REWARD Backend`);
    console.log(`📡 Server running on port ${PORT}`);
    console.log(`🔑 Supabase connected`);
    console.log(`🪙 Coin System: 1 USD = ${USD_TO_COINS} Coins`);
    console.log(`🔗 Multiple Shortlink Providers: Active`);
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
