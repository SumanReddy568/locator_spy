import { logger, trackLogin, trackSignup, logAuthLifecycle } from '../utils/analytics.js';
import { WORKER_BASE } from '../utils/endpoints.js';

const AUTH_CONFIG = {
    API_BASE_URL: WORKER_BASE,
    SOURCE: 'locator-spy',
    STORAGE_KEYS: {
        TOKEN: 'auth_token',
        USER_EMAIL: 'user_email',
        USER_HASH: 'user_hash',
        USER_ID: 'user_id'
    }
};

// Keys that sync across devices via the auth worker.
// Anything not in this list stays local (e.g. UI toggles).
const SYNCED_SETTING_KEYS = [
    'aiProvider',
    'googleApiKey',
    'aiModel',
    'openRouterApiKey',
    'openRouterModel'
];

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

    // Also clear Chrome extension storage — including any synced settings
    // so that a different account on the same device doesn't inherit the
    // previous user's API keys.
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        const keysToClear = [
            'auth_token', 'user_email', 'user_hash', 'user_id',
            // Free-credits UI cache + dismiss flag are per-account — wipe
            // them so the next user gets a clean banner state instead of
            // inheriting the previous account's remaining count.
            'aiFreeCredits', 'aiFreeCreditsBannerDismissed', 'aiFreeCreditsOwner',
            // Feedback gate is per-account too — without these the next
            // user inherits the previous account's "already submitted"
            // flag and the feedback popup never fires for them.
            'feedbackSubmitted', 'locatorCount',
            ...SYNCED_SETTING_KEYS
        ];
        chrome.storage.local.remove(keysToClear, () => {
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
    logAuthLifecycle('signup_started', { email });
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
            logAuthLifecycle('signup_conflict', { email, status: 409 });
            throw new Error('An account with this email already exists. Please login instead.');
        }

        // Check for non-JSON response (e.g. 404/500 HTML page)
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            logger.error('API Error (Non-JSON response)', { status: response.status, responseText: text });
            logAuthLifecycle('signup_api_non_json', { email, status: response.status });
            console.error('API Error (Non-JSON response):', text);
            throw new Error(`Server returned unexpected format (Status: ${response.status}). Please check API URL.`);
        }

        const data = await response.json();

        if (!response.ok) {
            logger.error('Signup failed', { error: data.error, status: response.status });
            logAuthLifecycle('signup_failed', { email, status: response.status, error: data.error });
            throw new Error(data.error || 'Signup failed. Please try again.');
        }

        logger.info('Signup successful', { email });
        trackSignup({ status: 'success', email });
        logAuthLifecycle('signup_succeeded', { email });
        return { success: true, hash, email };
    } catch (error) {
        logger.error('Signup error', { error: error.message });
        logAuthLifecycle('signup_error', { email, error: error.message });
        console.error('Signup error:', error);
        throw error;
    }
}

// Login API call
async function login(email, password) {
    logger.info('login called', { email });
    logAuthLifecycle('login_started', { email });
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
            logAuthLifecycle('login_invalid_credentials', { email, status: 401 });
            trackLogin({ status: 'invalid_credentials', email });
            throw new Error('Invalid email or password. Please try again.');
        }

        // Check for non-JSON response
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            const text = await response.text();
            logger.error('API Error (Non-JSON response)', { status: response.status, responseText: text });
            console.error('API Error (Non-JSON response):', text);
            logAuthLifecycle('login_api_non_json', { email, status: response.status });
            throw new Error(`Server returned unexpected format (Status: ${response.status}). Please check API URL.`);
        }

        const data = await response.json();

        if (!response.ok) {
            logger.error('Login failed', { error: data.error, status: response.status });
            logAuthLifecycle('login_failed', { email, status: response.status, error: data.error });
            throw new Error(data.error || 'Login failed. Please try again.');
        }

        // Include userId from response if available
        const userId = data.user_id || data.userId || email; // fallback to email as userId

        logger.info('Login successful', { email, userId });
        trackLogin({ status: 'success', email, userId, source: 'auth_login' });
        logAuthLifecycle('login_succeeded', { email, userId });
        return { success: true, token: data.token, hash, email, userId };
    } catch (error) {
        logger.error('Login error', { error: error.message });
        logAuthLifecycle('login_error', { email, error: error.message });
        console.error('Login error:', error);
        throw error;
    }
}

