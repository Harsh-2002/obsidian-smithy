import { Plugin } from 'obsidian';

/**
 * firstfinger-publisher — minimal CMS inside Obsidian for Hugo blogs.
 *
 * v0.1.0 scaffold — lifecycle only. Subsequent tasks fill in:
 *   P2  settings + secret storage + command registration
 *   P3  storage subsystem (S3 client, presets, path template)
 *   P4  frontmatter parser
 *   P5  markdown walker
 *   P6  resolver + wiki-link conversion
 *   P7  rewriter
 *   P8  GitHub commit API
 *   P9  publish pipeline orchestrator
 *   P10 settings UI
 *   P11 publish / conflict modals
 *   P12 commands (publish, new post, insert shortcode, upload single)
 */
export default class FirstfingerPublisher extends Plugin {
  async onload() {
    // Keep onload fast (< 5ms target): only register commands + settings UI
    // here. Heavy work goes into onLayoutReady below so plugin enablement
    // doesn't slow Obsidian startup.
    // eslint-disable-next-line no-console
    console.log('[firstfinger-publisher] onload');

    this.app.workspace.onLayoutReady(() => {
      // Deferred init runs after vault scan + workspace ready.
      // P2 wires settings loading, secret resolution, command activation here.
      // eslint-disable-next-line no-console
      console.log('[firstfinger-publisher] layout ready');
    });
  }

  async onunload() {
    // registerEvent / registerInterval / registerDomEvent are auto-cleaned.
    // Anything manual gets torn down here.
    // eslint-disable-next-line no-console
    console.log('[firstfinger-publisher] onunload');
  }
}
