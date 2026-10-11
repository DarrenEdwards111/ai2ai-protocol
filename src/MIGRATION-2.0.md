# AI2AI wire profile 1.1 — security migration

This document supersedes conflicting wire/security examples in SPEC.md, PROTOCOL.md and older documentation. Package 2.0.0 introduces this breaking wire change; it is not a security certification.

## Wire rules
- All peers MUST send `ai2ai: "1.1"`. Versions 0.1/1.0 are rejected; there is no downgrade fallback.
- Sender, recipient, UUID message ID, UUID conversation ID, supported type, object payload, boolean approval flag, 32-hex-character nonce, timestamp, expiry and signature are required. Requests require a nonempty intent.
- Recipient must equal the local agent name. Group senders create separately addressed signed envelopes.
- Timestamp/expiry use UTC ISO strings with milliseconds (`YYYY-MM-DDTHH:mm:ss.sssZ`). Timestamp may be at most five minutes in the future. Maximum message lifetime/age defaults to 24 hours; expiry must be after timestamp and after receipt time.
- Sign EVERY top-level field except `signature`, including unknown extension fields, using Ed25519. Canonical encoding recursively sorts object keys using JavaScript UTF-16 lexical ordering, preserves array order, and JSON-encodes primitive values (finite IEEE-754 numbers only). UTF-8 bytes are signed. No undefined/non-JSON values. This is a project-defined encoding, not a claim of RFC 8785 compliance. Other languages must match these rules.
- Public keys must be provisioned through a trusted local contact configuration. Unknown keys and missing/invalid signatures are rejected before any application event or history write. Existing unsigned discovery is not sufficient proof of identity. Deploy HTTPS with normal certificate verification for network transport.
- Encrypt before signing. Verify ciphertext envelope before decrypting. Never fall back to an older signature layout.

## Application and approval contract
The main library emits `approval:required` for messages/requests that require approval. Requests from non-trusted contacts and commerce requests require approval. The normal `message`/`request` events are not emitted until local `resolveApproval(id, true)` is called. `false` rejects; strings are not accepted by this API. Pending requests survive restart. The integration parser recognises explicit affirmative replies only; ambiguous text stays pending. A negative phrase is never an affirmative decision.

Do not execute a message in an `approval:required` listener. Human approval is not a substitute for signature verification. Contact keys must be reconfigured after process restart (the main library contact map remains in memory).

## Retry/replay contract
Authenticated messages are reserved on disk before dispatch. Same sender + same message ID + identical signed content returns the stored receipt without redispatch. Reusing a message ID with different content or a nonce with a different message is rejected. Expired requests are still rejected, even if previously received. A crash during dispatch may leave `processing`; operators must reconcile that state, not blindly resend with a new ID. This prevents automatic re-execution but does not promise transactional exactly-once external effects. One receiver process must own each inbox directory. Inbox records currently require operator-managed retention; do not delete records within the accepted message lifetime.

## Deployment
1. Upgrade both peers together; no service is restarted by this patch.
2. Configure each peer's expected agent name and independently verified public keys.
3. Regenerate old queued messages under 1.1 only after reviewing their intended effects; old signed envelopes will be rejected.
4. Connect explicit approval UI/API and test before allowing side-effectful listeners.
5. Run `node --test tests/security.test.js` from the repository root. `src/test-v1.js` exercises additional features. The historical `src/test.js` contains old wire fixtures and live-state assumptions; it is not the 1.1 conformance suite.

The nested `repo` gitlink is a separate checkout and is not a second deployment target modified by this patch. Deploy from this checkout's `src` and `cli` directories.