// Logout API call
async function logout() {
    logger.info('logout called');
    logAuthLifecycle('logout_started', {});
    try {
        const token = getStoredToken();

        if (!token) {
            logger.warn('Logout attempted without active session');
            logAuthLifecycle('logout_no_active_session', {});
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
            logAuthLifecycle('logout_non_json_response', { status: response.status });
            return { success: true };
        }

        const data = await response.json();

        if (!response.ok) {
            logger.error('Logout API failed', { error: data.error, status: response.status });
            logAuthLifecycle('logout_failed', { status: response.status, error: data.error });
            throw new Error(data.error || 'Logout failed. Please try again.');
        }

        logger.info('Logout successful');
        logAuthLifecycle('logout_succeeded', {});
        return { success: true };
    } catch (error) {
        logger.error('Logout error', { error: error.message });
        logAuthLifecycle('logout_error', { error: error.message });
        console.error('Logout error:', error);
        throw error;
    }
}

// Read the synced subset of settings from chrome.storage.local
function readSyncedSettingsFromStorage() {
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            resolve({});
            return;
        }
        chrome.storage.local.get(SYNCED_SETTING_KEYS, (result) => {
            const filtered = {};
            for (const key of SYNCED_SETTING_KEYS) {
                if (result[key] !== undefined && result[key] !== null && result[key] !== '') {
                    filtered[key] = result[key];
                }
            }
            resolve(filtered);
        });
    });
}

// Write the synced subset of settings into chrome.storage.local. When
// `fillOnly` is true, existing non-empty local values are preserved — used
// for opportunistic pulls so we don't clobber edits made between sessions.
function writeSyncedSettingsToStorage(settings, { fillOnly = false } = {}) {
    return new Promise((resolve) => {
        if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
            resolve();
            return;
        }
        chrome.storage.local.get(SYNCED_SETTING_KEYS, (existing) => {
            const toWrite = {};
            for (const key of SYNCED_SETTING_KEYS) {
                if (settings[key] === undefined) continue;
                if (fillOnly && existing[key] !== undefined && existing[key] !== '') continue;
                toWrite[key] = settings[key];
            }
            if (Object.keys(toWrite).length === 0) {
                resolve();
                return;
            }
            chrome.storage.local.set(toWrite, () => resolve());
        });
    });
}

