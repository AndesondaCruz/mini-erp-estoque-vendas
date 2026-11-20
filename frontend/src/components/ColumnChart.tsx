import { useLayoutEffect, useRef, useState } from 'react';

export interface ColumnDatum {
  key: string;
  /** Rótulo curto do eixo X ("17/11"). */
  label: string;
  /** Rótulo completo da dica ("17/11/2026" ou "semana de 17/11"). */
  longLabel: string;
  value: number;
}

interface Props {
  /** Nome do gráfico para o leitor de tela (o título visível fica fora). */
  label: string;
  data: ColumnDatum[];
  formatValue: (value: number) => string;
  formatTick: (value: number) => string;
}

// Especificações das marcas: coluna de até 24px, ponta de 4px arredondada e
// base reta, grade fina e contínua, texto sempre em tons de texto (nunca na
// cor da série). A cor da série passou no validador de contraste da skill
// de visualização (indigo-700 sobre branco).
const HEIGHT = 240;
const MARGIN = { top: 24, right: 8, bottom: 28, left: 64 };
const MAX_BAR = 24;
const GAP = 2;
const RADIUS = 4;
const SERIES = '#4338ca'; // indigo-700
const SERIES_ACTIVE = '#312e81'; // indigo-900
const GRID = '#e2e8f0'; // slate-200
const AXIS_TEXT = '#475569'; // slate-600
const MIN_LABEL_SPACING = 56;

/** Passo "redondo" (1, 2 ou 5 x 10^n) para uns 4 intervalos no eixo Y. */
export function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  // Passo mínimo 1: os valores são inteiros (centavos, unidades).
  const step = Math.max(
    [1, 2, 5, 10].map((m) => m * power).find((s) => s >= raw) ?? 10 * power,
    1,
  );
  const ticks: number[] = [];
  for (let tick = 0; tick < max + step; tick += step) ticks.push(tick);
  return ticks;
}

/** Coluna com o topo arredondado e a base reta, crescendo da linha de base. */
function columnPath(x: number, y: number, width: number, base: number) {
  const r = Math.min(RADIUS, width / 2, base - y);
  return [
    `M${x},${base}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${base}`,
    'Z',
  ].join(' ');
}

/** Largura atual do elemento. Sem ResizeObserver (testes), usa 640. */
function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(640);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/**
 * Gráfico de colunas de uma série. A tabela com os mesmos dados fica fora,
 * logo abaixo, e é a versão completa para leitor de tela: o SVG é
 * decorativo (aria-hidden). A dica de cada coluna aparece no hover e no
 * teclado (role="slider": uma parada de Tab; as setas percorrem as colunas).
 */
export function ColumnChart({ label, data, formatValue, formatTick }: Props) {
  const [containerRef, width] = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 1);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const base = MARGIN.top + plotHeight;
  const ticks = niceTicks(Math.max(...data.map((d) => d.value)));
  const top = ticks[ticks.length - 1];
  const y = (value: number) => base - (value / top) * plotHeight;

  const band = plotWidth / data.length;
  const barWidth = Math.max(Math.min(MAX_BAR, band - GAP), 1);
  const barX = (index: number) =>
    MARGIN.left + band * index + (band - barWidth) / 2;

  // Rótulos do eixo X espaçados para não colidirem.
  const labelEvery = Math.ceil(
    data.length / Math.max(plotWidth / MIN_LABEL_SPACING, 1),
  );
  // Rótulo direto só no maior valor (o resto fica na dica e na tabela).
  const maxIndex = data.reduce(
    (best, d, i) => (d.value > data[best].value ? i : best),
    0,
  );

  function move(event: React.PointerEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const index = Math.floor((event.clientX - box.left - MARGIN.left) / band);
    setActive(index >= 0 && index < data.length ? index : null);
  }

  function key(event: React.KeyboardEvent) {
    const last = data.length - 1;
    const current = active ?? 0;
    const next =
      event.key === 'ArrowRight'
        ? Math.min(current + 1, last)
        : event.key === 'ArrowLeft'
          ? Math.max(current - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
  }

  const activeDatum = active === null ? undefined : data[active];
  const tipLeft =
    active === null
      ? 0
      : Math.min(Math.max(barX(active) + barWidth / 2, 70), width - 70);
  const tipTop = activeDatum ? y(activeDatum.value) - 8 : 0;

  return (
    <div ref={containerRef} className="relative">
      {/* O anel de foco fica no contêiner quando o range (oculto) tem foco. */}
      <div className="rounded-md has-[input:focus-visible]:outline-2 has-[input:focus-visible]:outline-offset-2 has-[input:focus-visible]:outline-indigo-700">
        {/* Pelo teclado, o gráfico é um <input type="range">: papel de
            slider, foco e setas nativos, e o leitor de tela lê o
            aria-valuetext ("17/11/2026, 2 vendas: R$ 46,30") sem região viva.
            Uma parada de Tab só, em vez de uma por coluna. A tabela abaixo
            continua sendo a versão completa dos dados. */}
        <input
          type="range"
          aria-label={label}
          min={0}
          max={data.length - 1}
          step={1}
          value={active ?? 0}
          aria-valuetext={`${data[active ?? 0].longLabel}: ${formatValue(data[active ?? 0].value)}`}
          onChange={(e) => setActive(Number(e.target.value))}
          onKeyDown={key}
          onFocus={() => setActive((current) => current ?? 0)}
          onBlur={() => setActive(null)}
          className="sr-only"
        />
        <svg
          width={width}
          height={HEIGHT}
          aria-hidden="true"
          onPointerMove={move}
          onPointerLeave={() => setActive(null)}
          className="block"
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={y(tick)}
                y2={y(tick)}
                stroke={GRID}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={MARGIN.left - 8}
                y={y(tick)}
                dy="0.32em"
                textAnchor="end"
                fontSize={12}
                fill={AXIS_TEXT}
                style={{ fontVariantNumeric: 'tabular-nums' }}
              >
                {formatTick(tick)}
              </text>
            </g>
          ))}

          {data.map((d, index) =>
            d.value > 0 ? (
              <path
                key={d.key}
                data-testid="coluna"
                d={columnPath(barX(index), y(d.value), barWidth, base)}
                fill={index === active ? SERIES_ACTIVE : SERIES}
              />
            ) : null,
          )}

          {data[maxIndex].value > 0 && (
            <text
              x={Math.min(
                Math.max(barX(maxIndex) + barWidth / 2, MARGIN.left + 24),
                MARGIN.left + plotWidth - 24,
              )}
              y={y(data[maxIndex].value) - 6}
              textAnchor="middle"
              fontSize={12}
              fontWeight={600}
              fill="#0f172a"
            >
              {formatValue(data[maxIndex].value)}
            </text>
          )}

          {data.map((d, index) =>
            index % labelEvery === 0 ? (
              <text
                key={d.key}
                x={barX(index) + barWidth / 2}
                y={base + 18}
                textAnchor="middle"
                fontSize={12}
                fill={AXIS_TEXT}
              >
                {d.label}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      {/* Dica visual. Para o leitor de tela, o mesmo texto já está no
          aria-valuetext do slider: aqui é aria-hidden para não ler duas vezes. */}
      {activeDatum && (
        <div
          aria-hidden="true"
          data-testid="dica"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm shadow-md"
          style={{ left: tipLeft, top: tipTop }}
        >
          {/* O valor vem primeiro e em destaque; o período, depois. */}
          <strong className="block text-slate-900">
            {formatValue(activeDatum.value)}
          </strong>
          <span className="text-slate-600">{activeDatum.longLabel}</span>
        </div>
      )}
    </div>
  );
}
