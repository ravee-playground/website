import fs from "fs";
import path from "path";

// For the Resource Center, default BASE_URL to the public Discourse Meta forum if env var is missing
const BASE_URL = process.env.DISCOURSE_BASE_URL || "https://meta.discourse.org";
const OUT_DIR = process.env.OUT_DIR || "index";
const MAX_CATEGORIES = parseInt(process.env.MAX_CATEGORIES || "100", 10);
const MAX_TOPICS_PER_CATEGORY = parseInt(process.env.MAX_TOPICS_PER_CATEGORY || "15", 10);
const MAX_PAGES_PER_CATEGORY = parseInt(process.env.MAX_PAGES_PER_CATEGORY || "10", 10);
const BASE_DELAY_MS = parseInt(process.env.DISCOURSE_DELAY_MS || "2000", 10); // Increased slightly for friendly public crawling
const MAX_RETRIES = parseInt(process.env.DISCOURSE_MAX_RETRIES || "3", 10);

// CHANGED: We now allow anonymous public parsing if keys are omitted.
const API_KEY = process.env.DISCOURSE_API_KEY;
const API_USERNAME = process.env.DISCOURSE_API_USERNAME;

// Pre-filtering for categories matching documentation or resource hubs
const CATEGORY_ALLOWLIST = (process.env.DISCOURSE_CATEGORY_ALLOWLIST || "documentation,wiki")
  .split(",")
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

fs.mkdirSync(OUT_DIR, { recursive: true });

function discourseHeaders() {
  const headers = {
    Accept: "application/json",
    // CHANGED: Using a clean descriptive agent targeting the Resource Center crawler profile
    "User-Agent": "DiscourseResourceCenterIndexer/2.0 (+https://yourname.github.io/resume)",
  };

  // Only append auth headers if they are provided in environment variables
  if (API_KEY && API_USERNAME) {
    headers["Api-Key"] = API_KEY;
    headers["Api-Username"] = API_USERNAME;
  }
  return headers;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepWithJitter(baseMs) {
  const extra = Math.floor(Math.random() * 500);
  return sleep(baseMs + extra);
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function safeString(x) {
  return typeof x === "string" ? x : String(x ?? "");
}

function chunkId(source, id) {
  return `${source}-${id}`;
}

async function getJson(url, retries = MAX_RETRIES) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    await sleepWithJitter(BASE_DELAY_MS);

    const resp = await fetch(url, {
      headers: discourseHeaders(),
      redirect: "follow",
    });

    if (resp.ok) {
      return await resp.json();
    }

    if (resp.status === 429 && attempt < retries) {
      const retryAfter = Number(resp.headers.get("retry-after") || 0);
      const waitMs = retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 8000;
      console.warn(`429 for ${url}; retrying in ${waitMs}ms (attempt ${attempt + 1}/${retries})`);
      await sleep(waitMs);
      continue;
    }

    throw new Error(`HTTP ${resp.status} for ${url}`);
  }
}

