// Spec: FR-RE-2 - see spec/traceability.md
// Parses every source file with ts-morph looking for: navigational elements
// (<Link>, raw <a href>, router.push/replace, redirect()) and interactive
// elements (anything with onClick, or a native <button>) - classifying each
// button by what its handler actually does, not just that it exists.
import { Project, SyntaxKind, Node, type SourceFile, type JsxAttribute, type JsxOpeningElement, type JsxSelfClosingElement } from "ts-morph";
import type { StaticClassification } from "../../types.js";

export interface StaticInteraction {
  file: string;
  line: number;
  kind: "link" | "button";
  /** Raw source text of the target (href value, or router.push/redirect argument). */
  target: string | null;
  classification: StaticClassification;
  /** A short human label, e.g. the element's visible text if easily found. */
  label: string;
}

/** Import bindings from a module whose path suggests a server action file -
 *  "use server" actions in this codebase live in files named actions.ts,
 *  colocated per route segment. This is a naming-convention heuristic, not a
 *  guarantee - a project using a different convention needs this adjusted. */
const ACTION_MODULE_HINT = /actions(\.ts)?$/i;

export function createProject(tsConfigFilePath?: string): Project {
  return new Project(tsConfigFilePath ? { tsConfigFilePath } : { useInMemoryFileSystem: false, skipAddingFilesFromTsConfig: true });
}

export function scanFile(sourceFile: SourceFile): StaticInteraction[] {
  const results: StaticInteraction[] = [];
  const actionBindings = collectActionImportBindings(sourceFile);
  const routerBindings = collectRouterBindings(sourceFile);

  const jsxElements = [
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxOpeningElement),
    ...sourceFile.getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement),
  ];

  for (const el of jsxElements) {
    const tagName = el.getTagNameNode().getText();
    const attrs = el.getAttributes().filter((a): a is JsxAttribute => a.getKind() === SyntaxKind.JsxAttribute);
    const hrefAttr = attrs.find((a) => a.getFirstDescendantByKind(SyntaxKind.Identifier)?.getText() === "href" || a.getText().startsWith("href="));
    const onClickAttr = attrs.find((a) => a.getText().startsWith("onClick="));
    const line = el.getStartLineNumber();
    const label = extractLabel(el);

    if (hrefAttr) {
      const target = extractAttrValueText(hrefAttr);
      results.push({ file: sourceFile.getFilePath(), line, kind: "link", target, classification: "navigates", label });
      continue;
    }
    if (onClickAttr) {
      const classification = classifyOnClick(onClickAttr, actionBindings, routerBindings);
      const target = classification === "navigates" ? extractAttrValueText(onClickAttr) : null;
      results.push({ file: sourceFile.getFilePath(), line, kind: "button", target, classification, label });
      continue;
    }
    if (tagName === "button") {
      results.push({ file: sourceFile.getFilePath(), line, kind: "button", target: null, classification: "dead", label });
    }
  }

  // router.push / router.replace / redirect() calls made outside JSX (e.g. in
  // a click handler function body, or a server component's top-level logic).
  for (const call of sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const exprText = call.getExpression().getText();
    if (exprText === "redirect" || exprText.endsWith(".push") || exprText.endsWith(".replace")) {
      const isRouterLike = exprText === "redirect" || routerBindings.has(exprText.split(".")[0]);
      if (!isRouterLike) continue;
      const arg = call.getArguments()[0];
      if (!arg) continue;
      // Skip if this call is inside a JSX onClick we already recorded above -
      // avoid double-counting the same navigation as two edges.
      const enclosingJsxAttr = call.getFirstAncestorByKind(SyntaxKind.JsxAttribute);
      if (enclosingJsxAttr && enclosingJsxAttr.getText().startsWith("onClick=")) continue;
      results.push({
        file: sourceFile.getFilePath(),
        line: call.getStartLineNumber(),
        kind: "link",
        target: arg.getText(),
        classification: "navigates",
        label: exprText,
      });
    }
  }

  return results;
}

function collectActionImportBindings(sourceFile: SourceFile): Set<string> {
  const bindings = new Set<string>();
  for (const imp of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = imp.getModuleSpecifierValue();
    if (!ACTION_MODULE_HINT.test(moduleSpecifier)) continue;
    for (const named of imp.getNamedImports()) bindings.add(named.getName());
    const def = imp.getDefaultImport();
    if (def) bindings.add(def.getText());
  }
  return bindings;
}

function collectRouterBindings(sourceFile: SourceFile): Set<string> {
  const bindings = new Set<string>();
  for (const decl of sourceFile.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const init = decl.getInitializer();
    if (init && init.getText().includes("useRouter(")) {
      bindings.add(decl.getName());
    }
  }
  return bindings;
}

function classifyOnClick(
  attr: JsxAttribute,
  actionBindings: Set<string>,
  routerBindings: Set<string>
): StaticClassification {
  const identifiers = attr.getDescendantsOfKind(SyntaxKind.Identifier).map((i) => i.getText());
  if (identifiers.some((id) => actionBindings.has(id))) return "server-action";
  if (identifiers.some((id) => routerBindings.has(id)) || identifiers.includes("redirect")) return "navigates";
  const hasCall = attr.getDescendantsOfKind(SyntaxKind.CallExpression).length > 0;
  return hasCall ? "local-state" : "local-state";
}

