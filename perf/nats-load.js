#!/usr/bin/env node
//
// NATS/JetStream load test
//
// Exercises the publish/consume paths that the Winzy services use:
//   - Publishes messages to each JetStream stream (USERS, HABITS, FRIENDS, CHALLENGES)
//   - Creates ephemeral consumers and measures consume latency
//   - Tests consumer retry behavior (NAK + redeliver)
//
// Usage:
//   node perf/nats-load.js
//   NATS_URL=nats://localhost:4222 node perf/nats-load.js
//
// Requires: npm install nats (run from perf/ or project root)
//
// Exit code: 0 = pass, 1 = threshold breach

const { connect, JSONCodec, AckPolicy, DeliverPolicy } = require('nats');

const NATS_URL = process.env.NATS_URL || 'nats://localhost:4222';
const MESSAGE_COUNT = parseInt(process.env.NATS_MSG_COUNT || '100', 10);
const CONSUMER_TIMEOUT_MS = parseInt(process.env.NATS_CONSUMER_TIMEOUT || '10000', 10);

// Thresholds
const THRESHOLDS = {
  publishP95Ms: 50,       // p95 publish latency under 50ms
  consumeP95Ms: 200,      // p95 consume latency under 200ms
  publishErrorRate: 0.01, // < 1% publish errors
  consumeLossRate: 0.02,  // < 2% message loss
};

const jc = JSONCodec();

// Streams matching JetStreamSetup.cs
const STREAMS = [
  { name: 'USERS', subjects: ['user.>'], testSubject: 'user.registered' },
  { name: 'HABITS', subjects: ['habit.>'], testSubject: 'habit.created' },
  { name: 'FRIENDS', subjects: ['friend.>'], testSubject: 'friend.request.sent' },
  { name: 'CHALLENGES', subjects: ['challenge.>'], testSubject: 'challenge.created' },
];

