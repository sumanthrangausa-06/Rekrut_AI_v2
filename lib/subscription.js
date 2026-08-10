const pool = require('./db');

/**
 * Feature Matrix: Free vs Pro tiers for Rekrut AI (Candidate-facing features)
 *
 * ┌─────────────────────┬──────────────┬─────────────────────────────┐
 * │ Feature             │ Free         │ Pro                         │
 * ├─────────────────────┼──────────────┼─────────────────────────────┤
 * │ AI job matching     │ 20 / day     │ Unlimited                   │
 * │ Mock interviews     │ 3 / month    │ Unlimited                   │
 * │ Assessments         │ Basic only   │ Advanced + OmniScore        │
 * │ Auto-apply          │ ❌           │ ✅ (10 / day)               │
 * │ CV Review           │ ❌           │ ✅                          │
 * │ LinkedIn Optimizer  │ ❌           │ ✅                          │
 * │ Career Diagnosis    │ ❌           │ ✅                          │
 * │ Recruiter Intros    │ ❌           │ ✅                          │
 * │ AI Coaching         │ Limited      │ Unlimited                   │
 * │ Top Matches         │ ❌           │ ✅                          │
 * └─────────────────────┴──────────────┴─────────────────────────────┘
 */

const FEATURE_MATRIX = {
  'ai_job_matching':     { free: { allowed: true,  limit: 20,  period: 'day'   }, pro: { allowed: true,  limit: null, period: null } },
  'mock_interviews':     { free: { allowed: true,  limit: 3,   period: 'month' }, pro: { allowed: true,  limit: null, period: null } },
  'assessments':         { free: { allowed: true,  limit: null, period: null, tier: 'basic'    }, pro: { allowed: true, limit: null, period: null, tier: 'advanced' } },
  'auto_apply':          { free: { allowed: false, limit: 0,    period: null    }, pro: { allowed: true,  limit: 10,   period: 'day'   } },
  'cv_review':           { free: { allowed: false, limit: 0,    period: null    }, pro: { allowed: true,  limit: null, period: null } },
  'linkedin_optimizer':  { free: { allowed: false, limit: 0,    period: null    }, pro: { allowed: true,  limit: null, period: null } },
  'career_diagnosis':    { free: { allowed: false, limit: 0,    period: null    }, pro: { allowed: true,  limit: null, period: null } },
  'recruiter_intros':    { free: { allowed: false, limit: 0,    period: null    }, pro: { allowed: true,  limit: null, period: null } },
  'ai_coaching':         { free: { allowed: true,  limit: 5,    period: 'day'   }, pro: { allowed: true,  limit: null, period: null } },
  'top_matches':         { free: { allowed: false, limit: 0,    period: null    }, pro: { allowed: true,  limit: null, period: null } },
};

const FEATURE_DISPLAY_NAMES = {
  'ai_job_matching':    'AI Job Matching',
  'mock_interviews':    'Mock Interviews',
  'assessments':        'Assessments',
  'auto_apply':         'Auto-Apply',
  'cv_review':          'CV Review',
  'linkedin_optimizer': 'LinkedIn Optimizer',
  'career_diagnosis':   'Career Diagnosis',
  'recruiter_intros':   'Recruiter Intros',
  'ai_coaching':        'AI Coaching',
  'top_matches':        'Top Matches',
};

/**
 * Determine the user's subscription tier from their DB record.
 * @param {object} user - User row from the database
 * @returns {'free'|'pro'}
 */
function getUserTier(user) {
  if (!user) return 'free';
  // Pro if is_paid is true AND subscription_status is active (or trialing)
  const activeStatuses = ['active', 'trialing'];
  if (user.is_paid === true || user.is_paid === 'true' || user.is_paid === 1) {
    if (activeStatuses.includes(user.subscription_status)) {
      return 'pro';
    }
  }
  return 'free';
}

/**
 * Get the current usage period key (YYYY-MM-DD for day, YYYY-MM for month)
 */
function getPeriodKey(period) {
  const now = new Date();
  if (period === 'day') {
    return now.toISOString().slice(0, 10); // YYYY-MM-DD
  }
  if (period === 'month') {
    return now.toISOString().slice(0, 7); // YYYY-MM
  }
  return null;
}

/**
 * Check if a user can access a feature, and what their usage looks like.
 *
 * @param {object} user - User row from DB (must have id, is_paid, subscription_status)
 * @param {string} feature - Feature key from FEATURE_MATRIX
 * @returns {Promise<{allowed: boolean, limit?: number|null, used?: number, remaining?: number, tier?: string, tierLevel?: 'basic'|'advanced'|null}>}
 */
