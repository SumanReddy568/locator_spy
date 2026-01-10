import { logger } from '../utils/analytics.js';

/**
 * Authentication Module for Locator Spy
 * Integrates with Cloudflare Auth Worker API
 */

// Configuration
const AUTH_CONFIG = {
    API_BASE_URL: 'https://auth-worker.sumanreddy568.workers.dev',
    SOURCE: 'locator-spy',
    STORAGE_KEYS: {
        TOKEN: 'auth_token',
        USER_EMAIL: 'user_email',
        USER_HASH: 'user_hash',
        USER_ID: 'user_id'
    }
};

/**
 * Utility Functions
 */

// Generate SHA-256 hash from email and password
async function generateHash(email, password) {
    logger.info('generateHash called');
    const text = `${email.toLowerCase()}:${password}`;
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}

// Show error message
function showError(message, elementId = 'error-message') {
    logger.info('showError called', { message, elementId });
    const errorElement = document.getElementById(elementId);
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.display = 'flex';
        setTimeout(() => {
            errorElement.style.display = 'none';
        }, 5000);
    }
}

// Show success message
function showSuccess(message, elementId = 'success-message') {
    logger.info('showSuccess called', { message, elementId });
    const successElement = document.getElementById(elementId);
    if (successElement) {
        successElement.textContent = message;
        successElement.style.display = 'flex';
        setTimeout(() => {
            successElement.style.display = 'none';
        }, 3000);
    }
}

// Toggle button loading state
function setButtonLoading(buttonId, isLoading) {
    logger.info('setButtonLoading called', { buttonId, isLoading });
    const button = document.getElementById(buttonId);
    if (button) {
        const buttonText = button.querySelector('.button-text');
        const buttonLoader = button.querySelector('.button-loader');

        if (isLoading) {
            button.disabled = true;
            if (buttonText) buttonText.style.display = 'none';
            if (buttonLoader) buttonLoader.style.display = 'inline-block';
        } else {
            button.disabled = false;
            if (buttonText) buttonText.style.display = 'inline-block';
            if (buttonLoader) buttonLoader.style.display = 'none';
        }
    }
}

// Store authentication data
function storeAuthData(token, email, hash, userId = null) {
    logger.info('storeAuthData called', { email, userId });
    // Store in localStorage (for backward compatibility)
    localStorage.setItem(AUTH_CONFIG.STORAGE_KEYS.TOKEN, token);
    localStorage.setItem(AUTH_CONFIG.STORAGE_KEYS.USER_EMAIL, email);
    localStorage.setItem(AUTH_CONFIG.STORAGE_KEYS.USER_HASH, hash);
    if (userId) {
        localStorage.setItem(AUTH_CONFIG.STORAGE_KEYS.USER_ID, userId);
    }

    // Also store in Chrome extension storage for analytics
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const chromeData = {
            auth_token: token,
            user_email: email,
            user_hash: hash
        };
        if (userId) {
            chromeData.user_id = userId;
        }

        chrome.storage.local.set(chromeData, () => {
            if (chrome.runtime.lastError) {
                logger.error('Failed to store auth data in Chrome storage', { error: chrome.runtime.lastError });
                console.warn('Failed to store auth data in Chrome storage:', chrome.runtime.lastError);
            } else {
                logger.info('Auth data stored in Chrome storage successfully');
                console.log('Auth data stored in Chrome storage successfully');
            }
        });
    }
}

// Clear authentication data
function clearAuthData() {
    logger.info('clearAuthData called');
    // Clear localStorage
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEYS.TOKEN);
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEYS.USER_EMAIL);
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEYS.USER_HASH);
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEYS.USER_ID);

    // Also clear Chrome extension storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(['auth_token', 'user_email', 'user_hash', 'user_id'], () => {
            if (chrome.runtime.lastError) {
                logger.error('Failed to clear auth data from Chrome storage', { error: chrome.runtime.lastError });
                console.warn('Failed to clear auth data from Chrome storage:', chrome.runtime.lastError);
            } else {
                logger.info('Auth data cleared from Chrome storage successfully');
                console.log('Auth data cleared from Chrome storage successfully');
            }
        });
    }
}

