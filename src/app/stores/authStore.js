// ROADMAP: Section 5 & Phase 1 — Auth Store (Zustand)
// Two ways in: a real Supabase account (email/password or Google), or an explicit guest session
// kept on this device. A wrong password is always an error; nobody is signed in silently.
import { create } from 'zustand';
import { supabase } from '../services/supabase';
import api from '../services/api';

const LOCAL_KEY = 'market_pulse_user';

const nameFor = (user) => user?.user_metadata?.display_name || user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Guest';

// A guest (or locally edited) profile saved on this device only.
function localSession(user) {
  return {
    user,
    session: { access_token: 'local_token', user },
    profile: {
      id: user.id,
      email: user.email || null,
      displayName: nameFor(user),
      full_name: nameFor(user),
      experienceLevel: 'intermediate',
      onboardingCompleted: true,
      isGuest: Boolean(user.guest),
    },
    isAuthenticated: true,
  };
}

function readLocalUser() {
  try {
    const saved = JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
    return saved?.id ? saved : null;
  } catch {
    localStorage.removeItem(LOCAL_KEY);
    return null;
  }
}

// Supabase answers wrong credentials with an auth error; a network failure means the service is unreachable.
const friendly = (err, fallback) => {
  const msg = err?.message || fallback;
  return /fetch|network|failed to fetch|load failed/i.test(msg)
    ? 'The sign-in service is unreachable right now. Try again, or continue as a guest.'
    : msg;
};

export const useAuthStore = create((set, get) => ({
  user: null,
  session: null,
  profile: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  // Restore a Supabase session or a saved guest session; otherwise the user is signed out.
  initialize: async () => {
    try {
      set({ isLoading: true, error: null });

      // Handle OAuth PKCE callback if code is in URL search params
      const code = new URLSearchParams(window.location.search).get('code');
      if (code) {
        try {
          const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            console.warn('OAuth code exchange warning in initialize:', exchangeError.message);
          } else if (data?.session) {
            set({ user: data.session.user, session: data.session, isAuthenticated: true });
            await get().fetchProfile();
            window.history.replaceState({}, document.title, window.location.pathname);
            return;
          }
        } catch (exchangeErr) {
          console.warn('Code exchange caught error in initialize:', exchangeErr);
        }
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        set({ user: session.user, session, isAuthenticated: true });
        await get().fetchProfile();
      } else {
        const saved = readLocalUser();
        if (saved) set(localSession(saved));
      }

      // Listen for auth changes (token refresh, sign in, sign out)
      supabase.auth.onAuthStateChange(async (event, newSession) => {
        if (newSession?.user) {
          set({ user: newSession.user, session: newSession, isAuthenticated: true });
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') await get().fetchProfile();
        } else if (event === 'SIGNED_OUT' && !get().profile?.isGuest) {
          set({ user: null, session: null, profile: null, isAuthenticated: false });
        }
      });
    } catch (err) {
      console.error('Failed to initialize auth store:', err);
      // The sign-in service is unreachable: a saved guest session still works.
      const saved = readLocalUser();
      if (saved) set(localSession(saved));
    } finally {
      set({ isLoading: false });
    }
  },

  // Email/Password login (Supabase verifies the password)
  login: async (email, password) => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      localStorage.removeItem(LOCAL_KEY);
      set({ user: data.user, session: data.session, isAuthenticated: true });
      await get().fetchProfile();
      return { success: true, user: data.user };
    } catch (err) {
      const msg = friendly(err, 'Failed to sign in');
      set({ error: msg });
      return { success: false, error: msg };
    } finally {
      set({ isLoading: false });
    }
  },

  // Email/Password signup
  signup: async (email, password, displayName) => {
    set({ isLoading: true, error: null });
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName } },
      });
      if (error) throw error;
      if (data.session) {
        localStorage.removeItem(LOCAL_KEY);
        set({ user: data.user, session: data.session, isAuthenticated: true });
        await get().fetchProfile();
      }
      return { success: true, user: data.user, session: data.session };
    } catch (err) {
      const msg = friendly(err, 'Failed to sign up');
      set({ error: msg });
      return { success: false, error: msg };
    } finally {
      set({ isLoading: false });
    }
  },

  // Google OAuth Login
  loginWithGoogle: async () => {
    try {
      set({ isLoading: true, error: null });
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          queryParams: { access_type: 'offline', prompt: 'select_account' },
        },
      });
      if (error) throw error;
      return data;
    } catch (err) {
      set({ error: friendly(err, 'Google sign-in failed'), isLoading: false });
      throw err;
    }
  },

  // Guest session on this device: paper trading, watchlist and alerts without an account.
  continueAsGuest: () => {
    const guest = { id: 'guest', guest: true, email: null, user_metadata: { display_name: 'Guest' } };
    localStorage.setItem(LOCAL_KEY, JSON.stringify(guest));
    set({ ...localSession(guest), isLoading: false, error: null });
    return { success: true };
  },
  loginAsDemo: () => get().continueAsGuest(),

  // Logout
  logout: async () => {
    set({ isLoading: true });
    try {
      localStorage.removeItem(LOCAL_KEY);
      await supabase.auth.signOut();
    } catch (err) {
      console.error('Error logging out:', err);
    } finally {
      set({ user: null, session: null, profile: null, isAuthenticated: false, error: null, isLoading: false });
    }
  },

  // Fetch user profile from backend
  fetchProfile: async () => {
    try {
      const res = await api.get('/user/profile');
      if (res.data?.profile) set({ profile: res.data.profile });
      return res.data?.profile;
    } catch (err) {
      console.warn('Could not fetch user profile from server:', err.message);
      // Fallback profile from user metadata if backend profile not yet ready
      const currentUser = get().user;
      if (currentUser && !get().profile) {
        set({
          profile: {
            id: currentUser.id,
            email: currentUser.email,
            displayName: nameFor(currentUser),
            experienceLevel: 'beginner',
            interestedSectors: [],
            onboardingCompleted: false,
          },
        });
      }
      return null;
    }
  },

  // Update user profile (e.g. after onboarding or settings edit)
  updateProfile: async (updates) => {
    try {
      const currentUser = get().user || {};
      const newEmail = updates.email || currentUser.email || null;
      const newName = updates.displayName || updates.display_name || updates.full_name || nameFor(currentUser);
      const updatedUser = {
        ...currentUser,
        email: newEmail,
        user_metadata: { ...(currentUser.user_metadata || {}), display_name: newName, full_name: newName },
      };
      const updatedProfile = { ...(get().profile || {}), ...updates, email: newEmail, displayName: newName, full_name: newName };

      // A guest's profile lives on this device; an account's is saved on the server.
      if (get().profile?.isGuest || get().session?.access_token === 'local_token') localStorage.setItem(LOCAL_KEY, JSON.stringify(updatedUser));
      set({ user: updatedUser, profile: updatedProfile });

      try {
        const res = await api.patch('/user/profile', updates);
        if (res.data?.profile) set({ profile: { ...updatedProfile, ...res.data.profile } });
      } catch (_) {}

      return { success: true, profile: updatedProfile };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
}));

export default useAuthStore;
