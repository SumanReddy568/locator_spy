## [1.4.5] - 2026-06-13
- feat(recorder): AI-powered Intelligent Recorder Add Generate with AI to the recorder: send the recorded step sequence to the worker (/ai/recorder) and render a production-quality test — idiomatic code with smart waits, robust/self-healing locators, auto-inferred assertions, a descriptive test name, and plain-English step labels. Template codegen stays as the instant default; the AI result auto-invalidates when steps or framework change. - ailocservice.js: generateAiTestCode() (free-credits-first / BYO-key, caching, transparent exhaustion fallback) + recorder-v1.txt prompt. - panel: AI button, loading state, AI badge + test name, per-step annotations, free-credit chip in the recorder. - Rename Recorder → Intelligent Recorder, remove Beta everywhere. - AI caveat strip in both recorder and locator views: AI can make mistakes + free-credit latency note + BYOK nudge (opens AI settings). - analytics: recorder_ai_started/generated/failed + byok_cta_clicked, on both the log-push and user-event channels. Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>

## [1.4.4] - 2026-05-16
- new worker migration

## [1.4.3] - 2026-05-10
- feat: recorder (beta), framework codegen, unified banner stack Adds an in-panel Recorder view that captures clicks, typing, selects, and scrolls and exports them as paste-ready Selenium / Playwright / Cypress / WebdriverIO code (Java, Python, JavaScript, TypeScript). Adds a Copy as dropdown so single locators can also be wrapped in framework code. Folds all eligibility-driven banners into one stack at the top so the panel no longer has banners scattered above and below the controls. Reuses the existing feedback collector with a feature tag for recorder feedback, emits analytics events for each recorder lifecycle step, and dedupes the duplicate XPath rows that v1 and v2 both produced for anchor elements. Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

