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
                console.warn('Failed to store auth data in Chrome storage:', chrome.runtime.lastError);
            } else {
                if (window.Logger) window.Logger.info("Auth data stored in Chrome storage");
                console.log('Auth data stored in Chrome storage successfully');
            }
        });
    }
}

// Clear authentication data
function clearAuthData() {
    // Clear localStorage
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEYS.TOKEN);
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEYS.USER_EMAIL);
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEYS.USER_HASH);
    localStorage.removeItem(AUTH_CONFIG.STORAGE_KEYS.USER_ID);

    // Also clear Chrome extension storage
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.remove(['auth_token', 'user_email', 'user_hash', 'user_id'], () => {
            if (chrome.runtime.lastError) {
                console.warn('Failed to clear auth data from Chrome storage:', chrome.runtime.lastError);
            } else {
                console.log('Auth data cleared from Chrome storage successfully');
            }
        });
    }
}

// Get stored token
function getStoredToken() {
    return localStorage.getItem(AUTH_CONFIG.STORAGE_KEYS.TOKEN);
}

// Get stored email
function getStoredEmail() {
    return localStorage.getItem(AUTH_CONFIG.STORAGE_KEYS.USER_EMAIL);
}

// Get stored hash
function getStoredHash() {
    return localStorage.getItem(AUTH_CONFIG.STORAGE_KEYS.USER_HASH);
}

// Check if user is authenticated
function isAuthenticated() {
    return !!getStoredToken();
}

/**
 * API Functions
 */

// Get user location and network details
async function getUserDetails() {
    try {
        const response = await fetch('https://ipwho.is/');
        if (!response.ok) return {};
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
        console.warn('Failed to fetch user details:', error);
        return {};
    }
}

// Signup API call
async function signup(email, password) {
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
            throw new Error('An account with this email already exists. Please login instead.');
        }

        // Check for non-JSON response (e.g. 404/500 HTML page)
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            console.error('API Error (Non-JSON response):', text);
            throw new Error(`Server returned unexpected format (Status: ${response.status}). Please check API URL.`);
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Signup failed. Please try again.');
        }

        if (window.Logger) window.Logger.info("Signup successful", { email });
        return { success: true, hash, email };
    } catch (error) {
        if (window.Logger) window.Logger.error("Signup error", { error: error.message });
        console.error('Signup error:', error);
        throw error;
    }
}

// Login API call
async function login(email, password) {
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
            throw new Error('Invalid email or password. Please try again.');
        }

        // Check for non-JSON response
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            console.error('API Error (Non-JSON response):', text);
            throw new Error(`Server returned unexpected format (Status: ${response.status}). Please check API URL.`);
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Login failed. Please try again.');
        }

        // Include userId from response if available
        const userId = data.user_id || data.userId || email; // fallback to email as userId

        if (window.Logger) window.Logger.info("Login successful", { email, userId });
        return { success: true, token: data.token, hash, email, userId };
    } catch (error) {
        if (window.Logger) window.Logger.error("Login error", { error: error.message });
        console.error('Login error:', error);
        throw error;
    }
}

// Logout API call
async function logout() {
    try {
        const token = getStoredToken();

        if (!token) {
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
            console.warn('API Warning (Non-JSON response for logout)');
            // For logout, we can just proceed
            return { success: true };
        }

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Logout failed. Please try again.');
        }

        if (window.Logger) window.Logger.info("Logout successful");
        return { success: true };
    } catch (error) {
        if (window.Logger) window.Logger.error("Logout error", { error: error.message });
        console.error('Logout error:', error);
        throw error;
    }
}

// Validate session API call
async function validateSession() {
    try {
        const token = getStoredToken();

        if (!token) {
            return { valid: false };
        }

        const response = await fetch(`${AUTH_CONFIG.API_BASE_URL}/me?source=${AUTH_CONFIG.SOURCE}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            return { valid: false };
        }

        const data = await response.json();
        return { valid: data.valid };
    } catch (error) {
        console.error('Session validation error:', error);
        return { valid: false };
    }
}

/**
 * Page Initialization Functions
 */

// Initialize Signup Page
function initSignup() {
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

            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;
            const confirmPassword = document.getElementById('confirm-password').value;

            // Validation
            if (!email || !password || !confirmPassword) {
                showError('Please fill in all fields.');
                return;
            }

            if (password.length < 8) {
                showError('Password must be at least 8 characters long.');
                return;
            }

            if (password !== confirmPassword) {
                showError('Passwords do not match.');
                return;
            }

            // Email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                showError('Please enter a valid email address.');
                return;
            }

            setButtonLoading('signup-btn', true);

            try {
                const result = await signup(email, password);

                if (result.success) {
                    showSuccess('Account created successfully! Logging you in...');

                    // Auto-login after signup
                    setTimeout(async () => {
                        try {
                            const loginResult = await login(email, password);
                            if (loginResult.success) {
                                // Pass userId to storeAuthData
                                storeAuthData(loginResult.token, loginResult.email, loginResult.hash, loginResult.userId);
                                showSuccess('Login successful! Redirecting...');
                                setTimeout(() => {
                                    window.location.href = 'panel.html';
                                }, 1000);
                            }
                        } catch (error) {
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
                showError(error.message);
                setButtonLoading('signup-btn', false);
            }
        });
    }
}

// Initialize Login Page
function initLogin() {
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

            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;

            // Validation
            if (!email || !password) {
                showError('Please fill in all fields.');
                return;
            }

            setButtonLoading('login-btn', true);

            try {
                const result = await login(email, password);

                if (result.success) {
                    // Pass userId to storeAuthData
                    storeAuthData(result.token, result.email, result.hash, result.userId);
                    showSuccess('Login successful! Redirecting...');
                    setTimeout(() => {
                        window.location.href = 'panel.html';
                    }, 1000);
                }
            } catch (error) {
                showError(error.message);
                setButtonLoading('login-btn', false);
            }
        });
    }
}

// Initialize Logout Page
function initLogout() {
    const logoutBtn = document.getElementById('logout-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    // Check if user is authenticated
    if (!isAuthenticated()) {
        showError('You are not logged in.');
        setTimeout(() => {
            window.location.href = 'login.html';
        }, 2000);
        return;
    }

    // Cancel button
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            window.location.href = 'panel.html';
        });
    }

    // Logout button
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            setButtonLoading('logout-btn', true);

            try {
                const result = await logout();

                if (result.success) {
                    clearAuthData();
                    showSuccess('Logged out successfully! Redirecting...');
                    setTimeout(() => {
                        window.location.href = 'login.html';
                    }, 1500);
                }
            } catch (error) {
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
    if (!isAuthenticated()) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

// Validate session and redirect if invalid
async function checkSession() {
    const result = await validateSession();
    if (!result.valid) {
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
        try {
            await logout();
            clearAuthData();
            return true;
        } catch (error) {
            clearAuthData();
            return true;
        }
    }
};
