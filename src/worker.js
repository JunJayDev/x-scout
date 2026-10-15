// Cloudflare Worker entry. `signal-first deploy` uploads this with the secrets
// MCP_TOKEN (required) and XAI_API_KEY (optional; turns on x_search).
import { handleHttp } from "./http.js";

export default {
  fetch(request, env) {
    return handleHttp(request, env);
  },
};
