import express from "express";
import cors from "cors";
import helmet from "helmet";
import pino from "pino";
import pinoHttp from "pino-http";
import { z } from "zod";
import {
  getConversation, getProduct, getQuotation, IdempotencyConflictError, listHandoffs, listProducts,
  listQuotations, processMessage, updateHandoffStatus
} from "./sales.js";
import { config } from "./config.js";
import { db } from "./db.js";

export const logger = pino({ level: config.logLevel });
export const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(cors({ origin: config.frontendUrl }));
app.use(pinoHttp({ logger }));
app.use(express.json({ limit: "64kb" }));

const camelWebhookSchema = z.object({
  senderId: z.string().trim().min(1).max(200),
  messageId: z.string().trim().min(1).max(200),
  timestamp: z.string().datetime({ offset: true }),
  text: z.string().trim().min(1).max(2000)
}).strict();
const snakeWebhookSchema = z.object({
  sender_id: z.string().trim().min(1).max(200),
  message_id: z.string().trim().min(1).max(200),
  timestamp: z.string().datetime({ offset: true }),
  text: z.string().trim().min(1).max(2000)
}).strict().transform((event) => ({
  senderId: event.sender_id,
  messageId: event.message_id,
  timestamp: event.timestamp,
  text: event.text
}));
const webhookSchema = z.union([camelWebhookSchema, snakeWebhookSchema]);
const handoffStatusSchema = z.object({ status: z.enum(["open", "in_progress", "resolved"]) });

app.get("/api/health", (_req, res) => {
  try {
    db.prepare("SELECT 1").get();
    return res.json({ status: "ok", database: "connected" });
  } catch {
    return res.status(503).json({ success: false, status: "unavailable", database: "unavailable" });
  }
});
app.get("/api/products", (_req, res) => res.json({ products: listProducts() }));
app.get("/api/products/:id", (req, res) => {
  const product = getProduct(req.params.id);
  return product ? res.json({ product }) : res.status(404).json({ success: false, error: { code: "PRODUCT_NOT_FOUND", message: "Product not found." } });
});
app.get("/api/conversations/:senderId", (req, res) => {
  const conversation = getConversation(req.params.senderId);
  return res.json({ conversation });
});
app.get("/api/conversations/:senderId/cart", (req, res) => {
  const conversation = getConversation(req.params.senderId);
  if (!conversation) return res.json({ cart: [], preview: null, state: "active" });
  return res.json({ cart: conversation.cart, preview: conversation.preview, state: conversation.state });
});
app.post("/api/conversations/:senderId/reset", (req, res) => {
  if (Object.keys(req.body || {}).length) return res.status(400).json({ success: false, error: { code: "INVALID_BODY", message: "Reset does not accept a request body." } });
  const conversation = getConversation(req.params.senderId);
  if (!conversation) return res.status(404).json({ success: false, error: { code: "CONVERSATION_NOT_FOUND", message: "Conversation not found." } });
  db.prepare("DELETE FROM cart_items WHERE conversation_id = (SELECT id FROM conversations WHERE sender_id = ?)").run(req.params.senderId);
  db.prepare("UPDATE conversations SET state = 'active', pending_action = NULL, pending_data = NULL, context_json = '{}', updated_at = CURRENT_TIMESTAMP WHERE sender_id = ?").run(req.params.senderId);
  db.prepare("UPDATE carts SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE sender_id = ?").run(req.params.senderId);
  return res.json({ success: true, message: "Current cart and pending preview cleared. History and confirmed quotations were preserved." });
});
app.post(["/api/webhook", "/api/webhook/messages"], (req, res, next) => {
  const parsed = webhookSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({
    success: false,
    error: { code: "INVALID_EVENT", message: "Provide sender ID, message ID, valid ISO timestamp, and non-empty text.", details: parsed.error.flatten() }
  });
  try {
    const response = processMessage(parsed.data);
    return res.json(response);
  } catch (error) {
    if (error instanceof IdempotencyConflictError) return res.status(409).json({
      success: false, error: { code: "IDEMPOTENCY_CONFLICT", message: error.message }, code: "IDEMPOTENCY_CONFLICT"
    });
    if (error instanceof TypeError) return res.status(400).json({
      success: false, error: { code: "INVALID_TIMESTAMP", message: error.message }
    });
    return next(error);
  }
});
app.get("/api/quotations", (req, res) => {
  const sender = typeof req.query.senderId === "string" ? req.query.senderId : undefined;
  const page = Number(req.query.page || 1);
  const pageSize = Number(req.query.pageSize || 50);
  if (!Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return res.status(400).json({ success: false, error: { code: "INVALID_PAGINATION", message: "Page must be positive and pageSize must be between 1 and 100." } });
  }
  return res.json({ quotations: listQuotations(sender, page, pageSize), page, pageSize });
});
app.get("/api/quotations/:id", (req, res) => {
  const quotation = getQuotation(req.params.id);
  return quotation ? res.json({ quotation }) : res.status(404).json({ success: false, error: { code: "QUOTATION_NOT_FOUND", message: "Quotation not found." } });
});
app.get("/api/handoffs", (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  if (status && !["open", "in_progress", "resolved"].includes(status)) {
    return res.status(400).json({ success: false, error: { code: "INVALID_STATUS", message: "Unsupported handoff status." } });
  }
  return res.json({ handoffs: listHandoffs(status) });
});
app.patch("/api/handoffs/:id", (req, res) => {
  const parsed = handoffStatusSchema.safeParse(req.body);
  const id = Number(req.params.id);
  if (!parsed.success || !Number.isSafeInteger(id) || id < 1) {
    return res.status(400).json({ success: false, error: { code: "INVALID_HANDOFF_UPDATE", message: "Provide a valid handoff ID and status." } });
  }
  const updated = updateHandoffStatus(id, parsed.data.status);
  if (!updated) return res.status(404).json({ success: false, error: { code: "HANDOFF_NOT_FOUND", message: "Handoff not found." } });
  return res.json({ success: true, handoff: updated });
});

app.use((error, _req, res, _next) => {
  logger.error({ err: error }, "Request failed");
  if (error?.type === "entity.parse.failed") {
    return res.status(400).json({ success: false, error: { code: "INVALID_JSON", message: "Request body must contain valid JSON." } });
  }
  return res.status(500).json({ success: false, error: { code: "INTERNAL_ERROR", message: "Internal server error." } });
});
