---
name: frontend-design
description: "Design distinctive user-facing interfaces and avoid generic AI-generated visual patterns."
---

# Frontend Design Skill

Use this when building any user-facing UI — landing pages, dashboards, apps.

## The Problem

AI tends to generate generic "AI slop" designs:
- Inter/Roboto/Arial fonts
- Purple gradients on white backgrounds
- Predictable card layouts
- No visual personality

## The Fix

<frontend_aesthetics>
You tend to converge toward generic, "on distribution" outputs. In frontend design, this creates what users call the "AI slop" aesthetic. Avoid this: make creative, distinctive frontends that surprise and delight.

Focus on:

**Typography**
- Choose beautiful, unique, interesting fonts
- NEVER use: Inter, Roboto, Arial, system-ui, sans-serif defaults
- Try: Space Mono, Syne, Clash Display, Cabinet Grotesk, Satoshi, General Sans, Instrument Serif, Fraunces
- Mix a display font for headings with a readable body font

**Color & Theme**
- Commit to a cohesive aesthetic — don't be timid
- Dominant colors with sharp accents > evenly-distributed pastels
- Use CSS variables for consistency
- Draw from: IDE themes, film color grades, magazine layouts, cultural aesthetics
- AVOID: purple/blue gradients on white, generic SaaS blue

**Backgrounds**
- NEVER use flat white or plain solid colors
- Use: subtle gradients, noise textures, atmospheric depth, dark themes, off-white tones
- Layer elements for depth (shadows, overlapping sections, z-index play)

**Layout**
- Create visual hierarchy with intentional spacing
- Use asymmetry where appropriate
- Give elements breathing room
- Break the grid occasionally for visual interest
- AVOID: everything centered, equal spacing everywhere, cookie-cutter card grids

**Motion**
- Add purposeful micro-animations
- Hover states that feel alive
- Smooth transitions (0.2-0.3s ease)
- Subtle scroll-triggered animations
- AVOID: no motion at all, or excessive bouncy animations

**Components**
- Style form inputs distinctively (not default browser styles)
- Buttons with personality (not generic rounded rectangles)
- Custom icons or icon style consistency
- AVOID: Bootstrap/Tailwind defaults without customization
</frontend_aesthetics>

## Specific Things to NEVER Do

```
❌ font-family: Inter, sans-serif
❌ background: linear-gradient(135deg, #667eea 0%, #764ba2 100%)
❌ background: white / #ffffff / #fff
❌ border-radius: 8px on everything
❌ Generic hero with centered text + illustration on right
❌ Three-column feature cards with icons
❌ Blue primary buttons
```

## Better Alternatives

```css
/* Typography */
font-family: 'Instrument Serif', serif; /* headings */
font-family: 'Satoshi', sans-serif; /* body */

/* Backgrounds */
background: #0a0a0a; /* dark */
background: #faf9f7; /* warm off-white */
background: linear-gradient(180deg, #1a1a2e 0%, #0f0f1a 100%); /* dark gradient */

/* Colors - pick a vibe */
--accent: #ff5722; /* bold orange */
--accent: #10b981; /* fresh green */
--accent: #f59e0b; /* warm amber */

/* Shadows with color */
box-shadow: 0 4px 20px rgba(255, 87, 34, 0.15);
```

## Process

1. **Decide the vibe first** — dark/light, playful/serious, minimal/rich
2. **Pick fonts** — one display, one body (use Google Fonts)
3. **Set color palette** — 1 dominant, 1 accent, 1 background, grays
4. **Build mobile-first** — then enhance for desktop
5. **Add motion last** — subtle hovers and transitions

## Examples of Good Aesthetics

- Linear.app — dark, minimal, purposeful motion
- Vercel.com — clean but distinctive typography
- Stripe.com — layered depth, beautiful gradients
- Raycast.com — dark theme done right
- Supabase.com — bold colors, strong personality

When in doubt, look at these sites and ask: "What makes this NOT look AI-generated?"

The answer is usually: intentional typography, distinctive color choices, and attention to detail.
