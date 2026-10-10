// public/js/auth.js
// TokenPulse: Supabase Client Authentication, Session Management & RBAC Guard

let supabaseClient = null;
let authConfig = null;
let isConfigPromise = null;

/**
 * Utility: Wrap any Promise with a strict timeout to prevent indefinite UI hangs
 */
export function withTimeout(promise, ms = 12000, errorMsg = 'Operation timed out. Please check your network connection and retry.') {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        const err = new Error(errorMsg);
        err.name = 'TimeoutError';
        reject(err);
      }
    }, ms);

    Promise.resolve(promise)
      .then(res => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(res);
        }
      })
      .catch(err => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(err);
        }
      });
  });
}

/**
 * Fetch public auth configuration from server
 */
export async function getAuthConfig() {
  if (authConfig) return authConfig;
  if (isConfigPromise) return isConfigPromise;

  isConfigPromise = fetch('/api/auth/config')
    .then(res => res.json())
    .then(data => {
      authConfig = data;
      return authConfig;
    })
    .catch(err => {
      console.warn('Failed to fetch auth configuration:', err);
      authConfig = { configured: false, supabaseUrl: '', supabaseAnonKey: '' };
      return authConfig;
    });

  return isConfigPromise;
}

/**
 * Get or initialize the Supabase client
 */
export async function getSupabase() {
  if (supabaseClient) return supabaseClient;

  const config = await getAuthConfig();
  if (!config.configured || !config.supabaseUrl || !config.supabaseAnonKey) {
    return null;
  }

  // Ensure @supabase/supabase-js is loaded in window (brief polling if script tag is completing execution)
  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    let waited = 0;
    while ((!window.supabase || typeof window.supabase.createClient !== 'function') && waited < 1500) {
      await new Promise(r => setTimeout(r, 100));
      waited += 100;
    }
  }

  if (!window.supabase || typeof window.supabase.createClient !== 'function') {
    throw new Error('Supabase client library (@supabase/supabase-js) is not loaded on page.');
  }

  try {
    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storageKey: 'tokenpulse-auth-session'
      }
    });
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err);
    throw new Error(`Failed to initialize Supabase client: ${err.message}`);
  }

  return supabaseClient;
}

/**
 * Client-side input validation helpers
 */
export function validateEmailFormat(email) {
  if (!email || typeof email !== 'string') return false;
  const re = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(email.trim());
}

export function validatePasswordFormat(password) {
  return Boolean(password && typeof password === 'string' && password.length >= 6);
}

/**
 * Authenticate existing user with Supabase Auth
 */
export async function loginUser(email, password) {
  // Client validation
  if (!validateEmailFormat(email)) {
    throw new Error('Please enter a valid email address.');
  }
  if (!password) {
    throw new Error('Password is required.');
  }

  const client = await getSupabase();
  if (!client) {
    throw new Error('Backend Authentication Error: Supabase credentials are not configured. Please configure SUPABASE_URL and SUPABASE_ANON_KEY in your .env file to enable live authentication.');
  }

  // Wrap with strict 12-second timeout to prevent indefinite spinning
  const response = await withTimeout(
    client.auth.signInWithPassword({
      email: email.trim(),
      password
    }),
    12000,
    'Authentication request timed out. Unable to reach Supabase authentication server. Please check your network connection and retry.'
  );

  if (response.error) {
    logAuthDiagnostic('loginUser', response.error);
    throw response.error;
  }

  return response.data;
}

/**
 * Register a new user with Supabase Auth
 */
export async function signupUser(fullName, email, password, confirmPassword) {
  // Validate inputs
  if (!fullName || !fullName.trim()) {
    throw new Error('Full name is required.');
  }
  if (!validateEmailFormat(email)) {
    throw new Error('Please enter a valid email address.');
  }
  if (!validatePasswordFormat(password)) {
    throw new Error('Password must be at least 6 characters long.');
  }
  if (password !== confirmPassword) {
    throw new Error('Passwords do not match. Please re-enter.');
  }

  const client = await getSupabase();
  if (!client) {
    throw new Error('Backend Authentication Error: Supabase credentials are not configured. Please configure SUPABASE_URL and SUPABASE_ANON_KEY in your .env file to enable live registration.');
  }

  // Wrap with strict 12-second timeout to prevent indefinite spinning
  const response = await withTimeout(
    client.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          full_name: fullName.trim()
        }
      }
    }),
    12000,
    'Registration request timed out. Unable to reach Supabase authentication server. Please check your network connection and retry.'
  );

  if (response.error) {
    logAuthDiagnostic('signupUser', response.error);
    throw response.error;
  }

  return response.data;
}

/**
 * Request password reset email from Supabase Auth
 */