// Get stored token
function getStoredToken() {
    logger.info('getStoredToken called');
    return localStorage.getItem(AUTH_CONFIG.STORAGE_KEYS.TOKEN);
}

// Get stored email
function getStoredEmail() {
    logger.info('getStoredEmail called');
    return localStorage.getItem(AUTH_CONFIG.STORAGE_KEYS.USER_EMAIL);
}

// Get stored hash
function getStoredHash() {
    logger.info('getStoredHash called');
    return localStorage.getItem(AUTH_CONFIG.STORAGE_KEYS.USER_HASH);
}

// Check if user is authenticated
function isAuthenticated() {
    logger.info('isAuthenticated called');
    return !!getStoredToken();
}

/**
 * API Functions
 */

// Get user location and network details
async function getUserDetails() {
    logger.info('getUserDetails called');
    try {
        const response = await fetch('https://ipwho.is/');
        if (!response.ok) {
            logger.warn('IPWhois response not ok', { status: response.status });
            return {};
        }
        const data = await response.json();
        return {
            ip: data.ip,
            city: data.city,
            region: data.region,
            country: data.country,
            isp: data.connection?.isp || data.isp,
            timezone: data.timezone?.id
        };
    } catch (error) {
        logger.error('Failed to fetch user details', { error: error.message });
        console.warn('Failed to fetch user details:', error);
        return {};
    }
}

// Signup API call
async function signup(email, password) {
    logger.info('signup called', { email });
    try {
        const hash = await generateHash(email, password);

        const userDetails = await getUserDetails();

        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                source: AUTH_CONFIG.SOURCE,
                hash: hash,
                email: email,
                password: password,
                ...userDetails
            })
        });

        // Handle specific status codes before checking content type
        if (response.status === 409) {
            logger.warn('Signup conflict: user already exists', { email });
            throw new Error('An account with this email already exists. Please login instead.');
        }

        // Check for non-JSON response (e.g. 404/500 HTML page)
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            logger.error('API Error (Non-JSON response)', { status: response.status, responseText: text });
            console.error('API Error (Non-JSON response):', text);
            throw new Error(`Server returned unexpected format (Status: ${response.status}). Please check API URL.`);
        }

        const data = await response.json();

        if (!response.ok) {
            logger.error('Signup failed', { error: data.error, status: response.status });
            throw new Error(data.error || 'Signup failed. Please try again.');
        }

        logger.info('Signup successful', { email });
        return { success: true, hash, email };
    } catch (error) {
        logger.error('Signup error', { error: error.message });
        console.error('Signup error:', error);
        throw error;
    }
}

// Login API call
async function login(email, password) {
    logger.info('login called', { email });
    try {
        const hash = await generateHash(email, password);

        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                source: AUTH_CONFIG.SOURCE,
                hash: hash
            })
        });

        // Handle specific status codes before checking content type
        if (response.status === 401) {
            logger.warn('Login failed: invalid credentials', { email });
            throw new Error('Invalid email or password. Please try again.');
        }

        // Check for non-JSON response
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            logger.error('API Error (Non-JSON response)', { status: response.status, responseText: text });
            console.error('API Error (Non-JSON response):', text);
            throw new Error(`Server returned unexpected format (Status: ${response.status}). Please check API URL.`);
        }

        const data = await response.json();

        if (!response.ok) {
            logger.error('Login failed', { error: data.error, status: response.status });
            throw new Error(data.error || 'Login failed. Please try again.');
        }

        // Include userId from response if available
        const userId = data.user_id || data.userId || email; // fallback to email as userId

        logger.info('Login successful', { email, userId });
        return { success: true, token: data.token, hash, email, userId };
    } catch (error) {
        logger.error('Login error', { error: error.message });
        console.error('Login error:', error);
        throw error;
    }
}

