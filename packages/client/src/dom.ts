type Child = Node | string | null | undefined | false;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', ...children: Child[]): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

export function button(label: string, className: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const element = el('button', className, label);
  element.type = 'button';
  element.disabled = disabled;
  element.addEventListener('click', onClick);
  return element;
}
