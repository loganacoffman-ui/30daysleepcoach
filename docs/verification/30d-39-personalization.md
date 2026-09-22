# 30D-39 — current life context

## Implemented

Chat receives up to 40 authenticated user messages from the previous 30 days across conversations, newest first, bounded to 20,000 content characters. Each carries an ID and original timestamp. This direct read bridges asynchronous semantic-memory indexing. Assistant suggestions are excluded from direct user reports. Shared instructions distinguish current facts, explicit corrections, resolved events and uncertain history, and require context to influence the actual action.

Daily advice receives the same direct reports. Reports enter its source fingerprint and post-generation recheck, so new conversation context can invalidate the cached daily recommendation. If direct reports cannot load, daily generation fails recoverably rather than using stale context. Chat can still use the current conversation but omits semantic recall when direct corrections cannot be checked.

Mem0 extraction instructions preserve changes and resolved status; retrieved memory formatting retains provenance/timestamps where present. No schema or provider changes. No replacement memory store.

## Validation and limits

Automated tests cover user-scoped reads, timestamp filtering, bounds, newest-first ordering, exclusion of assistant assumptions, storage failure, context cache invalidation and delimiter escaping. Existing app and endpoint regression tests remain applicable.

These are deterministic plumbing checks, not proof of improved model responses. The model still interprets conflicts and event status. Direct coverage is limited to 40 reports/30 days; older context relies on Mem0. Provider temporal update behavior, correction quality, vendor terms and physical-device restoration remain to be verified. No real-user content or live provider calls were used for these tests.

Before accepting model quality, use synthetic paired conversations: night-to-day work change; triathlon preparation then race completion; deadline stress then project completion; an impractical experiment followed by a user correction. Check both current chat and a new conversation, and inspect the actual recommendation rather than only a reference to the fact. Record outputs with the 30D-49 evaluation rubric. Restore/account-switch device checks stay with 30D-27; vendor/disclosure evidence stays with 30D-26.