// Fetch the user's settings blob from the auth worker. Returns the data
// object (possibly empty `{}`) on success, or `null` on any failure
// (network, 401, malformed response). Callers use the null vs `{}`
// distinction to decide whether the server is reachable-but-empty.
async function fetchUserSettings() {
    const token = getStoredToken();
    if (!token) return null;

    try {
        const response = await fetch(
            `${AUTH_CONFIG.API_BASE_URL}/settings?source=${AUTH_CONFIG.SOURCE}`,
            {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${token}` }
            }
        );
        if (!response.ok) {
            logger.warn('fetchUserSettings: server rejected', { status: response.status });
            return null;
        }
        const payload = await response.json();
        return payload && typeof payload.data === 'object' && payload.data !== null
            ? payload.data
            : {};
    } catch (err) {
        logger.error('fetchUserSettings error', { error: err.message });
        return null;
    }
}

// Apply server settings to local storage. `fillOnly: true` preserves any
// non-empty local values. Returns true if anything was applied.
async function pullUserSettings({ fillOnly = false } = {}) {
    logger.info('pullUserSettings called', { fillOnly });
    const data = await fetchUserSettings();
    if (!data || Object.keys(data).length === 0) return false;

    await writeSyncedSettingsToStorage(data, { fillOnly });
    logger.info('pullUserSettings: applied remote settings', {
        keys: Object.keys(data),
        fillOnly
    });
    return true;
}

// Reconcile local and server settings:
//   - If the server has data → apply to local (fillOnly governs overwrites).
//   - If the server is reachable-but-empty AND local has keys → push them up.
//     This handles existing users who saved API keys before cross-device sync
//     existed; without it they'd have to manually re-save once.
//   - If the server is unreachable → leave both sides alone.
async function syncUserSettings({ fillOnly = false } = {}) {
    logger.info('syncUserSettings called', { fillOnly });
    const remote = await fetchUserSettings();
    if (remote === null) return false;

    if (Object.keys(remote).length > 0) {
        await writeSyncedSettingsToStorage(remote, { fillOnly });
        logger.info('syncUserSettings: applied remote', { keys: Object.keys(remote) });
        return true;
    }

    const local = await readSyncedSettingsFromStorage();
    if (Object.keys(local).length === 0) return false;

    logger.info('syncUserSettings: bootstrapping server from local', {
        keys: Object.keys(local)
    });
    return await pushUserSettings(local);
}

// Push the synced subset of settings to the auth worker. Pass an explicit
// `settings` object, or omit to read the current state from storage.
async function pushUserSettings(settings) {
    logger.info('pushUserSettings called');
    const token = getStoredToken();
    if (!token) return false;

    const data = settings
        ? Object.fromEntries(
            SYNCED_SETTING_KEYS
                .filter((k) => settings[k] !== undefined)
                .map((k) => [k, settings[k]])
        )
        : await readSyncedSettingsFromStorage();

    if (Object.keys(data).length === 0) {
        logger.info('pushUserSettings: nothing to push');
        return false;
    }

    try {
        const response = await fetch(
            `${AUTH_CONFIG.API_BASE_URL}/settings?source=${AUTH_CONFIG.SOURCE}`,
            {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ data })
            }
        );
        if (!response.ok) {
            logger.warn('pushUserSettings: server rejected', { status: response.status });
            return false;
        }
        logger.info('pushUserSettings: synced', { keys: Object.keys(data) });
        return true;
    } catch (err) {
        logger.error('pushUserSettings error', { error: err.message });
        return false;
    }
}

// Validate session API call
async function validateSession() {
    logger.info('validateSession called');
    try {
        const token = getStoredToken();

        if (!token) {
            logger.info('No token found during session validation');
            logAuthLifecycle('session_validation_no_token', {});
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
            logAuthLifecycle('session_validation_failed', { status: response.status });
            return { valid: false };
        }

        const data = await response.json();
        logger.info('Session validation result', { valid: data.valid });
        logAuthLifecycle('session_validation_result', { valid: data.valid });
        return { valid: data.valid };
    } catch (error) {
        logger.error('Session validation error', { error: error.message });
        logAuthLifecycle('session_validation_error', { error: error.message });
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
                logAuthLifecycle('signup_validation_failed_missing_fields', {});
                showError('Please fill in all fields.');
                return;
            }

            if (password.length < 8) {
                logger.warn('Signup validation failed: password too short');
                logAuthLifecycle('signup_validation_failed_password_too_short', {});
                showError('Password must be at least 8 characters long.');
                return;
            }

            if (password !== confirmPassword) {
                logger.warn('Signup validation failed: passwords do not match');
                logAuthLifecycle('signup_validation_failed_password_mismatch', {});
                showError('Passwords do not match.');
                return;
            }

            // Email validation
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                logger.warn('Signup validation failed: invalid email format');
                logAuthLifecycle('signup_validation_failed_invalid_email', {});
                showError('Please enter a valid email address.');
                return;
            }

            setButtonLoading('signup-btn', true);

            try {
                const result = await signup(email, password);

                if (result.success) {
                    logger.info('Signup API success, starting auto-login');
                    logAuthLifecycle('auto_login_after_signup_scheduled', { email });
                    showSuccess('Account created successfully! Logging you in...');

                    // Auto-login after signup
                    setTimeout(async () => {
                        try {
                            const loginResult = await login(email, password);
                            if (loginResult.success) {
                                // Pass userId to storeAuthData
                                storeAuthData(loginResult.token, loginResult.email, loginResult.hash, loginResult.userId);
                                logger.info('Auto-login successful after signup');
                                trackLogin({ status: 'success', email, userId: loginResult.userId, source: 'auto_after_signup' });
                                logAuthLifecycle('auto_login_after_signup_succeeded', { email, userId: loginResult.userId });
                                // New signup → no remote settings expected, but reconcile
                                // anyway so a re-used account on a fresh device still pulls.
                                await syncUserSettings({ fillOnly: false });
                                showSuccess('Login successful! Redirecting...');
                                setTimeout(() => {
                                    window.location.href = 'panel.html';
                                }, 1000);
                            }
                        } catch (error) {
                            logger.error('Auto-login failed after signup', { error: error.message });
                            logAuthLifecycle('auto_login_after_signup_failed', { email, error: error.message });
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
                logAuthLifecycle('signup_process_error', { email, error: error.message });
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
                logAuthLifecycle('login_validation_failed_missing_fields', {});
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
                    // Reconcile synced settings (e.g. AI keys): pulls from the
                    // server, or pushes local-only keys up for first-time
                    // upgraders. Server is canonical for this fresh session.
                    await syncUserSettings({ fillOnly: false });
                    showSuccess('Login successful! Redirecting...');
                    setTimeout(() => {
                        window.location.href = 'panel.html';
                    }, 1000);
                }
            } catch (error) {
                logger.error('Login process error', { error: error.message });
                logAuthLifecycle('login_process_error', { email, error: error.message });
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
    pullUserSettings,
    pushUserSettings,
    syncUserSettings,
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
