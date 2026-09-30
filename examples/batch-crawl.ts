// Submit a batch, wait for it, then stream the results.
// Run: SPICRAWL_API_KEY=spicrawl_live_... npx tsx examples/batch-crawl.ts
import { Spicrawl } from "@spicrawl/sdk";

const spicrawl = new Spicrawl();

const job = await spicrawl.batch.create({
  name: "example-crawl",
  urls: ["https://example.com", "https://example.org", "https://example.net"],
});
console.log(`submitted ${job.id} (${job.total_items} items)`);

const done = await spicrawl.batch.waitForCompletion(job.id, {
  pollIntervalMs: 2000,
  onProgress: (j) => console.log(j.status, j.progress),
});
console.log("finished:", done.status);

for await (const line of spicrawl.batch.results(job.id)) {
  console.log(line.seq, line.status, line.http_status ?? "-", line.url, line.error?.code ?? "");
}
