/**
 * Signing out ends the session the browser was holding.
 *
 * Two things outlived it. The file tree kept whatever had been imported, which
 * on a shared machine is the next person's view of a private repository. And
 * report history falls back to an anonymous id when there is no account, so a
 * browser that kept the same id went on listing the reports of whoever had
 * just left.
 *
 * Neither is a server-side deletion: those reports stay under that account and
 * come back when it signs in. These cover what this browser stops holding.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import "./helpers/window.ts";

import { resetVisitorId, visitorId } from "../lib/visitor.ts";

const VISITOR_KEY = "monsmith.visitor";

beforeEach(() => {
    window.localStorage.removeItem(VISITOR_KEY);
});

test("an anonymous id is stable while the session lasts", () => {
    const first = visitorId();
    assert.equal(visitorId(), first);
    assert.ok(first.length > 0);
});

test("signing out starts a new identity", () => {
    const before = visitorId();
    const after = resetVisitorId();

    assert.notEqual(after, before);
    // Written through, not just returned: the next read is the new one, which
    // is what stops the history request asking for the old session's reports.
    assert.equal(visitorId(), after);
});

test("the new identity persists rather than regenerating per call", () => {
    resetVisitorId();
    assert.equal(visitorId(), visitorId());
});
