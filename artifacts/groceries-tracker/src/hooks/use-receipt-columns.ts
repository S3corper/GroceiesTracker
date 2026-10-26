import { useLayoutEffect, useRef } from 'react';

/** Measure rendered values, sharing one set of column widths across every row. */
export function useReceiptColumns(items: readonly unknown[]) {
  const tableRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const table = tableRef.current;
    const context = document.createElement('canvas').getContext('2d');
    if (!table || !context) return;
    let active = true;
    let frame = 0;
    let measuredWidth = 0;

    const textWidth = (element: Element, text: string) => {
      const style = getComputedStyle(element);
      context.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
      const spacing = parseFloat(style.letterSpacing) || 0;
      return context.measureText(text).width + Math.max(0, text.length - 1) * spacing;
    };
    const inputWidth = (input: HTMLInputElement) => {
      const style = getComputedStyle(input);
      const insets = ['paddingLeft', 'paddingRight', 'borderLeftWidth', 'borderRightWidth'] as const;
      // Leave room for native number steppers and the caret at the end of the value.
      return Math.ceil(textWidth(input, input.value || input.placeholder)
        + insets.reduce((sum, key) => sum + (parseFloat(style[key]) || 0), 0)
        + (input.type === 'number' ? 18 : 0) + 4);
    };
    const measure = () => {
      if (!active) return;
      measuredWidth = table.clientWidth;
      const headers = table.querySelectorAll('.review-table-head > span');
      const widths = Array.from(headers).slice(0, 6).map(header => Math.ceil(textWidth(header, header.textContent ?? '') + 8));
      if (widths.length !== 6) return;
      const measures = [0, 0];
      table.querySelectorAll('.review-table-row').forEach(row => {
        Array.from(row.children).slice(0, 6).forEach((cell, column) => {
          const inputs = Array.from(cell.querySelectorAll('input'));
          if (column === 4) {
            inputs.forEach((input, index) => { measures[index] = Math.max(measures[index], inputWidth(input)); });
          } else {
            let width = Math.max(0, ...inputs.map(inputWidth));
            if (column === 5) {
              const price = cell.querySelector('.review-price')!;
              const currency = price.querySelector('span')!;
              const style = getComputedStyle(price);
              width += textWidth(currency, currency.textContent ?? '$') + (parseFloat(style.gap) || 0)
                + parseFloat(style.paddingLeft) + parseFloat(style.paddingRight) + 2;
            }
            widths[column] = Math.max(widths[column], width);
          }
        });
      });
      widths[4] = Math.max(widths[4], measures[0] + measures[1] + 4);
      // Six gaps, row padding, and the remove button also need room when compacting.
      const naturalWidth = widths.reduce((sum, width) => sum + width, 0) + 6 * 6 + 8 + 32;
      table.style.setProperty('--review-columns', `${widths.map(width => `minmax(0, ${width}fr)`).join(' ')} 32px`);
      table.style.setProperty('--review-measure-columns', measures.map(width => `minmax(0, ${Math.max(1, width)}fr)`).join(' '));
      table.style.setProperty('--review-scale', String(Math.min(1, table.clientWidth / naturalWidth)));
    };

    measure();
    // Ignore our own height changes; defer width-driven writes outside observer delivery.
    const observer = new ResizeObserver(() => {
      if (table.clientWidth !== measuredWidth) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(measure);
      }
    });
    observer.observe(table);
    void document.fonts.ready.then(measure);
    document.fonts.addEventListener('loadingdone', measure);
    return () => {
      active = false;
      cancelAnimationFrame(frame);
      observer.disconnect();
      document.fonts.removeEventListener('loadingdone', measure);
    };
  }, [items]);

  return tableRef;
}