async function checkFeatureAccess(user, feature) {
  const config = FEATURE_MATRIX[feature];
  if (!config) {
    return { allowed: true, limit: null, used: 0, remaining: null, tier: null, tierLevel: null };
  }

  const tier = getUserTier(user);
  const tierConfig = config[tier];

  if (!tierConfig.allowed) {
    return {
      allowed: false,
      limit: tierConfig.limit,
      used: 0,
      remaining: 0,
      tier,
      tierLevel: tierConfig.tier || null,
    };
  }

  // If unlimited
  if (tierConfig.limit === null || tierConfig.limit === undefined) {
    return {
      allowed: true,
      limit: null,
      used: 0,
      remaining: null,
      tier,
      tierLevel: tierConfig.tier || null,
    };
  }

  // Check usage from DB
  const periodKey = getPeriodKey(tierConfig.period);
  const used = await getUsage(user.id, feature, periodKey);
  const remaining = Math.max(0, tierConfig.limit - used);

  return {
    allowed: remaining > 0,
    limit: tierConfig.limit,
    used,
    remaining,
    tier,
    tierLevel: tierConfig.tier || null,
  };
}

/**
 * Get usage count for a user/feature/period.
 */
async function getUsage(userId, feature, periodKey) {
  try {
    const result = await pool.query(
      `SELECT usage_count FROM usage_limits
       WHERE user_id = $1 AND feature = $2 AND period_key = $3`,
      [userId, feature, periodKey],
    );
    return result.rows[0]?.usage_count || 0;
  } catch (err) {
    // Table may not exist yet — graceful fallback
    if (err.message?.includes('does not exist')) {
      return 0;
    }
    throw err;
  }
}

/**
 * Increment usage for a user/feature. Returns the new usage count.
 *
 * @param {number|string} userId
 * @param {string} feature
 * @returns {Promise<number>}
 */
async function incrementUsage(userId, feature) {
  const config = FEATURE_MATRIX[feature];
  if (!config) return 0;

  const tierConfig = config.free; // Use free period as default (same as pro for period)
  const periodKey = getPeriodKey(tierConfig.period || 'day');

  try {
    const result = await pool.query(
      `INSERT INTO usage_limits (user_id, feature, period_key, usage_count)
       VALUES ($1, $2, $3, 1)
       ON CONFLICT (user_id, feature, period_key)
       DO UPDATE SET usage_count = usage_limits.usage_count + 1, updated_at = NOW()
       RETURNING usage_count`,
      [userId, feature, periodKey],
    );
    return result.rows[0]?.usage_count || 1;
  } catch (err) {
    if (err.message?.includes('does not exist')) {
      console.warn('[subscription] usage_limits table does not exist — skipping usage tracking');
      return 1;
    }
    throw err;
  }
}

/**
 * Express middleware: require a feature to be accessible.
 * Use after authMiddleware.
 *
 * @param {string} feature
 * @returns {function} Express middleware
 */
function requireFeature(feature) {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
    }

    const access = await checkFeatureAccess(req.user, feature);

    if (!access.allowed) {
      return res.status(403).json({
        error: `Upgrade to Pro to access ${FEATURE_DISPLAY_NAMES[feature] || feature}`,
        code: 'UPGRADE_REQUIRED',
        feature,
        upgradeUrl: '/pricing',
      });
    }

    // Attach access info to request for downstream use
    req.featureAccess = access;
    next();
  };
}

/**
 * Get a list of all features with the user's current access status.
 *
 * @param {object} user
 * @returns {Promise<Array<{feature: string, name: string, allowed: boolean, limit?: number|null, used?: number, remaining?: number}>>}
 */
async function getUserFeatureList(user) {
	// Parallelize feature access checks instead of sequential awaits.
	// Root cause (#105): 10 sequential DB queries in a loop added 300-800ms
	// to /billing/tier on every auth flow, compounding the frontend block.
	const featureKeys = Object.entries(FEATURE_MATRIX)
	const accessResults = await Promise.all(
		featureKeys.map(async ([key, _config]) => {
			const access = await checkFeatureAccess(user, key)
			return {
				feature: key,
				name: FEATURE_DISPLAY_NAMES[key] || key,
				...access,
			}
		}),
	)
	return accessResults
}

/**
 * Get subscription tier summary for a user.
 *
 * @param {object} user
 * @returns {{tier: 'free'|'pro', isPro: boolean, plan: string|null, status: string|null}}
 */
function getTierSummary(user) {
  const tier = getUserTier(user);
  return {
    tier,
    isPro: tier === 'pro',
    plan: user?.subscription_plan || null,
    status: user?.subscription_status || 'inactive',
  };
}

module.exports = {
  FEATURE_MATRIX,
  FEATURE_DISPLAY_NAMES,
  getUserTier,
  checkFeatureAccess,
  getUsage,
  incrementUsage,
  requireFeature,
  getUserFeatureList,
  getTierSummary,
  getPeriodKey,
};