function extractAttrValueText(attr: JsxAttribute): string | null {
  const init = attr.getInitializer();
  if (!init) return null;
  const text = init.getText();
  return text.replace(/^\{|\}$/g, "").trim();
}

const MAX_LABEL_LENGTH = 60;
/** How many levels of nested JSX children to descend into when hunting for
 *  visible text, e.g. <Button><span><b>Save</b></span></Button>. Bounded so
 *  we never walk into an arbitrarily deep component tree. */
const MAX_TEXT_DEPTH = 2;
const ACCESSIBLE_NAME_ATTRS = ["aria-label", "title", "alt"];

/** Approximates the accessible name a live DOM / Playwright would compute for
 *  a JSX element, using only the static AST - there is no live browser during
 *  the static pass. Never falls back to raw JSX source text: that dumps the
 *  tag name and every prop (e.g. `<Button type="button" variant="outline"...`)
 *  which is worse than no label at all. */
function extractLabel(el: JsxOpeningElement | JsxSelfClosingElement | undefined): string {
  if (!el) return "";

  // 1. Visible child text. Only a JsxOpeningElement has a wrapping JsxElement
  //    with children - a JsxSelfClosingElement (<Icon />, <img />) never does.
  const owner = Node.isJsxOpeningElement(el) ? el.getParentIfKind(SyntaxKind.JsxElement) : undefined;
  const childText = owner ? collectVisibleText(owner, MAX_TEXT_DEPTH) : "";
  if (childText) return finalizeLabel(childText);

  // 2. Accessible-name attributes on the element itself - the same sources a
  //    screen reader (and Playwright's getByRole) fall back to for
  //    icon-only controls.
  const attrText = extractAccessibleAttr(el);
  if (attrText) return finalizeLabel(attrText);

  // 3. Nothing statically resolvable. Return empty rather than ever leaking
  //    raw JSX source into the label - callers already treat a falsy label
  //    as "no label" (see static/index.ts buildGraph).
  return "";
}

/** Walks a JsxElement/JsxFragment's children collecting visible text:
 *  JsxText nodes, and string-literal JsxExpression children (e.g.
 *  {"Sign In"}). Non-literal expressions ({someVar}, {cond && <X/>}, calls,
 *  etc.) are skipped - not statically resolvable, and guessing risks a
 *  wrong/stale label. Recurses into nested JsxElement/JsxFragment children
 *  up to `depth` levels so icon+label wrapper patterns
 *  (<Button><span>Save</span></Button>) still yield a label. */
function collectVisibleText(container: Node, depth: number): string {
  const children = Node.isJsxElement(container) || Node.isJsxFragment(container) ? container.getJsxChildren() : [];
  const parts: string[] = [];

  for (const child of children) {
    if (Node.isJsxText(child)) {
      const t = child.getText().replace(/\s+/g, " ").trim();
      if (t) parts.push(t);
      continue;
    }
    if (Node.isJsxExpression(child)) {
      const inner = child.getExpression();
      if (inner && (Node.isStringLiteral(inner) || Node.isNoSubstitutionTemplateLiteral(inner))) {
        const t = inner.getLiteralText().trim();
        if (t) parts.push(t);
      }
      // Any other expression form (identifier, call, ternary, ...) is not
      // statically resolvable - skip rather than guess.
      continue;
    }
    if (depth > 0 && (Node.isJsxElement(child) || Node.isJsxFragment(child))) {
      const nested = collectVisibleText(child, depth - 1);
      if (nested) parts.push(nested);
    }
    // JsxSelfClosingElement children (e.g. an <Icon /> next to a label) and
    // anything else contribute no visible text.
  }

  return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Reads aria-label / title / alt off a JSX opening/self-closing element. */
function extractAccessibleAttr(el: JsxOpeningElement | JsxSelfClosingElement): string {
  const attrs = el.getAttributes().filter((a): a is JsxAttribute => a.getKind() === SyntaxKind.JsxAttribute);
  for (const name of ACCESSIBLE_NAME_ATTRS) {
    const attr = attrs.find((a) => a.getNameNode().getText() === name);
    const init = attr?.getInitializer();
    if (!init) continue;

    const literal = Node.isJsxExpression(init) ? init.getExpression() : init;
    if (literal && (Node.isStringLiteral(literal) || Node.isNoSubstitutionTemplateLiteral(literal))) {
      const t = literal.getLiteralText().trim();
      if (t) return t;
    }
    // aria-label={someExpr} where someExpr isn't a literal - not statically
    // resolvable, skip.
  }
  return "";
}

/** Collapses whitespace, strips characters that would break the
 *  `Click "<label>"` wrapper format downstream (static/index.ts wraps this
 *  in quotes; demo.ts later regex-extracts the first quoted substring), and
 *  applies the existing 60-char truncation. */
function finalizeLabel(text: string): string {
  const clean = text.replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return clean.length > MAX_LABEL_LENGTH ? clean.slice(0, MAX_LABEL_LENGTH - 3) + "..." : clean;
}
