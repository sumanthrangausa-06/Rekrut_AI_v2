STRIPE_SECRET_KEY=sk_test_...          # Add your Stripe test secret key here
STRIPE_PUBLISHABLE_KEY=pk_test_...     # Add your Stripe test publishable key here
STRIPE_WEBHOOK_SECRET=whsec_placeholder_update_me
# ^^^ Get real webhook secret from Stripe dashboard (Developers > Webhooks) or use stripe-cli
# 
# Render Environment Variables to Update:
# 1. STRIPE_SECRET_KEY → sk_test_... (from your Stripe dashboard or .env)
# 2. STRIPE_PUBLISHABLE_KEY → pk_test_... (from your Stripe dashboard or .env)
# 3. STRIPE_WEBHOOK_SECRET → Get from Stripe dashboard or stripe-cli
# 
# To get webhook secret:
# Option A: Stripe Dashboard → Developers → Webhooks → Add endpoint → Copy signing secret
# Option B: Install stripe-cli → run `stripe listen` → copy forwarding secret
