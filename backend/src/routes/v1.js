import express from "express";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { createRequireUser } from "../middleware/requireUser.js";
import { asyncHandler } from "../middleware/asyncHandler.js";
import { createAuthHandlers } from "./v1/auth.js";
import { createAnalyzeHandler } from "./v1/analyze.js";
import { resumeExtractHandler } from "./v1/resume.js";
import { createStateHandlers } from "./v1/state.js";
import { createShortlistHandlers } from "./v1/shortlist.js";
import { createQuotaHandlers } from "./v1/quota.js";

export function createV1Router(config) {
  const router = express.Router();

  router.use(
    rateLimit({
      windowMs: 60_000,
      limit: config.rateLimitPerMinute,
      standardHeaders: true,
      legacyHeaders: false
    })
  );

  const auth = createAuthHandlers(config);
  router.post("/auth/signup", asyncHandler(auth.signup));
  router.post("/auth/login", asyncHandler(auth.login));

  const requireUser = createRequireUser(config);
  router.use(requireUser);

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.resumeMaxBytes }
  });

  const state = createStateHandlers(config);
  router.get("/state", asyncHandler(state.get));
  router.put("/state", asyncHandler(state.put));

  const shortlist = createShortlistHandlers(config);
  router.get("/shortlist", asyncHandler(shortlist.list));
  router.post("/shortlist/upsert", asyncHandler(shortlist.upsert));
  router.post("/shortlist/delete", asyncHandler(shortlist.del));
  router.post("/shortlist/clear", asyncHandler(shortlist.clear));

  const quota = createQuotaHandlers(config);
  router.post("/quota/reset", asyncHandler(quota.reset));

  router.post("/analyze", asyncHandler(createAnalyzeHandler(config)));
  router.post("/resume/extract", upload.single("file"), asyncHandler(resumeExtractHandler));

  return router;
}