async function main() {
  const outPath = path.join(OUT_DIR, "discourse.chunks.jsonl");
  const tmpPath = path.join(OUT_DIR, "discourse.chunks.jsonl.tmp");
  const manifestPath = path.join(OUT_DIR, "discourse.manifest.json");

  const out = fs.createWriteStream(tmpPath, { flags: "w" });

  let categoryCount = 0;
  let topicCount = 0;
  let chunkCount = 0;
  const failed = [];

  try {
    const base = BASE_URL.replace(/\/$/, "");
    
    // CHANGED: Append parameter to grab subcategories natively over public API
    const categoriesUrl = `${base}/categories.json?include_subcategories=true`;
    console.log(`Fetching root categories from: ${categoriesUrl}`);
    const categoriesJson = await getJson(categoriesUrl);

    let categories = categoriesJson?.category_list?.categories || [];

    if (CATEGORY_ALLOWLIST.length > 0) {
      categories = categories.filter((c) =>
        CATEGORY_ALLOWLIST.includes(String(c.slug).toLowerCase())
      );
    }

    categories = categories.slice(0, MAX_CATEGORIES);

    if (categories.length === 0) {
      console.warn("No categories matched the allowlist filters.");
    }

    for (const category of categories) {
      categoryCount += 1;

      const categoryId = category.id;
      const categoryName = safeString(category.name);
      const categorySlug = safeString(category.slug);
      const customer = categoryName;

      let topicCountForCategory = 0;

      try {
        for (let page = 0; page < MAX_PAGES_PER_CATEGORY; page++) {
          if (topicCountForCategory >= MAX_TOPICS_PER_CATEGORY) break;

          const topicsUrl = `${base}/c/${categorySlug}/${categoryId}.json?page=${page}`;
          const topicsJson = await getJson(topicsUrl);

          const topics = topicsJson?.topic_list?.topics || [];
          if (topics.length === 0) {
            break;
          }

          console.log(`Category [${categoryName}]: page ${page} -> processing ${topics.length} topics`);

          for (const topic of topics) {
            if (topicCountForCategory >= MAX_TOPICS_PER_CATEGORY) break;

            topicCount += 1;
            topicCountForCategory += 1;

            const topicId = topic.id;
            const topicTitle = safeString(topic.title);
            const topicSlug = safeString(topic.slug);
            const topicUrl = `${base}/t/${topicSlug}/${topicId}`;

            try {
              const topicJsonUrl = `${base}/t/${topicId}.json`;
              const topicJson = await getJson(topicJsonUrl);

              const postStream = topicJson?.post_stream?.posts || [];
              const firstPost = postStream[0];
              if (!firstPost) continue;

              const text = htmlToText(firstPost.cooked || firstPost.raw || "");
              if (!text || text.length < 80) continue;

              const record = {
                chunk_id: chunkId("discourse-topic", topicId),
                source: "discourse-resource-center",
                customer,
                category_id: categoryId,
                category_name: categoryName,
                category_slug: categorySlug,
                topic_id: topicId,
                topic_title: topicTitle,
                topic_slug: topicSlug,
                url: topicUrl,
                title: topicTitle,
                headings: [topicTitle],
                tags: Array.isArray(topic.tags) ? topic.tags : [],
                text,
                updated_at: topic.last_posted_at || topic.bumped_at || topic.created_at || null,
                fetched_at: new Date().toISOString(),
              };

              out.write(JSON.stringify(record) + "\n");
              chunkCount += 1;
            } catch (e) {
              failed.push({
                scope: "topic",
                category: categoryName,
                topic_id: topicId,
                error: String(e?.message || e),
              });
            }
          }
        }
      } catch (e) {
        failed.push({
          scope: "category",
          category: categoryName,
          error: String(e?.message || e),
        });
      }
    }

    out.end();
    await new Promise((resolve, reject) => {
      out.on("finish", resolve);
      out.on("error", reject);
    });

    if (chunkCount < 1) {
      throw new Error("No chunks were generated from the Discourse forum endpoints.");
    }

    fs.renameSync(tmpPath, outPath);

    const manifest = {
      build_time: new Date().toISOString(),
      base_url: BASE_URL,
      category_count: categoryCount,
      topic_count: topicCount,
      chunk_count: chunkCount,
      failed_count: failed.length,
      failed: failed.slice(0, 50),
      config: {
        max_categories: MAX_CATEGORIES,
        max_topics_per_category: MAX_TOPICS_PER_CATEGORY,
        max_pages_per_category: MAX_PAGES_PER_CATEGORY,
        base_delay_ms: BASE_DELAY_MS,
        max_retries: MAX_RETRIES,
        category_allowlist: CATEGORY_ALLOWLIST,
      },
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
    console.log(
      `Done. categories=${categoryCount}, topics=${topicCount}, chunks=${chunkCount}, failed=${failed.length}`
    );
  } catch (e) {
    try {
      fs.writeFileSync(
        manifestPath,
        JSON.stringify(
          {
            build_time: new Date().toISOString(),
            base_url: BASE_URL,
            category_count: categoryCount,
            topic_count: topicCount,
            chunk_count: chunkCount,
            failed_count: failed.length,
            failed: failed.slice(0, 50),
            error: String(e?.message || e),
            config: {
              max_categories: MAX_CATEGORIES,
              max_topics_per_category: MAX_TOPICS_PER_CATEGORY,
              max_pages_per_category: MAX_PAGES_PER_CATEGORY,
              base_delay_ms: BASE_DELAY_MS,
              max_retries: MAX_RETRIES,
              category_allowlist: CATEGORY_ALLOWLIST,
            },
          },
          null,
          2
        ),
        "utf-8"
      );
    } catch (_) {}

    throw e;
  }
}

main().catch((e) => {
  console.error("FATAL:", e?.stack || e);
  process.exit(1);
});
