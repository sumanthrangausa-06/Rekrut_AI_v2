/**
 * Country Configuration API
 * Public + authenticated endpoints for country data
 */
const express = require('express');
const router = express.Router();
const { authMiddleware, optionalAuth } = require('../lib/auth');
const countryConfig = require('../services/country-config');

// GET /api/countries — list all supported countries (public)
router.get('/', async (req, res) => {
  try {
    const countries = await countryConfig.getAllCountries();
    res.json({
      countries: countries.map(c => ({
        country_code: c.country_code,
        country_name: c.country_name,
        currency_code: c.currency_code,
        currency_symbol: c.currency_symbol,
        date_format: c.date_format,
        default_pay_frequency: c.default_pay_frequency,
        employment_model: c.employment_model,
        notice_period_days: c.notice_period_days,
      }))
    });
  } catch (err) {
    console.error('Error fetching countries:', err);
    res.status(500).json({ error: 'Failed to fetch countries' });
  }
});

// GET /api/countries/:code — get full country config
router.get('/:code', async (req, res) => {
  try {
    const country = await countryConfig.getCountry(req.params.code.toUpperCase());
    if (!country) {
      return res.status(404).json({ error: 'Country not found' });
    }
    res.json({ country });
  } catch (err) {
    console.error('Error fetching country:', err);
    res.status(500).json({ error: 'Failed to fetch country' });
  }
});

// GET /api/countries/:code/onboarding — get onboarding document types for a country
router.get('/:code/onboarding', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const docs = await countryConfig.getOnboardingDocs(code);
    const steps = await countryConfig.getWizardSteps(code);
    const country = await countryConfig.getCountry(code);

    if (!country) {
      return res.status(404).json({ error: 'Country not found' });
    }

    res.json({
      country_code: code,
      country_name: country.country_name,
      wizard_steps: steps,
      document_types: docs,
    });
  } catch (err) {
    console.error('Error fetching onboarding config:', err);
    res.status(500).json({ error: 'Failed to fetch onboarding configuration' });
  }
});

// GET /api/countries/:code/currency — format a currency value
router.get('/:code/currency', async (req, res) => {
  try {
    const country = await countryConfig.getCountry(req.params.code.toUpperCase());
    if (!country) {
      return res.status(404).json({ error: 'Country not found' });
    }

    const { amount, min, max } = req.query;

    if (min || max) {
      const formatted = countryConfig.formatSalaryRange(
        min ? parseFloat(min) : null,
        max ? parseFloat(max) : null,
        country.currency_code,
        country.currency_symbol
      );
      return res.json({ formatted });
    }

    if (amount) {
      const formatted = countryConfig.formatCurrency(
        parseFloat(amount),
        country.currency_code,
        country.currency_symbol
      );
      return res.json({ formatted });
    }

    res.json({
      currency_code: country.currency_code,
      currency_symbol: country.currency_symbol,
    });
  } catch (err) {
    console.error('Error formatting currency:', err);
    res.status(500).json({ error: 'Failed to format currency' });
  }
});

module.exports = router;
