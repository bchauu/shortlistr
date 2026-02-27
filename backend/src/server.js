import { config } from "./config.js";
import { createApp } from "./app.js";

const app = createApp(config);
app.listen(config.port, () => {
  console.log(`[shortlistr-backend] listening on http://localhost:${config.port} (build ${config.buildId})`);
  console.log(
    `[shortlistr-backend] dailyAnalyzeLimit=${config.dailyAnalyzeLimit} rateLimitPerMinute=${config.rateLimitPerMinute}`
  );
});
