# I have Nothing to Wear!

A mobile-first wardrobe app: add outfit photos to **The Pile**, keep individual pieces in **Wardrobe**, and mix them into saved looks in **Hanger**.

Live app: https://wardrobe.yashasvishailly.com

## What powers the current flow

1. After permission, Meta **Muse Spark 1.3** identifies visible wearable pieces and their regions in the selected photo. Inference runs on Meta's hosted API (`api.meta.ai`), called server-side by the app's Cloudflare Worker.
2. The app derives the corresponding source crops and validates their relationship to the discovered regions.
3. **OpenAI regenerates the individual previews, including obscured parts**, from those crops using `gpt-image-2.5-sunburst-2026-09-08`. Inference runs on OpenAI's hosted API (`api.openai.com`), called server-side by the Cloudflare Worker. The active ordinary-upload flow does not use SAM. Historical segmentation experiments remain in the source but are not the current hosted processing path.
4. Finished pieces are saved in this browser. Hanger uses local outfit rules in the browser to combine available inventory across source photos, swap pieces and save looks; it does not call a model.

Generated previews can change details. The app does not guarantee faithful reconstruction of hidden clothing or small accessories. Kurta/tunic classification remains a known limitation. The sample picker uses previously saved synthetic results without new provider requests; one male sample watch was separately colour-corrected and does not demonstrate successful app watch reconstruction.

### Muse Image availability in India and eligibility clarification

The obvious choice for image regeneration was Meta Muse Image, but it is not available to me in India, so it is not used in the current flow. [Meta's geographic use policy](https://dev.meta.ai/legal/geographic-use-policy/) lists Muse Image as unavailable from India and prohibits bypassing geographic access controls. OpenRouter is an officially listed provider, but provider availability does not establish permission to access Muse Image from India. We will not switch to OpenRouter on that basis without explicit clarification covering India or use it to bypass the restriction.

The Cerebral Valley verified app said that Muse Image being unavailable in India would not count against this project. This is app guidance, not a confirmed human organizer ruling. Its replies about eligibility of the Meta discovery/OpenAI preview hybrid conflicted; a human organizer ruling remains pending.

## Run locally

Requires Node.js 22 or later.

```sh
npm ci
npm run typecheck
npm test
npm run dev
```

The local server defaults to disabled paid processing. Do not put provider credentials in client code, static assets, browser storage or the repository. Hosted credentials belong in Worker secrets. Configure the application origin, existing Durable Object binding and provider access only in your own deployment environment.

The source contains short-window abuse protection for the open hosted route: one active provider request per browser and six globally; in each rolling ten minutes, six discoveries/sixty finishes per browser and thirty discoveries/one hundred eighty finishes globally. Rate-limited requests receive HTTP 429 and Retry-After. There is no lifetime three-photo allowance or service-hours cutoff. Those rolling limits bound throughput. The shared app budget below adds conservative internal accounting, not a provider-invoice guarantee. The security patch was deployed on November 2, 2026.

## Privacy and storage

Photos, pieces and saved looks remain in IndexedDB in the same browser. Clearing its storage removes them. On explicit permission, the analysis provider receives the selected photo and OpenAI receives the selected source crops to regenerate individual previews, including obscured parts. Those crops can include faces, skin, other clothing or background. Provider data-use, retention and billing terms apply; free-credit processing may allow product-improvement use. Provider account retention settings have not been independently verified.

The application server stores processing hashes, request markers and outcomes, not wardrobe images. Browser-session processing metadata expires after thirty inactive days. The new abuse ledger retains only hashed anonymous session identifiers, random leases, stages and timestamps for a short rolling window, with deletion after ten inactive minutes. It stores no raw IPs or cookie tokens.

Optional usage analytics require a separate choice. The code excludes photos, filenames, garment details, prompts, personal identifiers and session replay from analytics events; analytics services still receive network metadata.

## Demo

Demo video: https://youtu.be/_3R3cYr9YCU

This public submission snapshot contains application source, local tests, licensed fonts and explicitly approved synthetic samples. It uses fresh history; the private working repository and its history are excluded.

The deployment configuration is a disabled example with no account binding or live route. Configure a separate deployment and server-side secrets yourself. No hosted processing setting is changed by this repository.

The source includes a conservative shared ordinary-processing budget ledger and optional Cloudflare Access checks. These are internal controls, not a guarantee of provider invoice limits. New deployments require an explicitly reviewed prior-spend baseline before paid processing can run.