// Logout API call
async function logout() {
    logger.info('logout called');
    try {
        const token = getStoredToken();

        if (!token) {
            logger.warn('Logout attempted without active session');
            throw new Error('No active session found.');
        }

        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/logout`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                source: AUTH_CONFIG.SOURCE,
                token: token
            })
        });

        // Check for non-JSON response
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            logger.warn('API Warning (Non-JSON response for logout)');
            console.warn('API Warning (Non-JSON response for logout)');
            // For logout, we can just proceed
            return { success: true };
        }

        const data = await response.json();

        if (!response.ok) {
            logger.error('Logout API failed', { error: data.error, status: response.status });
            throw new Error(data.error || 'Logout failed. Please try again.');
        }

        logger.info('Logout successful');
        return { success: true };
    } catch (error) {
        logger.error('Logout error', { error: error.message });
        console.error('Logout error:', error);
        throw error;
    }
}

// Validate session API call
async function validateSession() {
    logger.info('validateSession called');
    try {
        const token = getStoredToken();

        if (!token) {
            logger.info('No token found during session validation');
            return { valid: false };
        }

        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/me?source=${AUTH_CONFIG.SOURCE}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            logger.warn('Session validation failed on server', { status: response.status });
            return { valid: false };
        }

        const data = await response.json();
        logger.info('Session validation result', { valid: data.valid });
        return { valid: data.valid };
    } catch (error) {
        logger.error('Session validation error', { error: error.message });
        console.error('Session validation error:', error);
        return { valid: false };
    }
}

/**
 * Page Initialization Functions
 */

// Initialize Signup Page
function initSignup() {
    logger.info('initSignup called');
    const signupForm = document.getElementById('signup-form');
    const togglePasswordBtn = document.getElementById('toggle-password');
    const toggleConfirmPasswordBtn = document.getElementById('toggle-confirm-password');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirm-password');

    // Password visibility toggle
    if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener('click', () => {
            const type = passwordInput.type === 'password' ? 'text' : 'password';
            passwordInput.type = type;
            const icon = togglePasswordBtn.querySelector('i');
            icon.classList.toggle('fa-eye');
            icon.classList.toggle('fa-eye-slash');
        });
    }

    if (toggleConfirmPasswordBtn && confirmPasswordInput) {
        toggleConfirmPasswordBtn.addEventListener('click', () => {
            const type = confirmPasswordInput.type === 'password' ? 'text' : 'password';
            confirmPasswordInput.type = type;
            const icon = toggleConfirmPasswordBtn.querySelector('i');
            icon.classList.toggle('fa-eye');
            icon.classList.toggle('fa-eye-slash');
        });
    }

    // Form submission
    if (signupForm) {
        signupForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            logger.info('Signup form submitted');

            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm-password').value;

            // Validation
            if (!email || !password || !confirmPassword) {
                logger.warn('Signup validation failed: missing fields');
                showError('Please fill in all fields.');
                return;
            }

            if (password.length < 8) {
                logger.warn('Signup validation failed: password too short');
                showError('Password must be at least 8 characters long.');
                return;
            }

            if (password !== confirmPassword) {
                logger.warn('Signup validation failed: passwords do not match');
                showError('Passwords do not match.');
                return;
            }

            // Email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                logger.warn('Signup validation failed: invalid email format');
                showError('Please enter a valid email address.');
                return;
            }

            setButtonLoading('signup-btn', true);

            try {
                const result = await signup(email, password);

                if (result.success) {
                    logger.info('Signup API success, starting auto-login');
                    showSuccess('Account created successfully! Logging you in...');

                    // Auto-login after signup
                    setTimeout(async () => {
                        try {
                            const loginResult = await login(email, password);
                            if (loginResult.success) {
                                // Pass userId to storeAuthData
                                storeAuthData(loginResult.token, loginResult.email, loginResult.hash, loginResult.userId);
                                logger.info('Auto-login successful after signup');
                                showSuccess('Login successful! Redirecting...');
                                setTimeout(() => {
                                    window.location.href = 'panel.html';
                                }, 1000);
                            }
                        } catch (error) {
                            logger.error('Auto-login failed after signup', { error: error.message });
                            showError(error.message);
                            setTimeout(() => {
                                window.location.href = 'login.html';
                            }, 2000);
                        } finally {
                            setButtonLoading('signup-btn', false);
                        }
                    }, 1500);
                }
            } catch (error) {
                logger.error('Signup process error', { error: error.message });
                showError(error.message);
                setButtonLoading('signup-btn', false);
            }
        });
    }
}

// Initialize Login Page
function initLogin() {
    logger.info('initLogin called');
    const loginForm = document.getElementById('login-form');
    const togglePasswordBtn = document.getElementById('toggle-password');
    const passwordInput = document.getElementById('password');

    // Password visibility toggle
    if (togglePasswordBtn && passwordInput) {
        togglePasswordBtn.addEventListener('click', () => {
            const type = passwordInput.type === 'password' ? 'text' : 'password';
            passwordInput.type = type;
            const icon = togglePasswordBtn.querySelector('i');
            icon.classList.toggle('fa-eye');
            icon.classList.toggle('fa-eye-slash');
        });
    }

    // Form submission
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            logger.info('Login form submitted');

            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;

            // Validation
            if (!email || !password) {
                logger.warn('Login validation failed: missing fields');
                showError('Please fill in all fields.');
                return;
            }

            setButtonLoading('login-btn', true);

            try {
                const result = await login(email, password);

                if (result.success) {
                    logger.info('Login successful, preparing redirect');
                    // Pass userId to storeAuthData
                    storeAuthData(result.token, result.email, result.hash, result.userId);
                    showSuccess('Login successful! Redirecting...');
                    setTimeout(() => {
                        window.location.href = 'panel.html';
                    }, 1000);
                }
            } catch (error) {
                logger.error('Login process error', { error: error.message });
                showError(error.message);
                setButtonLoading('login-btn', false);
            }
        });
    }
}

// Initialize Logout Page
function initLogout() {
    logger.info('initLogout called');
    const logoutBtn = document.getElementById('logout-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    // Check if user is authenticated
    if (!isAuthenticated()) {
        logger.info('Logout page accessed by unauthenticated user');
        showError('You are not logged in.');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
        return;
    }

    // Cancel button
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            logger.info('Logout cancelled by user');
            window.location.href = 'panel.html';
        });
    }

    // Logout button
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            logger.info('Logout button clicked');
            setButtonLoading('logout-btn', true);

            try {
                const result = await logout();

                if (result.success) {
                    logger.info('Logout success, clearing data and redirecting');
                    clearAuthData();
                    showSuccess('Logged out successfully! Redirecting...');
                    setTimeout(() => {
                        window.location.href = 'login.html';
                    }, 1500);
                }
            } catch (error) {
                logger.warn('Logout API failed but clearing data anyway', { error: error.message });
                // Even if API call fails, clear local data
                clearAuthData();
                showSuccess('Logged out successfully! Redirecting...');
                setTimeout(() => {
                    window.location.href = 'login.html';
                }, 1500);
            }
        });
    }
}

// Check authentication status on protected pages
function requireAuth() {
    logger.info('requireAuth called');
    if (!isAuthenticated()) {
        logger.info('requireAuth: not authenticated, redirecting to login');
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

// Validate session and redirect if invalid
async function checkSession() {
    logger.info('checkSession called');
    const result = await validateSession();
    if (!result.valid) {
        logger.info('checkSession: session invalid, clearing data and redirecting');
        clearAuthData();
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

// Export functions for use in other scripts
window.AuthModule = {
    isAuthenticated,
    requireAuth,
    checkSession,
    getStoredEmail,
    getStoredToken,
    logout: async () => {
        logger.info('AuthModule.logout called');
        try {
            await logout();
            clearAuthData();
            return true;
        } catch (error) {
            logger.error('AuthModule.logout error', { error: error.message });
            clearAuthData();
            return true;
        }
    }
};

// Expose internal init functions for non-module compatibility
window.initSignup = initSignup;
window.initLogin = initLogin;
window.initLogout = initLogout;
