# URL planning

A new run begins with one seed URL and one Firecrawl Map call. Save only all URL strings in {"links":["https://..."]}; omit title, description and name. Preserve duplicates in the saved raw list so the script can count and remove them. A failed or limited Map response must be reported as incomplete discovery.

Run cest.mjs plan --url <seed> --discovery-file <urls.json>. The script normalizes in-scope HTTP(S) pages, excludes tracking parameters, fragments, non-pages and external hosts, then groups by stable path/query patterns. It returns every group ID, pattern, count and recommended sample quantity. The recommendations are: 1-5 all; 6-25 choose 5; 26-100 choose 8; 101-500 choose 12; over 500 choose 15.

Show every group and ask the user for its quantity in Kajoo chat. Zero skips a group; all selects all. Save the quantities in a JSON object keyed by actual group ID and run select --plan <folder> --quotas-file <file>. Selection uses a stable saved random seed, is resumable and immutable. Changing the sample requires a new explicit plan. Only selected URLs are scanned; DOM similarity later chooses screenshot representatives. Report discovered, eligible, excluded, duplicate, selected, deferred, scanned, failed and pending counts. Sampling is not whole-site coverage proof.
