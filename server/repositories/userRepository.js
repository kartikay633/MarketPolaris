// ROADMAP: Section 6, 7 & 17 — User Repository
import { query } from '../config/database.js';
import logger from '../utils/logger.js';
import { persistentMap, persist } from './localStore.js';

// In-memory fallback cache in case local Postgres container is not currently spun up
const memoryProfiles = persistentMap('profiles');
const memoryPaperAccounts = new Map();
const memoryWatchlists = new Map();

export class UserRepository {
  /**
   * Find profile by user ID
   */
  async findProfileById(userId) {
    try {
      const result = await query(
        'SELECT id, display_name, avatar_url, experience_level, interested_sectors, onboarding_completed, created_at, updated_at FROM profiles WHERE id = $1',
        [userId]
      );
      if (result.rows.length > 0) {
        return this._formatProfile(result.rows[0]);
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'Database query failed, using in-memory profile fallback');
      if (memoryProfiles.has(userId)) {
        return memoryProfiles.get(userId);
      }
    }
    return null;
  }

  /**
   * Create new profile for user
   */
  async createProfile(userId, data = {}) {
    const { displayName = '', avatarUrl = null, experienceLevel = 'beginner', interestedSectors = [], onboardingCompleted = false } = data;
    try {
      const result = await query(
        `INSERT INTO profiles (id, display_name, avatar_url, experience_level, interested_sectors, onboarding_completed)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (id) DO UPDATE SET
           display_name = COALESCE(EXCLUDED.display_name, profiles.display_name),
           updated_at = NOW()
         RETURNING *`,
        [userId, displayName, avatarUrl, experienceLevel, interestedSectors, onboardingCompleted]
      );
      return this._formatProfile(result.rows[0]);
    } catch (err) {
      logger.debug({ err: err.message }, 'Database insert failed, caching in memory');
      const profile = {
        id: userId,
        displayName,
        avatarUrl,
        experienceLevel,
        interestedSectors,
        onboardingCompleted,
        createdAt: new Date().toISOString(),
      };
      memoryProfiles.set(userId, profile);
      persist();
      return profile;
    }
  }

  /**
   * Update existing profile
   */
  async updateProfile(userId, updates = {}) {
    const fields = [];
    const values = [userId];
    let idx = 2;

    if (updates.displayName !== undefined) {
      fields.push(`display_name = $${idx++}`);
      values.push(updates.displayName);
    }
    if (updates.avatarUrl !== undefined) {
      fields.push(`avatar_url = $${idx++}`);
      values.push(updates.avatarUrl);
    }
    if (updates.experienceLevel !== undefined) {
      fields.push(`experience_level = $${idx++}`);
      values.push(updates.experienceLevel);
    }
    if (updates.interestedSectors !== undefined) {
      fields.push(`interested_sectors = $${idx++}`);
      values.push(updates.interestedSectors);
    }
    if (updates.onboardingCompleted !== undefined) {
      fields.push(`onboarding_completed = $${idx++}`);
      values.push(updates.onboardingCompleted);
    }

    if (fields.length === 0) {
      return this.findProfileById(userId);
    }

    try {
      const sql = `UPDATE profiles SET ${fields.join(', ')}, updated_at = NOW() WHERE id = $1 RETURNING *`;
      const result = await query(sql, values);
      if (result.rows.length > 0) {
        return this._formatProfile(result.rows[0]);
      }
    } catch (err) {
      logger.debug({ err: err.message }, 'Database update failed, updating in-memory profile');
      const existing = memoryProfiles.get(userId) || { id: userId };
      const updated = {
        ...existing,
        ...updates,
        updatedAt: new Date().toISOString(),
      };
      memoryProfiles.set(userId, updated);
      persist();
      return updated;
    }
  }

  /**
   * Ensure user has a paper trading account with initial 10 Lakhs (₹10,00,000)
   */
  async ensurePaperAccount(userId) {
    try {
      await query(
        `INSERT INTO paper_accounts (user_id, cash_balance)
         VALUES ($1, 1000000.00)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
    } catch (err) {
      if (!memoryPaperAccounts.has(userId)) {
        memoryPaperAccounts.set(userId, { userId, cashBalance: 1000000.00 });
      }
    }
  }

  /**
   * Ensure user has a default watchlist
   */
  async ensureDefaultWatchlist(userId) {
    try {
      await query(
        `INSERT INTO watchlists (user_id, name, position)
         VALUES ($1, 'My Watchlist', 0)
         ON CONFLICT (user_id, name) DO NOTHING`,
        [userId]
      );
    } catch (err) {
      if (!memoryWatchlists.has(userId)) {
        memoryWatchlists.set(userId, [{ name: 'My Watchlist', position: 0 }]);
      }
    }
  }

  _formatProfile(row) {
    return {
      id: row.id,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      experienceLevel: row.experience_level || 'beginner',
      interestedSectors: row.interested_sectors || [],
      onboardingCompleted: Boolean(row.onboarding_completed),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

export const userRepository = new UserRepository();
export default userRepository;
