const test = require("node:test");
const assert = require("node:assert/strict");
const { sendEmailBatch, sendWithRetry } = require("./emailDelivery");

test("sendEmailBatch attempts every recipient when one delivery fails", async () => {
  const attempted = [];
  const errors = [];
  const result = await sendEmailBatch(
    [
      { send: async () => attempted.push("first") },
      {
        send: async () => {
          attempted.push("second");
          throw new Error("mailbox rejected");
        },
      },
      { send: async () => attempted.push("third") },
    ],
    "Schedule email",
    { error: (...args) => errors.push(args), info: () => {} },
  );

  assert.deepEqual(attempted, ["first", "second", "third"]);
  assert.deepEqual(result, { sent: 2, failed: 1 });
  assert.equal(errors.length, 1);
});

test("sendWithRetry retries temporary errors and stops after success", async () => {
  let attempts = 0;
  const result = await sendWithRetry(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        const error = new Error("temporary SMTP failure");
        error.code = "ECONNECTION";
        throw error;
      }
      return "accepted";
    },
    { delayMs: 0 },
  );

  assert.equal(result, "accepted");
  assert.equal(attempts, 3);
});

test("sendWithRetry does not retry permanent SMTP errors", async () => {
  let attempts = 0;
  await assert.rejects(
    sendWithRetry(
      async () => {
        attempts += 1;
        const error = new Error("authentication rejected");
        error.responseCode = 535;
        throw error;
      },
      { delayMs: 0 },
    ),
    /authentication rejected/,
  );
  assert.equal(attempts, 1);
});
