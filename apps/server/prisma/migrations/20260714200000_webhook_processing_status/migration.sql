-- Add a "processing" state used to atomically claim a webhook event (idempotency).
ALTER TYPE "WebhookStatus" ADD VALUE IF NOT EXISTS 'processing';