function percentile(sorted, p) {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(latencies) {
  if (latencies.length === 0) return { min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
  const sorted = [...latencies].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    min: sorted[0],
    max: sorted[sorted.length - 1],
    avg: (sum / sorted.length).toFixed(2),
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
  };
}

async function ensureStreams(jsm) {
  for (const s of STREAMS) {
    try {
      await jsm.streams.add({ name: s.name, subjects: s.subjects });
    } catch (e) {
      // Stream may already exist (created by services) — update instead
      try {
        await jsm.streams.update(s.name, { subjects: s.subjects });
      } catch {
        // Already exists with correct config — fine
      }
    }
  }
}

async function publishLoadTest(js, stream) {
  const latencies = [];
  let errors = 0;

  for (let i = 0; i < MESSAGE_COUNT; i++) {
    const payload = { userId: `perf-${i}`, timestamp: Date.now(), seq: i };
    const start = performance.now();
    try {
      await js.publish(stream.testSubject, jc.encode(payload));
      latencies.push(performance.now() - start);
    } catch (e) {
      errors++;
    }
  }

  return { latencies, errors, total: MESSAGE_COUNT };
}

async function consumeLoadTest(js, jsm, stream, expectedCount) {
  // Create an ephemeral consumer for this test run
  const consumerName = `perf-consumer-${stream.name.toLowerCase()}-${Date.now()}`;

  await jsm.consumers.add(stream.name, {
    durable_name: consumerName,
    filter_subject: stream.testSubject,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.All,
  });

  const consumer = await js.consumers.get(stream.name, consumerName);
  const latencies = [];
  let received = 0;

  const messages = await consumer.consume();
  const deadline = Date.now() + CONSUMER_TIMEOUT_MS;

  for await (const msg of messages) {
    const data = jc.decode(msg.data);
    // Measure time from publish timestamp to now (approximate end-to-end)
    if (data.timestamp) {
      latencies.push(Date.now() - data.timestamp);
    }
    msg.ack();
    received++;

    if (received >= expectedCount || Date.now() > deadline) {
      break;
    }
  }

  // Cleanup ephemeral consumer
  try {
    await jsm.consumers.delete(stream.name, consumerName);
  } catch { /* best effort */ }

  return { latencies, received, expected: expectedCount };
}

async function nakRetryTest(js, jsm, stream) {
  // Publish one message, NAK it, verify redelivery
  const subject = `${stream.testSubject}`;
  const consumerName = `perf-nak-test-${Date.now()}`;

  // Purge stream to isolate test
  try { await jsm.streams.purge(stream.name, { filter: subject }); } catch { /* ok */ }

  await js.publish(subject, jc.encode({ test: 'nak-retry', ts: Date.now() }));

  await jsm.consumers.add(stream.name, {
    durable_name: consumerName,
    filter_subject: subject,
    ack_policy: AckPolicy.Explicit,
    deliver_policy: DeliverPolicy.Last,
    max_deliver: 3,
  });

  const consumer = await js.consumers.get(stream.name, consumerName);
  let deliveries = 0;

  const messages = await consumer.consume();
  const deadline = Date.now() + 8000; // 8s timeout

  for await (const msg of messages) {
    deliveries++;
    if (deliveries < 2) {
      // NAK first delivery to trigger retry
      msg.nak(1000); // 1s delay
    } else {
      msg.ack();
      break;
    }
    if (Date.now() > deadline) break;
  }

  try { await jsm.consumers.delete(stream.name, consumerName); } catch { /* ok */ }

  return { deliveries, success: deliveries >= 2 };
}

async function run() {
  console.log(`\n=== NATS/JetStream Load Test ===`);
  console.log(`URL: ${NATS_URL}`);
  console.log(`Messages per stream: ${MESSAGE_COUNT}`);
  console.log();

  const nc = await connect({ servers: NATS_URL });
  const jsm = await nc.jetstreamManager();
  const js = nc.jetstream();

  await ensureStreams(jsm);

  const results = {};
  let failed = false;

  // ── Publish load test ──────────────────────────────────────
  console.log('--- Publish Load Test ---');
  for (const stream of STREAMS) {
    // Purge before test to get clean consume counts
    try { await jsm.streams.purge(stream.name); } catch { /* ok */ }

    const pub = await publishLoadTest(js, stream);
    const pubStats = stats(pub.latencies);
    results[`publish_${stream.name}`] = { ...pubStats, errors: pub.errors, total: pub.total };

    console.log(`  ${stream.name} (${stream.testSubject}):`);
    console.log(`    Published: ${pub.total - pub.errors}/${pub.total} | Errors: ${pub.errors}`);
    console.log(`    Latency: avg=${pubStats.avg}ms p50=${pubStats.p50.toFixed(2)}ms p95=${pubStats.p95.toFixed(2)}ms p99=${pubStats.p99.toFixed(2)}ms`);

    if (pubStats.p95 > THRESHOLDS.publishP95Ms) {
      console.log(`    FAIL: p95 ${pubStats.p95.toFixed(2)}ms > threshold ${THRESHOLDS.publishP95Ms}ms`);
      failed = true;
    }
    if (pub.errors / pub.total > THRESHOLDS.publishErrorRate) {
      console.log(`    FAIL: error rate ${(pub.errors / pub.total * 100).toFixed(1)}% > threshold ${THRESHOLDS.publishErrorRate * 100}%`);
      failed = true;
    }
  }

  // ── Consume load test ──────────────────────────────────────
  console.log('\n--- Consume Load Test ---');
  for (const stream of STREAMS) {
    const con = await consumeLoadTest(js, jsm, stream, MESSAGE_COUNT);
    const conStats = stats(con.latencies);
    results[`consume_${stream.name}`] = { ...conStats, received: con.received, expected: con.expected };

    const lossRate = 1 - (con.received / con.expected);
    console.log(`  ${stream.name} (${stream.testSubject}):`);
    console.log(`    Consumed: ${con.received}/${con.expected} | Loss: ${(lossRate * 100).toFixed(1)}%`);
    console.log(`    E2E Latency: avg=${conStats.avg}ms p50=${conStats.p50}ms p95=${conStats.p95}ms p99=${conStats.p99}ms`);

    if (conStats.p95 > THRESHOLDS.consumeP95Ms) {
      console.log(`    FAIL: p95 ${conStats.p95}ms > threshold ${THRESHOLDS.consumeP95Ms}ms`);
      failed = true;
    }
    if (lossRate > THRESHOLDS.consumeLossRate) {
      console.log(`    FAIL: loss rate ${(lossRate * 100).toFixed(1)}% > threshold ${THRESHOLDS.consumeLossRate * 100}%`);
      failed = true;
    }
  }

  // ── NAK/retry test ─────────────────────────────────────────
  console.log('\n--- NAK/Retry Test ---');
  // Use USERS stream for retry test
  const nakResult = await nakRetryTest(js, jsm, STREAMS[0]);
  console.log(`  USERS stream: deliveries=${nakResult.deliveries} success=${nakResult.success}`);
  if (!nakResult.success) {
    console.log('  FAIL: NAK retry did not trigger redelivery');
    failed = true;
  }

  // ── Summary ────────────────────────────────────────────────
  console.log('\n=== Thresholds ===');
  console.log(`  Publish p95 < ${THRESHOLDS.publishP95Ms}ms`);
  console.log(`  Consume p95 < ${THRESHOLDS.consumeP95Ms}ms`);
  console.log(`  Publish error rate < ${THRESHOLDS.publishErrorRate * 100}%`);
  console.log(`  Consume loss rate < ${THRESHOLDS.consumeLossRate * 100}%`);
  console.log(`\n=== Result: ${failed ? 'FAIL' : 'PASS'} ===\n`);

  await nc.drain();
  process.exit(failed ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