## [1.4.2] - 2026-05-08
- fix: gate role-name candidates and correct xpath emitter Skip role/accessible-name candidates when no emitter can render them (css/xpath

## [1.4.1] - 2026-05-06
- fix: update analytics and service files

## [1.4.0] - 2026-05-01
- enhancements: chacing and key stoarge aspects

## [1.3.9] - 2026-04-30
- feat: v2 locator engine, redesigned DevTools UI, and store assets * New v2 anchor-first locator engine (locator_engine_v2.js) with stability-scored candidate search, runtime engine switcher (v1/v2), and additional emitters: XPath by ID/Name/data-testid/aria-label/ placeholder/partial text plus CSS-by-attribute-pair. * DevTools panel redesigned with an editorial dev-console aesthetic (Instrument Serif + Geist + JetBrains Mono, warm-paper / inky-dark themes, moss-chartreuse accent). Subgrid-aligned locator rows, PRIMARY row treatment, real iOS-style toggle switches, hover-revealed actions, and validation states surfaced via :has(). * Auth pages (login, signup) and logout modal redesigned to match. Dropped FontAwesome CDN; eye/lock/envelope/spinner icons now render via inline SVG masks while preserving the fa-eye/fa-eye-slash class toggle that auth.js drives. * Removed the in-page Best Locator banner feature and all related state, message handlers, storage keys, and CSS. * Auto-validator now also covers XPath by Class Name + Tag Name so every rendered row gets a validation result. * Locator count in the section subtitle now reflects the rows actually rendered (previously a constant Object.keys count). * Five 1280x800 Chrome Web Store screenshots added under store_assets/screenshots/ (24-bit RGB JPEG, no alpha). Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>

## [1.3.8] - 2026-03-30
- feat: implement popup UI for locator management and integrate feedback service gating

## [1.3.7] - 2026-02-25
- Enhance UI with new gradients, improved layout, and added section titles for better clarity. Introduce visual indicators for the best locator and update related JavaScript functionality for dynamic content updates.

## [1.3.6] - 2026-02-22
- Refactor logging to use centralized lifecycle events and remove direct logger calls in background, content, and devtools scripts. Introduce `sendLifecycleEvent` for improved analytics tracking.

## [1.3.5] - 2026-01-23
- disable log push

## [1.3.4] - 2026-01-15
- Bump version to 1.3.3 in manifest.json

## [1.3.2] - 2026-01-15
- Bump version to 1.3.1 in manifest.json

## [1.3.0] - 2026-01-12
- Refactor logging in content script to use centralized logger and add analytics utility

## [1.2.9] - 2026-01-10
- log line remove

## [1.2.8] - 2026-01-10
- add log push events

## [1.2.7] - 2026-01-10
- add log end point changes

## [1.2.6] - 2026-01-04
- feat: Enhance authentication storage and analytics tracking with user ID support

## [1.2.6] - 2026-01-04
- feat: Update authentication and analytics tracking with user info retrieval and version bump to 1.2.5

## [1.2.3] - 2025-12-20
- feat: Add AI-powered locator generation service and its initial prompt definition.

## [1.2.2] - 2025-12-18
- fix: downgrade version to 1.2.1 and enhance analytics tracking with updated metadata structure

## [1.2.2] - 2025-12-18
- fix: downgrade version to 1.2.1 and update panel.js to use module type for script; enhance analytics tracking for locator mode, AI settings, and toggle actions

## [1.2.2] - 2025-12-18
- feat: Introduce analytics tracking for extension lifecycle and locator actions, and add new devtools panel and popup.

## [1.2.1] - 2025-12-17
- feat: Add initial DevTools panel UI for Locator Spy with AI settings and locator generation features.

## [1.2.0] - 2025-12-16
- feat: Add initial Locator Spy devtools panel with UI, styling, and logic.

## [1.1.9] - 2025-12-13
- feat: Update extension name to Locator Finder: AI Powered and set version to 1.1.8

## [1.1.9] - 2025-12-13
- docs: update manifest description to reflect AI capabilities.

## [1.1.8] - 2025-12-13
- feat: Extract AI locator generation to a new service, update AI model options, and refine UI elements.

## [1.1.7] - 2025-12-12
- feat: Introduce AI-powered locator generation, refactor existing logic, and update UI assets and icons.

## [1.1.6] - 2025-11-30
- new fix

## [1.1.5] - 2025-10-27
- new banner

## [1.1.4] - 2025-05-11
- auto locator error fix

## [1.1.3] - 2025-04-26
- version bump

## [1.1.4] - 2025-04-26
- Merge branch master of https://github.com/SumanReddy568/locator_spy

## [1.1.3] - 2025-04-26
- version bump for 1.1.3

## [1.1.3] - 2025-04-26
- new fix

## [1.1.3] - 2025-04-26
- master sync

## [1.1.2] - 2025-04-19
- zipper fix

## [1.1.1] - 2025-04-11
- hover click deactivation fix in old extesnion 1.1.0

## [1.1.0] - 2025-04-10
- new perfomace feature

## [1.0.9] - 2025-04-08
- zipper changes

## [1.0.9] - 2025-04-08
- new enhancement, adding best locator changes

## [1.0.9] - 2025-04-04
- new changes

## [1.1.0] - 2025-04-04
- zipper change

## [1.0.9] - 2025-04-04
- readme.d changes

## [1.0.8] - 2025-04-04
- zippeee new changes

## [1.0.9] - 2025-04-04
- zipper backlog ext change

## [1.0.9] - 2025-04-04
- zipper fix

## [1.0.9] - 2025-04-04
- pop up humburger fix, and service worker enhancements

## [1.0.8] - 2025-04-03
- final

## [1.0.9] - 2025-04-03
- del

## [1.0.8] - 2025-04-03
- version bump

## [1.0.8] - 2025-04-03
- final fix for 1.0.8

## [1.0.1] - 2025-04-03
- verion fix in pop up

## [1.0.8] - 2025-04-03
- Merge branch master of https://github.com/SumanReddy568/locator_spy

## [1.0.9] - 2025-04-03
- pop up changes sed change

## [1.0.8] - 2025-04-03
- pop up changes sed change

## [1.0.8] - 2025-04-03
- pop up changes

## [1.0.8] - 2025-04-03
- pop up changes

## [1.0.8] - 2025-04-03
- version bump

## [1.0.9] - 2025-04-03
- service worker fix

## [1.0.7] - 2025-03-30
- Merge pull request #7 from SumanReddy568/enhace_ziper Enhace ziper

## [1.0.8] - 2025-03-30
- Merge pull request #6 from SumanReddy568/enhace_ziper zipeer change

## [1.0.7] - 2025-03-29
- pannel headder update

## [1.0.6] - 2025-03-29
- Merge pull request #5 from SumanReddy568/loc_acc_imp improved xpath accuracy

## [1.0.5] - 2025-03-29
- Merge pull request #4 from SumanReddy568/dev2 acuracy improve

## [1.0.4] - 2025-03-29
- Merge pull request #2 from SumanReddy568/develop1 added change log file mainatence and fixed version update in pannel.html

# Changelog

All notable changes to this project will be documented in this file.

