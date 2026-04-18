import { describe, it, expect } from 'vitest';
import { transform } from 'sucrase';
import vm from 'node:vm';

/**
 * These tests lock in the security-critical behaviour of the new Sucrase-based
 * extension transform (loader/index.ts, `transformModuleCode`).
 *
 * The previous implementation used raw regex replacements on the source text,
 * which meant a string literal containing `import { x } from '../../api'`
 * would be rewritten and could leak access to `VoltAPI` inside the concatenated
 * worker source. Sucrase operates on a real lexer, so string literals — and
 * anything else that isn't a top-level import/export statement — are left
 * untouched.
 */
describe('ExtensionLoader Sucrase transform', () => {
  const runTransform = (code: string): string => {
    return transform(code, {
      transforms: ['typescript', 'imports'],
      filePath: 'test.ts',
    }).code;
  };

  it('rewrites a real import statement into CJS require', () => {
    // Sucrase drops unused imports — reference `voltApi` so Sucrase keeps it.
    const src = `
      import { voltApi } from 'volt-api';
      export const foo = voltApi ? 1 : 0;
    `;
    const out = runTransform(src);
    expect(out).toMatch(/require\(['"]volt-api['"]\)/);
    expect(out).toMatch(/exports\.\s*foo\s*=\s*foo/);
  });

  it('does NOT rewrite import-like text inside a double-quoted string literal', () => {
    const src = `const fake = "import { x } from '../../api'"; export default fake;`;
    const out = runTransform(src);
    // The string literal must appear verbatim in the output.
    expect(out).toContain(`"import { x } from '../../api'"`);
    // And no require() call should exist, because there's no real import.
    expect(out).not.toMatch(/require\(/);
  });

  it('does NOT rewrite import-like text inside a template literal', () => {
    const src =
      'const fake = `import { x } from "../../api"`;\nexport default fake;';
    const out = runTransform(src);
    expect(out).toContain('`import { x } from "../../api"`');
    expect(out).not.toMatch(/require\(/);
  });

  it('does NOT rewrite import-like text inside a comment', () => {
    const src = `// import { evil } from '../../api'\nexport const safe = 1;`;
    const out = runTransform(src);
    // Comment is preserved and no require() is injected.
    expect(out).toContain(`// import { evil } from '../../api'`);
    expect(out).not.toMatch(/require\(/);
  });

  it('erases type-only imports so they do not reach the runtime', () => {
    const src = `
      import { Plugin, PluginContext, PluginResultType } from '../../api';
      class P implements Plugin {
        match(ctx: PluginContext) { return [{ type: PluginResultType.Action }]; }
      }
      export default P;
    `;
    const out = runTransform(src);
    // PluginResultType still references the api module at runtime.
    expect(out).toMatch(/require\(['"]\.\.\/\.\.\/api['"]\)/);
    expect(out).toMatch(/PluginResultType/);
    // But the type-only identifiers have been erased from runtime positions.
    expect(out).not.toMatch(/implements\s+Plugin/);
  });

  it('rewrites export default', () => {
    const src = `const Plugin = { match: () => [] }; export default Plugin;`;
    const out = runTransform(src);
    expect(out).toMatch(/exports\.\s*default\s*=\s*Plugin/);
  });

  it('erases re-export-from statements for types', () => {
    const src = `export type { PluginContext } from '../../api';`;
    const out = runTransform(src);
    // Type-only re-exports produce no require / no exports assignment.
    expect(out).not.toMatch(/require\(/);
  });
});

/**
 * End-to-end tests that exercise the real `__voltRequire__` / `__voltApiShim__`
 * resolution. These lock in the security fix for H1 (over-matching `api` as a
 * mid-path segment) and H3 (dynamic-import + import.meta coverage).
 *
 * The harness below mirrors the specifier-matching regex and shim logic from
 * `buildBundleWithOrder` in index.ts. If you change the production regex,
 * update this too — the two must stay in lockstep. (The alternative would be
 * to reflect into the private method; keeping a local copy keeps the test
 * self-contained and failure-mode obvious.)
 *
 * Modules are executed via Node's `vm` module in a fresh context so the
 * `require` / `exports` / `module` locals are wired exactly as they are in
 * the production bundle IIFEs — no `new Function()` / `eval` string-compile.
 */
describe('ExtensionLoader __voltRequire__ resolution', () => {
  const runTransform = (code: string): string =>
    transform(code, {
      transforms: ['typescript', 'imports'],
      filePath: 'test.ts',
    }).code;

  // Production regex — keep in sync with index.ts.
  const isVoltApiSpecifier = (p: string): boolean =>
    p === 'volt-api' || /(?:^|\/)api(?:\.(?:ts|js|tsx|jsx|mjs))?$/.test(p);

  // Minimal shim mirroring the renderer/Worker shim surface.
  const shim = Object.freeze({
    PluginResultType: { Action: 'action' },
    copyToClipboard: () => {},
    openUrl: () => {},
    formatNumber: (n: number) => String(n),
    fuzzyScore: () => 0,
    notify: () => {},
    events: { emit: () => {}, on: () => () => {} },
  });

  /**
   * Evaluate a single transformed module in a fresh vm context with CJS-like
   * `require` / `exports` / `module` locals, matching the IIFE environment
   * built by `buildBundleWithOrder`. Returns a promise so tests can await
   * dynamic-import (top-level `await`) completion.
   */
  const evalModule = async (
    transformed: string,
    modulesRegistry: Record<string, unknown> = {}
  ): Promise<Record<string, unknown>> => {
    const exportsObj: Record<string, unknown> = {};
    const moduleObj: { exports: unknown } = { exports: exportsObj };
    const voltRequire = (p: string): unknown => {
      if (isVoltApiSpecifier(p)) return shim;
      if (p in modulesRegistry) return modulesRegistry[p];
      return {};
    };
    const context = vm.createContext({
      require: voltRequire,
      exports: exportsObj,
      module: moduleObj,
      // Dynamic imports need access to Promise / Object in the sandbox realm.
      Promise,
      Object,
    });
    // Wrap in an async IIFE so top-level `await` (from dynamic-import tests) works.
    const wrapped = `(async () => { ${transformed} })()`;
    await (vm.runInContext(wrapped, context) as Promise<void>);
    return moduleObj.exports !== exportsObj
      ? (moduleObj.exports as Record<string, unknown>)
      : exportsObj;
  };

  it('dynamic import of ../../api returns the frozen shim', async () => {
    const src = `
      const m = await import('../../api');
      exports.resolved = m;
    `;
    const out = runTransform(src);
    // Sucrase rewrites dynamic import → Promise.resolve().then(() => _interopRequireWildcard(require(...))).
    expect(out).toMatch(/require\(['"]\.\.\/\.\.\/api['"]\)/);

    const mod = await evalModule(out);
    // `_interopRequireWildcard` builds a wildcard-namespace wrapper
    // around our CJS shim. The shim is reachable as `.default` on the
    // wrapper, and its own enumerable properties are spread across the top.
    const resolved = mod.resolved as { default?: unknown; PluginResultType?: unknown };
    expect(resolved).toBeDefined();
    expect(resolved.default).toBe(shim);
    expect(resolved.PluginResultType).toBe(shim.PluginResultType);
  });

  it('dynamic import of ./vendor/api/foo does NOT return the shim', async () => {
    const fakeVendorModule = Object.freeze({ __tag: 'vendor-api-foo' });
    const src = `
      const m = await import('./vendor/api/foo');
      exports.resolved = m;
    `;
    const out = runTransform(src);
    expect(out).toMatch(/require\(['"]\.\/vendor\/api\/foo['"]\)/);

    const mod = await evalModule(out, {
      './vendor/api/foo': fakeVendorModule,
    });
    const resolved = mod.resolved as { default?: unknown; __tag?: unknown };
    // Must resolve to the user module, NOT the shim.
    expect(resolved.default).toBe(fakeVendorModule);
    expect(resolved.default).not.toBe(shim);
    // And the wildcard wrapper exposes the user module's own fields, not shim fields.
    expect(resolved.__tag).toBe('vendor-api-foo');
    expect((resolved as Record<string, unknown>).PluginResultType).toBeUndefined();
  });

  it('static require boundary: api-segment shapes resolve correctly', () => {
    // Covers the H1 regex boundary without Sucrase indirection.
    expect(isVoltApiSpecifier('./vendor/api/foo')).toBe(false);
    expect(isVoltApiSpecifier('./vendor/api/foo.ts')).toBe(false);
    expect(isVoltApiSpecifier('./api-client')).toBe(false);
    expect(isVoltApiSpecifier('./api-client.ts')).toBe(false);
    // Legitimate shapes still resolve.
    expect(isVoltApiSpecifier('volt-api')).toBe(true);
    expect(isVoltApiSpecifier('../../api')).toBe(true);
    expect(isVoltApiSpecifier('./api')).toBe(true);
    expect(isVoltApiSpecifier('./api.ts')).toBe(true);
    expect(isVoltApiSpecifier('./api.js')).toBe(true);
    expect(isVoltApiSpecifier('./api.tsx')).toBe(true);
    expect(isVoltApiSpecifier('./api.jsx')).toBe(true);
    expect(isVoltApiSpecifier('./api.mjs')).toBe(true);
  });

  it('import.meta is preserved as-is by Sucrase (not rewritten to require)', () => {
    // Sucrase intentionally leaves `import.meta` alone — it's host-defined.
    // Inside the Worker the bundle is instantiated from a Blob URL, so
    // `import.meta.url` resolves to that blob URL (e.g. `blob:null/<uuid>`),
    // NOT the extension's on-disk path. That is the currently observed
    // behaviour — if a future refactor introduces a real source URL we want
    // to fail this test and re-audit for information disclosure.
    const src = `
      export const metaUrl = import.meta.url;
      export const meta = import.meta;
    `;
    const out = runTransform(src);
    // Preserved verbatim — no require() injected.
    expect(out).toMatch(/import\.meta\.url/);
    expect(out).toMatch(/import\.meta(?![.\w])/);
    // And Sucrase must NOT turn it into a require() call that could route
    // through __voltRequire__ and leak the shim.
    expect(out).not.toMatch(/require\(['"]import\.meta['"]\)/);
  });

  it('tagged template literal with import-like text is not rewritten', () => {
    // Paranoia test: tagged templates must not be parsed as imports, even
    // when their template text happens to look like one.
    const src =
      "function tag(strings, ...values) { return strings.join('') + values.join(''); }\n" +
      "export const s = tag`import { x } from ${'../../api'}`;";
    const out = runTransform(src);
    // No require() should have been injected for the inner string expression.
    expect(out).not.toMatch(/require\(['"]\.\.\/\.\.\/api['"]\)/);
    // The template literal should be preserved structurally.
    expect(out).toContain('tag`import { x } from ');
  });
});
