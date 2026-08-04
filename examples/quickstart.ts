import { createQDivZeroClient } from "../src/index.js";

const client = createQDivZeroClient({
  apiKey: process.env.QDIV0_API_KEY ?? "",
});

const { data, error, response } = await client.GET("/accounts");
if (response.status !== 200) {
  console.error(`get accounts: status ${response.status}`, error);
  process.exit(1);
}
for (const m of data?.memberships ?? []) {
  console.log(`account=${m.account_id} role=${m.role}`);
}
