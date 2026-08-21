// Parses every source file with ts-morph looking for: navigational elements
// (<Link>, raw <a href>, router.push/replace, redirect()) and interactive
// elements (anything with onClick, or a native <button>) - classifying each
// button by what its handler actually does, not just that it exists.
import { Project, SyntaxKind, type SourceFile, type JsxAttribute } from "ts-morph";
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
    const label = extractLabel(el.getParent());

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

function extractLabel(node: import("ts-morph").Node | undefined): string {
  if (!node) return "";
  const text = node.getText().replace(/\s+/g, " ").trim();
  return text.length > 60 ? text.slice(0, 57) + "..." : text;
}
