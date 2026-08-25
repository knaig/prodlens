// Spec: FR-IS-1 - see spec/traceability.md
// Detects forms on the current live page. Needs a real rendered DOM
// (input types, names, required-ness aren't reliably knowable from source
// text alone - a controlled <input> can be typed anything) so this only runs
// during the live crawl, not the static pass.
//
// Two passes, merged into one FormDescriptor[]. First the obvious one: native
// <form> tags. Second (new): "input clusters" - many modern apps (lazy-dist
// included) never use a native <form>; fields are controlled <input>s read by
// an onClick handler wrapped in a onClick button. When a page has no <form>,
// we find visible buttons that look like a submit (create/generate/save/add/
// publish/continue...), then group the text-entry fields nearest to them into
// a FormDescriptor, so the heuristic InputScenario machinery in
// synthesize.ts still grounds fields onto edges and the executor fills them
// before clicking.
import type { Page } from "playwright";
import type { FormDescriptor } from "../types.js";

const SUBMIT_LIKE = /create|generate|save|submit|add|publish|continue|next|sign[ _-]?in|sign[ _-]?up|register|login|search|apply|send|finish|start|update|connect|run|deploy|claim|join/i;

export async function scanForms(page: Page): Promise<FormDescriptor[]> {
  const forms = await scanNativeForms(page);
  const clusters = await scanInputClusters(page);
  return [...forms, ...clusters];
}

async function scanNativeForms(page: Page): Promise<FormDescriptor[]> {
  return page.$$eval("form", (formEls) => {
    const forms: FormDescriptor[] = [];
    formEls.forEach((formEl, fi) => {
      const formSelector = `form:nth-of-type(${fi + 1})`;
      const fields: FormDescriptor["fields"] = [];
      formEl.querySelectorAll("input, textarea, select").forEach((el, i) => {
        const tag = el.tagName.toLowerCase();
        const type = tag === "input" ? el.getAttribute("type") || "text" : tag;
        if (["hidden", "submit", "button", "reset"].includes(type)) return;
        const name = el.getAttribute("name") || "";
        const selector = name ? `${formSelector} [name="${name}"]` : `${formSelector} ${tag}:nth-of-type(${i + 1})`;
        fields.push({
          name: name || `${tag}_${i}`,
          type,
          selector,
          placeholder: el.getAttribute("placeholder") || undefined,
          required: el.hasAttribute("required") || undefined,
        });
      });
      if (!fields.length) return;

      const submitEl = formEl.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
      forms.push({
        selector: formSelector,
        fields,
        submitSelector: submitEl ? `${formSelector} ${submitEl.tagName.toLowerCase()}[type="${submitEl.getAttribute("type") ?? "submit"}"]` : undefined,
        submitLabel: submitEl ? (submitEl.textContent || submitEl.getAttribute("value") || "").replace(/\s+/g, " ").trim().slice(0, 60) : undefined,
      });
    });
    return forms;
  });
}

// ----- Input-cluster heuristic (no <form> tag) -----

/** Plain per-element data collected in the browser and passed to the pure
 *  pairing core below, which is unit-testable without a Page. */
export interface ClusterElement {
  tag: "input" | "textarea" | "select";
  x: number; // viewport center x
  y: number; // viewport center y
  id?: string;
  name?: string;
  placeholder?: string;
  type: string;
  required?: boolean;
}

export interface ClusterButton {
  label: string;
  x: number;
  y: number;
}

function centre(el: { x: number; width: number; y: number; height: number }): { x: number; y: number } {
  return { x: el.x + el.width / 2, y: el.y + el.height / 2 };
}

/** Pure pairing rule, exported for tests: a field belongs to a submit button
 *  when their viewport centers are closer than 400px in x and the field is
 *  vertically within the same band. Forms built without a <form> tag are
 *  usually vertical: a column of fields with the submit button below them
 *  (onboarding is ~350px from top field to button), so a field pairs when it
 *  sits above the button within a generous span, and the old tighter band is
 *  kept for fields near the button's own row. Returns clusters that also
 *  carry the stable per-field selector (prefers name, then placeholder, id). */
