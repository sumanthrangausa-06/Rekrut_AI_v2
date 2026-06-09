## Task ID: TASK-001
## Title: Image Audit — Add DiceBear/Unsplash Assets to Key Pages
## Created: 2026-06-08
## Created By: kimiclaw

### Status
- [x] In Progress

### Assigned To
- Primary: kimiclaw

### Description
Replace text-based avatars and placeholders with DiceBear (for user avatars) and Unsplash (for hero/marketing images) across key pages.

### Target Pages
1. Landing page — hero section needs real image
2. Landing page — testimonials need avatar images
3. Candidate/Recruiter profiles — use DiceBear avatars
4. Settings page — avatar upload fallback to DiceBear

### Acceptance Criteria
- [ ] DiceBear avatar component created
- [ ] Landing page uses Unsplash hero image
- [ ] Testimonials use DiceBear avatars (not initials)
- [ ] Profile pages use DiceBear as default avatar
- [ ] Settings page avatar has DiceBear fallback

### Notes
- DiceBear API: https://api.dicebear.com/7.x/avataaars/svg?seed={userId}
- Unsplash: Use source.unsplash.com or specific photo IDs
- Keep existing upload functionality — DiceBear is fallback only

### Progress Log
- [2026-06-08 17:30] kimiclaw — Started image audit, checking current avatar usage
- [2026-06-08 17:35] kimiclaw — Created DiceBear avatar utility (`lib/avatar.ts`) with Unsplash image URLs
- [2026-06-08 17:37] kimiclaw — Updated Avatar component to support DiceBear fallback (seed + useDiceBear props)
- [2026-06-08 17:38] kimiclaw — Updated header.tsx to use DiceBear avatar with user email as seed
- [2026-06-08 17:39] kimiclaw — Updated candidate-card.tsx to use DiceBear fallback via AvatarImage fallbackSrc
- [2026-06-08 17:40] kimiclaw — Updated landing page testimonials to use Unsplash real images
- [2026-06-08 17:41] kimiclaw — Updated about page founders to use DiceBear avatars
- [2026-06-08 17:42] kimiclaw — TypeScript check passes (tsc --noEmit clean)
- [2026-06-08 17:43] kimiclaw — Pushing changes to dev branch
