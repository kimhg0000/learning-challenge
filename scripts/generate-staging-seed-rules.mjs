#!/usr/bin/env node
// Generates firestore.staging.seed.rules — the SAME staging rules as
// firestore.staging.rules, with exactly one further change: the week-window
// check (isWithinWeekWindow) is relaxed to accept any valid week number.
//
// Why this exists: firestore.staging.rules deliberately mirrors production's
// real calendar enforcement (a week only accepts submissions during its own
// Mon-Sun window, checked against the real, non-mockable request.time) — so
// staging can genuinely test "지난 주차 차단"/"미래 주차 차단". But that same
// enforcement makes it impossible to seed a REALISTIC, already-in-the-past
// week's submission (e.g. a "week 1" test record) once real time has moved
// past that week's window, since request.time cannot be backdated for a real
// Firestore project the way tests/integration's emulator helper can fake it.
//
// The fix used here mirrors that exact emulator helper
// (tests/integration/helpers.ts setupIntegrationRules): temporarily deploy a
// rules variant with ONLY the week-window check relaxed, seed data through
// the real FirebaseBackend (so the real submitWeek()/feed-post logic is what
// creates it, not a hand-rolled reimplementation), then IMMEDIATELY restore
// the real firestore.staging.rules. This file must never be deployed except
// for that brief seeding window, and never anywhere but the staging project.
//
// Run: node scripts/generate-staging-seed-rules.mjs
// Deploy it:  firebase deploy --project staging --config firebase.staging.seed.json --only firestore:rules
// Then ALWAYS restore: firebase deploy --project staging --config firebase.staging.json --only firestore:rules,firestore:indexes,storage

import { readFileSync, writeFileSync } from 'node:fs';

const SRC = 'firestore.staging.rules';
const OUT = 'firestore.staging.seed.rules';

const staging = readFileSync(SRC, 'utf8');
const pattern = /function isWithinWeekWindow\(week\) \{[^}]*\}/;
if (!pattern.test(staging)) {
  throw new Error('isWithinWeekWindow pattern not found — firestore.staging.rules must have changed shape; update this script');
}

const seed = staging.replace(
  pattern,
  "function isWithinWeekWindow(week) { return isValidWeekNumber(week); } // *** SEED-ONLY override — see scripts/generate-staging-seed-rules.mjs. NEVER leave this deployed; restore firestore.staging.rules immediately after seeding. ***",
);

writeFileSync(OUT, seed);
console.log(`Wrote ${OUT}`);
console.log('This variant accepts a submission for ANY week number, regardless of the real calendar date.');
console.log('Deploy it ONLY to seed data, then restore immediately:');
console.log('  firebase deploy --project staging --config firebase.staging.seed.json --only firestore:rules');
console.log('  ... run the seed script ...');
console.log('  firebase deploy --project staging --config firebase.staging.json --only firestore:rules,firestore:indexes,storage');