export function pairClusters(
  buttons: ClusterButton[],
  fields: ClusterElement[]
): { button: ClusterButton; fields: (ClusterElement & { selector: string; name: string; type: string })[] }[] {
  const clusters: { button: ClusterButton; fields: (ClusterElement & { selector: string; name: string; type: string })[] }[] = [];

  for (const btn of buttons) {
    if (!btn.label || btn.label.length > 60) continue;
    const linked: (ClusterElement & { selector: string; name: string; type: string })[] = [];
    for (const f of fields) {
      const dy = f.y - btn.y;
      const withinButtonRow = Math.abs(dy) <= 120; // fields on/near the button's row
      const fieldAboveButton = dy < 0 && dy >= -400; // vertical form: fields above the submit
      if (!withinButtonRow && !fieldAboveButton) continue;
      if (Math.abs(f.x - btn.x) > 400) continue;
      const selector = fieldSelector(f);
      if (!selector) {
        continue; // no stable way to address it - skip rather than mis-fill
      }
      if (f.type === "select") continue; // selectOption needs exact values; heuristics rarely match
      linked.push({ ...f, selector, name: f.name || f.placeholder || "field", type: f.type });
    }
    if (!linked.length) continue;
    clusters.push({ button: btn, fields: linked });
  }
  return clusters;
}

function fieldSelector(f: ClusterElement): string {
  if (f.name && f.name.trim()) return `[name="${f.name.replace(/"/g, '\\"')}"]`;
  if (f.placeholder && f.placeholder.trim()) return `[placeholder="${f.placeholder.replace(/"/g, '\\"')}"]`;
  if (f.id) return `#${f.id.replace(/"/g, '\\"')}`;
  return "";
}

function buttonSelector(label: string): string {
  const t = label.replace(/"/g, '\\"').slice(0, 40);
  return t ? `button:has-text("${t}")` : "";
}

async function scanInputClusters(page: Page): Promise<FormDescriptor[]> {
  const extracted = await page.evaluate((submitSource) => {
    const submitRe = new RegExp(submitSource, "i");

    const buttons: ClusterButton[] = [];
    const fields: ClusterElement[] = [];

    // NOTE: keep every callback here anonymous and inline. Named arrow
    // functions get wrapped with esbuild's __name helper during tsx
    // transpilation, and that helper doesn't exist inside the browser's
    // evaluate sandbox. TypeScript types in signatures are fine (stripped).
    Array.from(document.querySelectorAll<HTMLElement>("button, input, textarea, select")).forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      if (el.closest("form")) return; // native forms handled by the other pass
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };

      if (el.tagName.toLowerCase() === "button") {
        const label = (el.textContent || "").replace(/\s+/g, " ").trim();
        if (label.length > 0 && label.length <= 60 && submitRe.test(label)) {
          buttons.push({ label: label.slice(0, 60), x: c.x, y: c.y });
        }
        return;
      }

      if (el.tagName.toLowerCase() === "select") {
        fields.push({ tag: "select", x: c.x, y: c.y, type: "select" });
        return;
      }

      if (el.tagName.toLowerCase() === "textarea") {
        fields.push({
          tag: "textarea",
          x: c.x,
          y: c.y,
          type: "textarea",
          placeholder: el.getAttribute("placeholder") || undefined,
          name: el.getAttribute("name") || undefined,
          required: el.hasAttribute("required") || undefined,
        });
        return;
      }

      // plain input: keep only text-entry types for heuristic filling
      const type = (el.getAttribute("type") || "text").toLowerCase();
      if (!["text", "email", "number", "url", "tel", "password", "date"].includes(type)) return;
      fields.push({
        tag: "input",
        x: c.x,
        y: c.y,
        type,
        placeholder: el.getAttribute("placeholder") || undefined,
        name: el.getAttribute("name") || undefined,
        required: el.hasAttribute("required") || undefined,
      });
    });
    return { buttons, fields };
  }, SUBMIT_LIKE.source);

  const clusters = pairClusters(extracted.buttons, extracted.fields);
  return clusters.map((c) => ({
    selector: buttonSelector(c.button.label),
    fields: c.fields.map((f) => ({
      name: f.name,
      type: f.type,
      selector: f.selector,
      placeholder: f.placeholder || undefined,
      required: f.required || undefined,
    })),
    submitSelector: buttonSelector(c.button.label),
    submitLabel: c.button.label,
  }));
}