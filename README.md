# Rohit Diggi — Portfolio

A dark, cinematic scroll-film résumé site. Vanilla JS + Three.js, **no build step** — just static files.

**Live sections:** Hero · About · Skills · Experience · Projects · Awards · Contact

## Highlights
- **Scroll film** — a single lerped scroll value drives crossfading chapters with soft snap-to-section, so it always settles crisp.
- **Living 3D backdrop** — a drifting neural / routing node-mesh (Three.js) whose hue shifts per chapter and parallaxes to the mouse.
- **Custom cursor** that weaves glowing links to nearby stars as you move — **click to pin a node** permanently into the web, double-click to reset.
- Recruiter-first: scannable, prominent résumé download, reduced-motion + mobile fallbacks.

## Run locally
No dependencies. Serve the folder over HTTP (ES modules need it):

```bash
python3 -m http.server 5178
# then open http://localhost:5178
```

## Structure
```
index.html        # markup for every chapter
css/style.css     # dark cinematic styling + custom cursor
js/main.js        # scroll engine, Three.js scene, interaction (ES module)
lib/three.module.js
fonts/            # self-hosted woff2 (Space Grotesk, Unbounded, Russo One)
assets/           # résumé PDF
```

## Notes
- A LeetCode section is built but dormant (`SHOW_LEETCODE` flag + `renderLeetCode()` in `js/main.js`) — flip it on once there are stats worth showing.

---
Designed & built by Rohit Jaysheel Diggi. No templates.
