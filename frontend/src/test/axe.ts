import axe from 'axe-core';

/**
 * Roda o axe-core no container e falha listando as violações.
 * A regra de contraste fica desligada: o jsdom não calcula cores.
 */
export async function expectNoA11yViolations(container: Element) {
  const result = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  const summary = result.violations.map(
    (v) => `${v.id}: ${v.help} (${v.nodes.length} elemento(s))`,
  );
  expect(summary).toEqual([]);
}