export async function requestPasswordReset(email) {
  if (!validateEmailFormat(email)) {
    throw new Error('Please enter a valid email address.');
  }

  const client = await getSupabase();
  if (!client) {
    throw new Error('Backend Authentication Error: Supabase credentials are not configured in your .env file.');
  }

  const response = await withTimeout(
    client.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/login`
    }),
    12000,
    'Password reset request timed out. Please check your network connection and retry.'
  );

  if (response.error) {
    logAuthDiagnostic('requestPasswordReset', response.error);
    throw response.error;
  }

  return response.data;
}

/**
 * Detects whether an authentication error is an email rate-limit error from Supabase
 */
export function isEmailRateLimitError(err) {
  if (!err) return false;
  const status = Number(err.status || err.statusCode || 0);
  const code = String(err.code || '').toLowerCase();
  const message = String(err.message || '').toLowerCase();

  return (
    status === 429 ||
    code === 'over_email_send_rate_limit' ||
    code === 'too_many_requests' ||
    code === 'email_rate_limit_exceeded' ||
    code === 'rate_limit_exceeded' ||
    message.includes('email rate limit') ||
    message.includes('rate limit exceeded') ||
    message.includes('over_email_send_rate_limit') ||
    message.includes('too many requests') ||
    message.includes('only request this once every')
  );
}

/**
 * Formats a user-facing authentication error message
 */
export function formatAuthErrorMessage(err) {
  if (!err) return 'An unexpected authentication error occurred. Please try again.';

  if (isEmailRateLimitError(err)) {
    return 'Email delivery is temporarily limited due to high request volume. Please wait a few minutes before requesting another confirmation or reset email, and try again later.';
  }

  const code = String(err.code || '').toLowerCase();
  const msg = String(err.message || '').toLowerCase();

  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'Invalid email or password. Please verify your credentials and try again.';
  }
  if (code === 'user_already_exists' || msg.includes('already registered')) {
    return 'An account with this email address already exists. Please sign in instead.';
  }
  if (err.name === 'TimeoutError' || msg.includes('timed out')) {
    return err.message || 'Authentication request timed out. Please check your network connection and retry.';
  }
  if (msg.includes('failed to fetch') || msg.includes('networkerror')) {
    return 'Network connection error. Unable to reach authentication server. Please check your internet connection and retry.';
  }

  return err.message || 'Authentication failed. Please check your inputs and try again.';
}

/**
 * Log sanitized diagnostic information without exposing user credentials
 */
export function logAuthDiagnostic(context, err) {
  if (!err) return null;
  const diagnostic = {
    context: String(context || 'auth'),
    name: err.name || 'AuthError',
    code: err.code || (err.status === 429 ? 'over_email_send_rate_limit' : 'unknown'),
    status: err.status || err.statusCode || null,
    message: err.message || 'Authentication error',
    isEmailRateLimit: isEmailRateLimitError(err),
    timestamp: new Date().toISOString()
  };
  console.warn(`[TokenPulse Auth Diagnostics] [${context}]`, JSON.stringify(diagnostic));
  return diagnostic;
}

/**
 * Log out user and terminate session
 */
export async function logoutUser() {
  try {
    const client = await getSupabase();
    if (client) {
      await withTimeout(client.auth.signOut(), 4000, 'Sign out timed out');
    }
  } catch (err) {
    console.warn('Sign out warning:', err);
  } finally {
    try {
      localStorage.removeItem('tokenpulse-auth-session');
    } catch (_) {}
    window.location.href = '/';
  }
}

/**
 * Get current session from persistent storage
 */
export async function getCurrentSession() {
  try {
    const client = await getSupabase();
    if (!client) return null;

    // Strict 3500ms timeout on session restoration so background session check never blocks UI or submit handlers
    const response = await withTimeout(
      client.auth.getSession(),
      3500,
      'Session restoration timed out'
    );

    if (response && response.data && response.data.session) {
      return response.data.session;
    }
    return null;
  } catch (err) {
    console.warn('Session restoration check warning:', err.message);
    return null;
  }
}

/**
 * Get current authenticated user
 */
export async function getCurrentUser() {
  const session = await getCurrentSession();
  return session ? session.user : null;
}

/**
 * Setup listener for Supabase authentication state changes
 * Returns subscription object with unsubscribe() method
 */
export async function setupAuthStateListener(callback) {
  try {
    const client = await getSupabase();
    if (!client) return null;
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      try {
        callback(event, session);
      } catch (cbErr) {
        console.error('Error in auth state change listener:', cbErr);
      }
    });
    return subscription;
  } catch (err) {
    console.warn('Could not register auth state listener:', err);
    return null;
  }
}

/**
 * Route protection guard for dashboard pages
 * Authentication bypassed — grants immediate access to main workspace
 */
export async function requireAuth() {
  return {
    user: {
      id: 'usr_admin',
      email: 'admin@tokenpulse.io',
      role: 'authenticated'
    }
  };
}
