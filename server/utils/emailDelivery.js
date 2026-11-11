const RETRYABLE_CODES = new Set([
  "ECONNECTION",
  "ECONNRESET",
  "ESOCKET",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

const isRetryableEmailError = (error) =>
  RETRYABLE_CODES.has(error?.code) ||
  (Number(error?.responseCode) >= 400 && Number(error?.responseCode) < 500);

const sendWithRetry = async (send, { attempts = 3, delayMs = 500 } = {}) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await send();
    } catch (error) {
      if (attempt >= attempts || !isRetryableEmailError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
};

const sendEmailBatch = async (deliveries, context, logger = console) => {
  const results = await Promise.allSettled(
    deliveries.map(({ send }) => Promise.resolve().then(send)),
  );
  let sent = 0;
  let failed = 0;

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      sent += 1;
      return;
    }
    failed += 1;
    logger.error(
      `${context} failed for recipient ${index + 1}:`,
      result.reason?.message ?? result.reason,
      result.reason?.code ?? "",
    );
  });

  if (deliveries.length) {
    logger.info(`${context}: ${sent} accepted, ${failed} failed.`);
  }
  return { sent, failed };
};

module.exports = { sendEmailBatch, sendWithRetry };
