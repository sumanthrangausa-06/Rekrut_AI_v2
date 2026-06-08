# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: mobile-navigation.spec.ts >> Mobile Navigation — Recruiter Dashboard >> Escape key closes sidebar on mobile
- Location: e2e/mobile-navigation.spec.ts:112:7

# Error details

```
Error: locator.click: Target page, context or browser has been closed
Call log:
  - waiting for getByRole('button', { name: 'Open navigation menu' })

```

```
Error: browserContext.close: Target page, context or browser has been closed
```